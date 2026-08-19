/**
 * Cosecha UN reel y enseña lo que salió, sin tocar el resto del banco.
 *   npx tsx scripts/_probar-cosecha.ts <url>
 */
import 'dotenv/config'
import { harvestFromUrl, metadatosDelReel } from '../src/services/audioHarvest'

async function main() {
  const url = process.argv[2]
  if (!url) throw new Error('Falta la URL del reel')

  console.log('— metadatos (gallery-dl) —')
  console.log(JSON.stringify(await metadatosDelReel(url), null, 2))

  console.log('\n— cosecha (yt-dlp + ffmpeg + Gemini) —')
  const t0 = Date.now()
  const r = await harvestFromUrl(url)
  console.log(JSON.stringify(r, null, 2))
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => { console.error('FALLO:', e.message); process.exit(1) })
