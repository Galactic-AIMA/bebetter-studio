import 'dotenv/config'
import db from '../src/db'
import { bumpAudioUsage } from '../src/services/audioMetadata'

async function main() {
  const f = (await db.prepare(`SELECT filename, usage_count FROM audio_tracks LIMIT 1`).get<any>())!
  console.log('pista:', f.filename, 'uso inicial:', f.usage_count)
  await bumpAudioUsage(f.filename, +3)
  let r = (await db.prepare(`SELECT usage_count FROM audio_tracks WHERE filename = ?`).get<any>(f.filename))!
  console.log('  tras +3:', r.usage_count)
  await bumpAudioUsage(f.filename, -1000)   // el suelo tiene que aguantar
  r = (await db.prepare(`SELECT usage_count FROM audio_tracks WHERE filename = ?`).get<any>(f.filename))!
  console.log('  tras -1000 (suelo en 0):', r.usage_count, r.usage_count === 0 ? 'OK' : 'FALLO')
  await db.prepare(`UPDATE audio_tracks SET usage_count = ? WHERE filename = ?`).run(f.usage_count, f.filename)
  console.log('  restaurado a', f.usage_count)

  // ON CONFLICT DO NOTHING en SQLite
  const antes = (await db.prepare(`SELECT COUNT(*) n FROM audio_tracks`).get<any>())!.n
  await db.prepare(`INSERT INTO audio_tracks (filename) VALUES (?) ON CONFLICT (filename) DO NOTHING`).run(f.filename)
  const despues = (await db.prepare(`SELECT COUNT(*) n FROM audio_tracks`).get<any>())!.n
  console.log('ON CONFLICT DO NOTHING:', antes, '==', despues, antes === despues ? 'OK' : 'FALLO')
}
main().catch((e) => { console.error(e); process.exit(1) })
