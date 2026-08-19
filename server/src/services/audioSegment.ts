import { spawn } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'

/**
 * Elegir QUÉ TRAMO de una pista suena en el reel.
 *
 * Hasta ahora el audio entraba siempre desde el segundo 0, y con pistas de 10 s
 * daba igual porque no había de dónde elegir: las 12 del banco duran 10,102086 s
 * clavados —son recortes fijos, no canciones—. Ese es el techo real del
 * emparejamiento: con doce fragmentos intercambiables, ningún criterio de
 * selección puede lucir.
 *
 * Para poder subir temas de 30-40 s hace falta resolver lo que David señaló: si
 * el momento bueno está en el medio, arrancar en 0 se lleva la intro. Aquí se
 * mide la sonoridad segundo a segundo y se elige la ventana más fuerte, que en
 * música popular es donde suele estar el estribillo o el drop.
 *
 * ⚠️ "Más fuerte" no es "mejor" en todos los géneros: en algo orquestal que
 * crece, el pico está al final y entrar justo ahí puede sonar abrupto. Por eso
 * el valor se guarda en `audio_tracks.offset_seg` y se puede corregir a mano:
 * la detección es una propuesta, no una sentencia.
 */

/** Sonoridad (RMS, en dB) segundo a segundo. Más alto = más fuerte. */
export async function perfilRms(archivo: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    // aresample fija 48 kHz para que cada bloque sea exactamente 1 s: sin eso,
    // una pista a 44,1 kHz da bloques de 1,088 s y los offsets salen corridos.
    const args = [
      '-hide_banner', '-i', archivo,
      '-af', 'aresample=48000,asetnsamples=n=48000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-',
    ]
    const p = spawn('ffmpeg', args)
    let salida = ''
    p.stdout.on('data', (d) => { salida += d.toString() })
    p.stderr.on('data', () => { /* el log de ffmpeg no interesa */ })
    p.on('error', reject)
    p.on('close', () => {
      const valores: number[] = []
      for (const linea of salida.split(/\r?\n/)) {
        const m = linea.match(/RMS_level=(-?[\d.]+|-?inf)/)
        if (m) valores.push(m[1].includes('inf') ? -120 : Number(m[1]))
      }
      resolve(valores)
    })
  })
}

export async function duracionSeg(archivo: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(archivo, (err, data) => {
      if (err) return reject(err)
      resolve(Number(data.format.duration ?? 0))
    })
  })
}

export interface TramoElegido {
  offset: number
  duracionPista: number
  /** Sonoridad media de la ventana elegida, en dB. */
  rmsVentana: number
  /** Sonoridad media de los primeros `ventana` segundos, para poder comparar. */
  rmsInicio: number
  motivo: string
}

/**
 * Devuelve el segundo por el que debería empezar la pista para un reel de
 * `ventana` segundos.
 *
 * Si la pista no da para elegir (dura lo mismo que el reel o menos), devuelve 0
 * y lo dice: es el caso de las 12 actuales.
 */
export async function mejorTramo(archivo: string, ventana = 10): Promise<TramoElegido> {
  const dur = await duracionSeg(archivo)
  if (dur <= ventana + 1) {
    return { offset: 0, duracionPista: dur, rmsVentana: 0, rmsInicio: 0, motivo: 'la pista no da para elegir tramo' }
  }

  const rms = await perfilRms(archivo)
  if (rms.length < ventana + 1) {
    return { offset: 0, duracionPista: dur, rmsVentana: 0, rmsInicio: 0, motivo: 'perfil de sonoridad insuficiente' }
  }

  const mediaVentana = (desde: number) => {
    const trozo = rms.slice(desde, desde + ventana)
    return trozo.reduce((a, b) => a + b, 0) / trozo.length
  }

  let mejor = 0
  let mejorRms = -Infinity
  for (let i = 0; i + ventana <= rms.length; i++) {
    const m = mediaVentana(i)
    if (m > mejorRms) { mejorRms = m; mejor = i }
  }

  const inicio = mediaVentana(0)
  return {
    offset: mejor,
    duracionPista: dur,
    rmsVentana: mejorRms,
    rmsInicio: inicio,
    motivo: mejor === 0
      ? 'el tramo más fuerte ya empieza en el segundo 0'
      : `+${(mejorRms - inicio).toFixed(1)} dB frente a empezar en 0`,
  }
}
