/**
 * Sube el banco (imágenes + audio) a R2 — Fase 1 (2026-08-18).
 *
 * Es el paso que desata la portabilidad: mientras los bytes solo estén en el disco
 * de David, el lote en la nube renderiza sin imágenes y sin música, y toda la Fase 0
 * —que existe justamente para no depender de ese PC— no se puede usar de verdad.
 *
 *   npx tsx scripts/subir-banco-a-r2.ts            # lo que falte
 *   npx tsx scripts/subir-banco-a-r2.ts --force    # todo otra vez
 *   npx tsx scripts/subir-banco-a-r2.ts --solo audio|imagenes
 *
 * Idempotente: antes de subir pregunta por el objeto con HeadObject y compara el
 * TAMAÑO. Cortarlo a media subida y relanzarlo continúa donde iba, que con 260 MB
 * por una conexión doméstica no es un lujo.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { config } from '../src/config'
import { subirMedia, existeEnR2, CLAVE_IMAGENES, CLAVE_AUDIO } from '../src/services/mediaStore'

const EXT_IMG = new Set(['.jpg', '.jpeg', '.png', '.jfif', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif'])
const EXT_AUDIO = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac'])

interface Tanda {
  nombre: string
  dir: string
  prefijo: string
  extensiones: Set<string>
}

async function subirTanda(t: Tanda, force: boolean) {
  const dir = path.resolve(t.dir)
  if (!fs.existsSync(dir)) {
    console.log(`${t.nombre}: no existe ${dir}, saltando`)
    return
  }
  // Solo el nivel superior: en `data/images` hay una subcarpeta con el respaldo de
  // la deduplicación de julio que no forma parte del banco.
  const ficheros = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && t.extensiones.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort()

  console.log(`\n${t.nombre}: ${ficheros.length} archivos`)
  let subidos = 0, saltados = 0, bytes = 0
  const errores: string[] = []

  for (const [i, nombre] of ficheros.entries()) {
    const local = path.join(dir, nombre)
    const tam = fs.statSync(local).size
    try {
      if (!force && (await existeEnR2(t.prefijo, nombre, tam))) {
        saltados++
      } else {
        await subirMedia(t.prefijo, nombre, local)
        subidos++
        bytes += tam
      }
    } catch (e: any) {
      errores.push(`${nombre}: ${String(e.message).slice(0, 120)}`)
    }
    if ((i + 1) % 25 === 0 || i === ficheros.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${ficheros.length}  (subidos ${subidos}, ya estaban ${saltados})`)
    }
  }
  console.log(`\n  ${subidos} subidos (${(bytes / 1024 / 1024).toFixed(0)} MB), ${saltados} ya estaban`)
  if (errores.length) {
    console.log(`  ${errores.length} errores:`)
    for (const e of errores.slice(0, 10)) console.log(`    ${e}`)
  }
}

async function main() {
  if (!config.aws.bucket || !config.aws.endpoint) {
    throw new Error('R2 no está configurado (R2_BUCKET / R2_ENDPOINT en el .env)')
  }
  const force = process.argv.includes('--force')
  const iSolo = process.argv.indexOf('--solo')
  const solo = iSolo >= 0 ? process.argv[iSolo + 1] : null

  const tandas: Tanda[] = [
    { nombre: 'imagenes', dir: config.paths.images, prefijo: CLAVE_IMAGENES, extensiones: EXT_IMG },
    { nombre: 'audio', dir: config.paths.audio, prefijo: CLAVE_AUDIO, extensiones: EXT_AUDIO },
  ]

  const t0 = Date.now()
  for (const t of tandas) {
    if (solo && solo !== t.nombre) continue
    await subirTanda(t, force)
  }
  console.log(`\nHecho en ${((Date.now() - t0) / 60000).toFixed(1)} min`)
}

main().catch((e) => { console.error('FALLO:', e.message); process.exit(1) })
