import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { config } from '../config'

/**
 * El banco (imágenes y audio) vivido desde R2 — Fase 1 (2026-08-18).
 *
 * Por qué existe. Hasta ahora el banco era el disco de David: `routes/images.ts`
 * hacía `readdirSync` y `videoGenerator` abría el archivo por ruta. Eso ata toda la
 * Fase 0 —que se construyó para que «genérame 30 reels» no necesite ese PC— a que
 * el PC esté encendido. Con el banco en R2, al contenedor solo le hace falta red.
 *
 * Dos direcciones, y las dos importan:
 *
 *   SUBIR   el banco entero una vez, y cada imagen de IA o corte cosechado después.
 *   TRAER   el archivo a disco antes de renderizar. FFmpeg necesita un fichero de
 *           verdad: no se le puede pasar una URL sin pagar una descarga por filtro y
 *           quedar a merced de un corte de red a media pieza.
 *
 * El caché local es lo que hace que TRAER no duela: un lote de 30 piezas reutiliza
 * pistas y a veces imágenes, y en local el archivo ya está en su sitio y no se
 * descarga nada (ver `rutaLocal`).
 */

export const CLAVE_IMAGENES = 'banco/imagenes'
export const CLAVE_AUDIO = 'banco/audio'

const s3 = new S3Client({
  region: 'auto',
  endpoint: config.aws.endpoint,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
})

/** Directorio de caché. En el contenedor cae en /tmp, que es lo único escribible. */
const CACHE = path.join(os.tmpdir(), 'bebetter-banco')

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
}

function claveDe(prefijo: string, filename: string): string {
  return `${prefijo}/${filename}`
}

/** Dónde vive el archivo en local (banco en disco), si es que existe. */
function dirLocalDe(prefijo: string): string {
  return prefijo === CLAVE_AUDIO ? config.paths.audio : config.paths.images
}

/** URL pública del objeto. El bucket sirve el banco directo al navegador. */
export function urlPublica(prefijo: string, filename: string): string {
  return `${config.aws.publicUrl}/${claveDe(prefijo, filename)}`
}

/** ¿Está ya en R2 con el mismo tamaño? Es lo que hace idempotente a la subida. */
export async function existeEnR2(prefijo: string, filename: string, tamEsperado?: number): Promise<boolean> {
  try {
    const r = await s3.send(new HeadObjectCommand({
      Bucket: config.aws.bucket,
      Key: claveDe(prefijo, filename),
    }))
    // Se compara el tamaño y no solo la existencia: una subida cortada a medias deja
    // el objeto creado pero incompleto, y sin esto se daría por bueno para siempre.
    return tamEsperado === undefined || r.ContentLength === tamEsperado
  } catch {
    return false
  }
}

/** Sube un archivo del banco. Devuelve su URL pública. */
export async function subirMedia(prefijo: string, filename: string, localPath: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase()
  await s3.send(new PutObjectCommand({
    Bucket: config.aws.bucket,
    Key: claveDe(prefijo, filename),
    Body: fs.createReadStream(localPath),
    ContentType: MIME[ext] ?? 'application/octet-stream',
    // Un año: el nombre de archivo identifica el contenido y el banco no se
    // sobrescribe, así que el navegador puede quedárselo sin volver a preguntar.
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return urlPublica(prefijo, filename)
}

/**
 * Ruta LOCAL de un archivo del banco, descargándolo de R2 si hace falta.
 *
 * El orden importa y evita descargas inútiles:
 *   1. el banco en disco (en la máquina de David está entero, no se baja nada)
 *   2. el caché de una descarga anterior
 *   3. R2
 *
 * Devuelve `null` si no está en ninguna parte, en vez de lanzar: quien llama suele
 * estar montando una pieza y prefiere seguir sin música a que se le caiga el lote.
 */
export async function rutaLocal(prefijo: string, filename: string): Promise<string | null> {
  const seguro = path.basename(filename) // evita ../ viniendo de una petición
  if (!seguro) return null

  const enDisco = path.join(path.resolve(dirLocalDe(prefijo)), seguro)
  if (fs.existsSync(enDisco)) return enDisco

  const dirCache = path.join(CACHE, prefijo)
  const enCache = path.join(dirCache, seguro)
  if (fs.existsSync(enCache) && fs.statSync(enCache).size > 0) return enCache

  try {
    const r = await s3.send(new GetObjectCommand({
      Bucket: config.aws.bucket,
      Key: claveDe(prefijo, seguro),
    }))
    if (!r.Body) return null
    fs.mkdirSync(dirCache, { recursive: true })
    // Se escribe a un temporal y se renombra: dos piezas del mismo lote pueden pedir
    // la misma pista a la vez, y sin esto una leería el archivo a medio escribir.
    const tmp = `${enCache}.${process.pid}.${Date.now()}.part`
    await pipeline(r.Body as Readable, fs.createWriteStream(tmp))
    fs.renameSync(tmp, enCache)
    return enCache
  } catch {
    return null
  }
}

/** Borra el caché de descargas entero. No toca el banco en disco ni R2. */
export function limpiarCache(): void {
  try { fs.rmSync(CACHE, { recursive: true, force: true }) } catch { /* no existía */ }
}

/** Cuánto puede ocupar el caché antes de empezar a tirar lo más viejo. */
const CACHE_MAX_BYTES = 500 * 1024 * 1024

/**
 * Recorta el caché por tamaño, tirando primero lo que hace más tiempo que no se usa.
 *
 * Hace falta porque el caché no se limita solo: en un contenedor de vida larga,
 * pedir imágenes distintas acabaría bajando el banco entero (272 MB hoy, y crece con
 * cada fondo de IA) sobre un /tmp que además comparte espacio con los renders.
 * Tirar por antigüedad de acceso es lo correcto aquí: una pista sale en muchas
 * piezas seguidas y conviene conservarla; una imagen se usa una vez y no vuelve.
 */
export function recortarCache(maxBytes = CACHE_MAX_BYTES): number {
  if (!fs.existsSync(CACHE)) return 0
  const ficheros: { ruta: string; tam: number; atime: number }[] = []
  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(ruta)
      else {
        try {
          const st = fs.statSync(ruta)
          ficheros.push({ ruta, tam: st.size, atime: st.atimeMs })
        } catch { /* desapareció */ }
      }
    }
  }
  recorrer(CACHE)

  let total = ficheros.reduce((a, f) => a + f.tam, 0)
  if (total <= maxBytes) return 0

  ficheros.sort((a, b) => a.atime - b.atime) // el más viejo primero
  let borrados = 0
  for (const f of ficheros) {
    if (total <= maxBytes) break
    try { fs.unlinkSync(f.ruta); total -= f.tam; borrados++ } catch { /* ya no está */ }
  }
  return borrados
}
