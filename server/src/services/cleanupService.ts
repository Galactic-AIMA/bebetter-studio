import fs from 'fs'
import path from 'path'
import { config } from '../config'

const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 horas

function cleanDir(dir: string, dbPath: string) {
  if (!fs.existsSync(dir)) return 0
  const now = Date.now()
  const files = fs.readdirSync(dir)
  let removed = 0

  for (const file of files) {
    const filePath = path.join(dir, file)
    try {
      const stat = fs.statSync(filePath)
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(filePath)
        removed++
      }
    } catch {
      // file already gone
    }
  }

  // Sincroniza el JSON: elimina registros cuyo archivo ya no existe
  if (fs.existsSync(dbPath)) {
    try {
      const records: any[] = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
      const active = records.filter((r) => fs.existsSync(r.localPath))
      if (active.length !== records.length) {
        fs.writeFileSync(dbPath, JSON.stringify(active, null, 2))
      }
    } catch {
      // JSON corrupto — no tocamos
    }
  }

  return removed
}

export function runCleanup() {
  const outputBase = path.resolve(config.paths.output)
  const dataBase = path.join(__dirname, '../../../data')

  const videos = cleanDir(
    path.join(outputBase, 'videos'),
    path.join(dataBase, 'videos.json'),
  )
  const images = cleanDir(
    path.join(outputBase, 'images'),
    path.join(dataBase, 'images-output.json'),
  )

  if (videos + images > 0) {
    console.log(`[cleanup] Eliminados: ${videos} videos, ${images} imágenes`)
  }
}
