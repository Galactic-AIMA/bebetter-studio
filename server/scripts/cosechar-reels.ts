/**
 * Cosecha una tanda de reels del nicho (2026-08-18).
 *
 *   npx tsx scripts/cosechar-reels.ts urls.txt
 *
 * Una URL por línea (las vacías y las que empiezan por # se ignoran). Cosecha en
 * SERIE a propósito: son peticiones a Instagram desde la IP de casa y en paralelo
 * es como se llega antes al bloqueo. A ~17 s por reel con IPv4 forzado.
 *
 * NO confirma las frases: deja cada procedencia con la propuesta de Gemini a la
 * espera de que David la revise en el panel 🎵. Un OCR malo emparejaría mal para
 * siempre y sin avisar, así que la confirmación es un paso humano aparte.
 */
import 'dotenv/config'
import fs from 'fs'
import { harvestFromUrl } from '../src/services/audioHarvest'

async function main() {
  const fichero = process.argv[2]
  if (!fichero) throw new Error('Uso: npx tsx scripts/cosechar-reels.ts <fichero-de-urls>')

  const urls = fs.readFileSync(fichero, 'utf-8')
    .split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  console.log(`${urls.length} reels a cosechar\n`)
  const t0 = Date.now()
  let ok = 0
  const fallos: string[] = []

  for (const [i, url] of urls.entries()) {
    const n = `[${String(i + 1).padStart(2)}/${urls.length}]`
    try {
      const r = await harvestFromUrl(url)
      ok++
      const etiquetas = [
        `${r.durationSeg}s`,
        r.audioTitle ? `🎵 ${r.audioTitle}` : null,
        r.temaRepetido ? 'MISMO TEMA que otro ya cosechado' : null,
        r.yaEstaba ? 'ya estaba' : null,
      ].filter(Boolean).join(' · ')
      console.log(`${n} ${r.filename}  (${etiquetas})`)
      console.log(`      «${r.proposedPhrase || '— sin texto legible —'}»`)
    } catch (e: any) {
      fallos.push(`${url}: ${e.message.slice(0, 160)}`)
      console.log(`${n} ✗ ${e.message.slice(0, 160)}`)
    }
  }

  console.log(`\n${ok}/${urls.length} cosechados en ${((Date.now() - t0) / 60000).toFixed(1)} min`)
  if (fallos.length) {
    console.log('\nFallos:')
    for (const f of fallos) console.log(`  ${f}`)
  }
  console.log('\nSiguiente paso: revisar y confirmar las frases en el panel 🎵.')
}

main().catch((e) => { console.error(e); process.exit(1) })
