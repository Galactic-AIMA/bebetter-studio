/**
 * Elige, para cada pista del banco, el tramo que sonará en el reel.
 *
 *   npx tsx scripts/analizar-tramos-audio.ts            (dry-run)
 *   npx tsx scripts/analizar-tramos-audio.ts --apply
 *   npx tsx scripts/analizar-tramos-audio.ts --ventana 8 --apply
 *
 * Mide la sonoridad segundo a segundo y se queda con la ventana más fuerte, que
 * en música popular suele ser el estribillo. Las pistas que no dan para elegir
 * —las 12 actuales duran 10,102086 s— quedan con offset 0 y lo dice.
 *
 * ⚠️ Es una propuesta, no una sentencia: el valor vive en
 * `audio_tracks.offset_seg` y se puede corregir a mano. En una pista orquestal
 * que crece, el pico está al final y entrar ahí suena abrupto.
 */
import fs from 'fs'
import path from 'path'
import db from '../src/db'
import { config } from '../src/config'
import { mejorTramo } from '../src/services/audioSegment'

const APLICAR = process.argv.includes('--apply')
const iv = process.argv.indexOf('--ventana')
const VENTANA = iv !== -1 ? Number(process.argv[iv + 1]) : 10

async function main() {
  const dir = path.resolve(config.paths.audio)
  const archivos = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f))
  console.log(`${APLICAR ? 'APLICANDO' : 'DRY-RUN'} · ventana de ${VENTANA} s · ${archivos.length} pistas en ${dir}\n`)

  const upd = db.prepare(`UPDATE audio_tracks SET offset_seg = ? WHERE filename = ?`)
  let conTramo = 0, cortas = 0

  for (const f of archivos) {
    const r = await mejorTramo(path.join(dir, f), VENTANA)
    const nombre = f.replace(/\.[^.]+$/, '').slice(0, 30).padEnd(32)
    if (r.duracionPista <= VENTANA + 1) {
      console.log(`  ${nombre} ${r.duracionPista.toFixed(1)}s  —  ${r.motivo}`)
      cortas++
    } else {
      console.log(`  ${nombre} ${r.duracionPista.toFixed(1)}s  →  empieza en ${r.offset}s  (${r.motivo})`)
      conTramo++
    }
    if (APLICAR) {
      const existe = db.prepare(`SELECT 1 FROM audio_tracks WHERE filename = ?`).get(f)
      if (existe) upd.run(r.offset, f)
    }
  }

  console.log(`\nCon tramo elegido: ${conTramo} · demasiado cortas para elegir: ${cortas}`)
  if (!APLICAR) console.log('(dry-run — relanza con --apply para guardar los offsets)')
}

main().catch((e) => { console.error(e); process.exit(1) })
