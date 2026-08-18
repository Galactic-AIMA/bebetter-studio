import { v4 as uuidv4 } from 'uuid'
import db from '../db'
import { planBatch, BatchDriver, PlannedPair } from './batchPlanner'
import { generateVideo } from './videoGenerator'
import { enqueue } from './queueService'
import { PRESETS } from '../text/presets'
import { config as appConfig } from '../config'
import { logInfo, logError } from './logService'

/**
 * Genera un lote ENTERO en el servidor, sin navegador.
 *
 * Es la pieza que le faltaba a la automatización: hasta ahora el bucle del lote
 * vivía en `BatchGenerator.tsx`, así que «genérame 30 reels» exigía el PC
 * encendido con una pestaña abierta. Aquí el reparto es el mismo que ya hacía el
 * cliente, solo que dentro:
 *
 *   PLANIFICAR (con estado, de una vez)  → `planBatch` arrastra `RotationState`
 *   RENDERIZAR (puro, uno detrás de otro) → `generateVideo` por la cola serial
 *   ESCRIBIR   (con estado)               → filas en `videos`
 *
 * Tres cosas que NO hace, y son el punto:
 *   · **No encola** — las piezas nacen en `pendiente_revision`, así que no gastan
 *     frase ni copies hasta que alguien las aprueba (Fase 0.3)
 *   · **No mide el texto en el navegador** — el corte de línea lo calcula el
 *     servidor contra el mismo TTF que pinta FFmpeg (Fase 0.1)
 *   · **No propone frases fuera de norma** — `planBatch` ya filtra (Fase 0.2)
 *
 * El trabajo va en segundo plano con un registro en memoria: 30 reels son varios
 * minutos y ninguna petición HTTP razonable espera eso. En memoria es suficiente
 * mientras el proceso sea uno solo; con Postgres y el Job de Cloud Run esto pasa
 * a ser una tabla.
 */

export type EstadoTrabajo = 'planificando' | 'generando' | 'terminado' | 'error'

export interface TrabajoLote {
  id: string
  estado: EstadoTrabajo
  /** Cuántas se pidieron. */
  pedidas: number
  /** Cuántas pudo planificar de verdad (tope: las frases en norma disponibles). */
  planificadas: number
  hechas: number
  errores: { phraseId: string; error: string }[]
  videoIds: string[]
  empezado: string
  terminado?: string
}

const trabajos = new Map<string, TrabajoLote>()

export function verTrabajo(id: string): TrabajoLote | undefined {
  return trabajos.get(id)
}

export function trabajosRecientes(n = 10): TrabajoLote[] {
  return [...trabajos.values()].sort((a, b) => b.empezado.localeCompare(a.empezado)).slice(0, n)
}

export interface OpcionesLote {
  count: number
  driver?: BatchDriver
  allowRepeat?: boolean
  /** Preset de marca con el que renderizar. Por defecto, `bebetter`. */
  estilo?: keyof typeof PRESETS
  duracion?: number
  resolucion?: { width: number; height: number }
}

/** Construye la config de render de una pieza a partir del preset y del par planificado. */
function configDePieza(par: PlannedPair, opts: Required<Pick<OpcionesLote, 'estilo' | 'duracion' | 'resolucion'>>) {
  const p = PRESETS[opts.estilo]
  return {
    imageId: par.imageId,
    imagePath: `${appConfig.paths.images}/${par.imageId}`,
    duration: opts.duracion,
    transition: 'fadeBlack' as const,
    transitionDuration: 1,
    text: {
      content: par.phraseText,
      font: p.font,
      fontSize: p.fontSize,
      color: p.color,
      shadow: p.shadow,
      align: p.align,
      position: { x: 50, y: p.positionY },
      maxWidth: p.maxWidth,
      lineHeight: p.lineHeight,
      letterSpacing: 0,
      strokeWidth: 0,
      strokeColor: '#000000',
    },
    // Sin `wrappedLines`: que las calcule el servidor. Es justo lo que desbloqueó
    // la Fase 0.1, y el motivo por el que este endpoint puede existir.
    resolution: opts.resolucion,
    visualStyle: opts.estilo,
    source: par.author ?? '',
    audioTrack: par.audioTrack,
    watermark: { enabled: false as const, position: 'right' as const, y: 90, type: 'text' as const },
  }
}

/** Arranca un lote y devuelve el trabajo ya registrado (la generación sigue en segundo plano). */
export function lanzarLote(opts: OpcionesLote): TrabajoLote {
  const driver: BatchDriver = opts.driver ?? 'phrases'
  const estilo = opts.estilo ?? 'bebetter'
  const duracion = opts.duracion ?? 10
  const resolucion = opts.resolucion ?? { width: 1080, height: 1920 }

  const pares = planBatch(driver, opts.count, opts.allowRepeat === true)

  const trabajo: TrabajoLote = {
    id: uuidv4(),
    estado: pares.length ? 'generando' : 'terminado',
    pedidas: opts.count,
    planificadas: pares.length,
    hechas: 0,
    errores: [],
    videoIds: [],
    empezado: new Date().toISOString(),
  }
  trabajos.set(trabajo.id, trabajo)

  if (!pares.length) {
    trabajo.terminado = new Date().toISOString()
    logInfo('generate', `Lote ${trabajo.id}: 0 piezas — no hay frases en norma disponibles`)
    return trabajo
  }

  if (pares.length < opts.count) {
    logInfo('generate', `Lote ${trabajo.id}: se pidieron ${opts.count} y el pool en norma da para ${pares.length}`)
  }

  // Sin await: el trabajo sigue por su cuenta y se consulta por su id.
  void generarTodas(trabajo, pares, { estilo, duracion, resolucion })
  return trabajo
}

async function generarTodas(
  trabajo: TrabajoLote,
  pares: PlannedPair[],
  opts: Required<Pick<OpcionesLote, 'estilo' | 'duracion' | 'resolucion'>>
): Promise<void> {
  for (const par of pares) {
    try {
      const cfg = configDePieza(par, opts)
      const id = uuidv4()
      const base = par.phraseText.slice(0, 60).replace(/[\\/:*?"<>|]/g, '').trim() || 'reel'
      const { filename, localPath, publicUrl } = await enqueue(() => generateVideo(cfg as any, `${base}_${id.slice(0, 8)}`))

      db.prepare(`
        INSERT INTO videos
          (id, filename, title, description, tags, local_path, public_url,
           phrase_id, viral, font, effect, resolution, config_extra, created_at, estado)
        VALUES
          (@id, @filename, @title, '', '[]', @local_path, @public_url,
           @phrase_id, 0, @font, NULL, @resolution, @config_extra, @created_at, 'pendiente_revision')
      `).run({
        id,
        filename,
        title: base,
        local_path: localPath,
        public_url: publicUrl,
        phrase_id: par.phraseId,
        font: cfg.text.font,
        resolution: `${opts.resolucion.width}x${opts.resolucion.height}`,
        config_extra: JSON.stringify(cfg),
        created_at: new Date().toISOString(),
      })

      trabajo.videoIds.push(id)
      trabajo.hechas++
    } catch (err: any) {
      trabajo.errores.push({ phraseId: par.phraseId, error: err.message })
      logError('generate', `Lote ${trabajo.id}: falló ${par.phraseId}`, err.message)
    }
  }

  trabajo.estado = trabajo.hechas > 0 ? 'terminado' : 'error'
  trabajo.terminado = new Date().toISOString()
  logInfo('generate', `Lote ${trabajo.id} terminado: ${trabajo.hechas}/${trabajo.planificadas} · ${trabajo.errores.length} error(es)`)
}
