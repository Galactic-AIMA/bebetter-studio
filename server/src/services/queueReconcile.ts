import db from '../db'
import { readQueueRows, QueueRow } from './sheetsService'
import { bumpAudioUsage } from './audioMetadata'
import { logInfo, logError } from './logService'

/**
 * Devuelve el uso de las piezas que David descartó **en Telegram**.
 *
 * El contador sube al encolar (`POST /videos/:id/queue`), que es cuando se decide
 * sacar la pieza. Pero después hay un segundo filtro —el gate de Telegram— y si
 * ahí se descarta, la frase quedaba marcada como usada **sin haberse publicado
 * nunca**: como `batchPlanner` ordena por `usage_count ASC`, caía al fondo de la
 * rotación y no volvía a salir.
 *
 * n8n **ya registra** ese descarte: el nodo `Parse Aprobacion` de `[Pub] bebetter`
 * escribe `status = 'rejected'` en la fila del Google Sheet. Lo que faltaba era
 * que la app lo leyera de vuelta. Se hace tirando (la app pregunta), no
 * empujando (n8n avisa), porque hoy n8n vive en EC2 y la app es local: **no puede
 * alcanzarla**. Cuando la app tenga URL pública (Fase 3) esto puede volverse un
 * webhook y dejar de depender de que alguien encienda el PC.
 *
 * Es idempotente por partida doble: solo mira vídeos que no estén ya en
 * 'rechazado', y marca el estado dentro de la misma transacción que devuelve los
 * contadores. Correrlo dos veces no resta dos veces.
 *
 * ⚠️ **Alcance**: solo el carril de la cola. El carril express (`/publish`) no
 * escribe fila en el Sheet, así que un descarte suyo en Telegram no deja rastro
 * que reconciliar.
 */

/** Resta uno a los contadores de la pieza, con suelo en 0. */
async function devolverUso(row: any) {
  if (row.phrase_id) {
    await db.prepare(
      `UPDATE phrases
       SET usage_count = CASE WHEN usage_count - 1 < 0 THEN 0 ELSE usage_count - 1 END
       WHERE id = ?`
    ).run(row.phrase_id)
  }
  const cfg = row.config_extra ? JSON.parse(row.config_extra) : {}
  if (cfg.imageId) {
    await db.prepare(
      `UPDATE images
       SET usage_count = CASE WHEN usage_count - 1 < 0 THEN 0 ELSE usage_count - 1 END
       WHERE filename = ?`
    ).run(cfg.imageId)
  }
  if (cfg.audioTrack && cfg.audioTrack !== 'auto') await bumpAudioUsage(cfg.audioTrack, -1)
}

export interface ResultadoReconcile {
  filasRechazadas: number
  devueltos: number
  sinVinculo: number
  detalle: { videoId: string; filename: string; queueId: string }[]
}

/**
 * @param filasDadas cola ya leída. Existe para poder probar la reconciliación con
 * un rechazo de mentira sin escribir en el Google Sheet de verdad, que es una
 * cola viva de la que tira `[Sched]`.
 */
export async function reconciliarRechazos(filasDadas?: QueueRow[]): Promise<ResultadoReconcile> {
  const filas = filasDadas ?? await readQueueRows()
  const rechazadas = filas.filter((f) => String(f.status ?? '').trim() === 'rejected')

  const detalle: ResultadoReconcile['detalle'] = []
  let sinVinculo = 0

  for (const fila of rechazadas) {
    const video = (await db.prepare(
      `SELECT * FROM videos WHERE queue_id = ? AND (estado IS NULL OR estado <> 'rechazado')`
    ).get(fila.id)) as any

    if (!video) {
      // O ya se reconcilió, o es una fila anterior a que existiera `queue_id`
      // (nada que devolver: no se sabe a qué pieza pertenece).
      const existe = await db.prepare(`SELECT 1 FROM videos WHERE queue_id = ?`).get(fila.id)
      if (!existe) sinVinculo++
      continue
    }

    await db.transaction(async () => {
      await devolverUso(video)
      await db.prepare(`UPDATE videos SET estado = 'rechazado' WHERE id = ?`).run(video.id)
    })

    detalle.push({ videoId: video.id, filename: video.filename, queueId: fila.id })
    logInfo('publish', `Rechazo en Telegram reconciliado: ${video.filename} — uso devuelto`)
  }

  return { filasRechazadas: rechazadas.length, devueltos: detalle.length, sinVinculo, detalle }
}

/** Envoltorio best-effort para los crons: nunca tumba el proceso. */
export async function reconciliarRechazosSeguro(): Promise<void> {
  try {
    const r = await reconciliarRechazos()
    if (r.devueltos > 0) {
      console.log(`Reconciliación: ${r.devueltos} rechazo(s) de Telegram devueltos a la rotación`)
    }
  } catch (err: any) {
    logError('publish', 'Error reconciliando rechazos', err.message)
  }
}
