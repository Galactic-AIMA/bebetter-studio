import fs from 'fs'
import path from 'path'
import db from '../src/db'
import { config } from '../src/config'

/**
 * Limpia la tabla `images` de filas HUÉRFANAS: registros cuyo archivo ya no
 * existe en disco (imágenes borradas/movidas). Evita que el matching/batch
 * (que consultan la tabla) elijan una imagen inexistente → fallo al generar.
 *
 * Uso (desde beBetterStudio/):
 *   npx tsx server/scripts/clean-orphan-images.ts            # dry-run
 *   npx tsx server/scripts/clean-orphan-images.ts --apply    # backup + borra
 */
function main() {
  const dir = config.paths.images
  const onDisk = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  const rows = db.prepare('SELECT filename FROM images').all() as { filename: string }[]
  const orphans = rows.filter((r) => !onDisk.has(r.filename))

  console.log(`Filas en DB: ${rows.length} | entradas en disco: ${onDisk.size}`)
  console.log(`Huérfanas (en DB, sin archivo): ${orphans.length}`)

  if (orphans.length === 0) {
    console.log('Nada que limpiar.')
    return
  }
  if (!process.argv.includes('--apply')) {
    console.log('DRY-RUN. Primeras 5:', orphans.slice(0, 5).map((o) => o.filename))
    console.log('Corré con --apply para hacer backup + borrar.')
    return
  }

  // Backup consistente de la DB antes de borrar (gitignored).
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const bak = path.join(path.dirname(config.paths.db), `bebetter.db.bak-${stamp}`)
  db.exec(`VACUUM INTO '${bak.replace(/\\/g, '/')}'`)
  console.log('Backup:', bak)

  const del = db.prepare('DELETE FROM images WHERE filename = ?')
  const tx = db.transaction((list: { filename: string }[]) => {
    for (const o of list) del.run(o.filename)
  })
  tx(orphans)

  const after = db.prepare('SELECT COUNT(*) c FROM images').get() as { c: number }
  console.log(`Borradas ${orphans.length}. Filas ahora: ${after.c}`)
}

main()
