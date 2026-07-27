/**
 * Reconcilia lo publicado en Instagram con las piezas de la DB y rellena la
 * tabla `publications` (el puente rendimiento ↔ receta).
 *
 * Uso:
 *   npx tsx server/scripts/backfill-publications.ts            # dry-run: solo informa
 *   npx tsx server/scripts/backfill-publications.ts --apply    # persiste los vínculos
 *   npx tsx server/scripts/backfill-publications.ts --limit 50
 *
 * Lo que NO hace: adivinar. Un post cuyo mejor candidato no llega al umbral se
 * reporta como huérfano y se guarda SIN vincular — con su permalink, para poder
 * mirarlo a mano. Vincular mal es peor que no vincular: envenena el análisis y no
 * deja rastro.
 *
 * Trampas de los scripts `npx tsx` de este repo (ver memoria del proyecto):
 *  - `src/config` corre su propio dotenv según el cwd → leer `process.env` dentro
 *    de main(), y hacer chdir a `server/` para que las rutas relativas resuelvan.
 *  - `sheetsService` usa `config.google.sheetId` en el import → importarlo con
 *    `await import()` DENTRO de main(), después del dotenv.
 */
import path from 'path'
import dotenv from 'dotenv'

const APPLY = process.argv.includes('--apply')
const SEMANTIC = process.argv.includes('--semantic')
const VISION = process.argv.includes('--vision')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 200 : 200

function fecha(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ')
}

async function main() {
  // cwd → server/ (driveService y config resuelven rutas relativas contra él)
  process.chdir(path.join(__dirname, '..'))
  dotenv.config()

  const { fetchPublishedMedia } = await import('../src/services/instagramService')
  const { reconcile, persistReconcile, refineWithEmbeddings } = await import(
    '../src/services/publicationsService'
  )

  console.log(`\n🔎 Leyendo publicaciones de Instagram (máx ${LIMIT})…`)
  const media = await fetchPublishedMedia(LIMIT)
  console.log(`   ${media.length} publicaciones encontradas en la cuenta.\n`)

  const report = await reconcile(media)

  // Pase semántico: el caption de IG es una reescritura de la frase, no la frase,
  // así que el solapamiento de palabras se queda corto. Cuesta un embedding por
  // huérfano (céntimos), por eso va detrás de un flag.
  if (SEMANTIC && report.orphanMedia.length) {
    const { embedText } = await import('../src/services/geminiService')
    const { cosine } = await import('../src/utils/matching')
    const yaUsados = new Set(report.matched.map((m) => m.videoId).filter(Boolean) as string[])

    console.log(`🧠 Segundo pase semántico sobre ${report.orphanMedia.length} huérfanos…\n`)
    const { rescued, stillOrphan } = await refineWithEmbeddings(
      report.orphanMedia,
      (t) => embedText(t),
      cosine,
      yaUsados
    )
    report.matched.push(...rescued)
    report.orphanMedia = stillOrphan
    console.log(`   rescatados por significado: ${rescued.length}\n`)
  }

  // Pase de visión: la frase va quemada en el video, así que la miniatura la
  // tiene literal. Es el más fiable para este contenido — y el único que puede
  // rescatar la receta de lo publicado antes de que existiera el historial.
  const phraseOnly: typeof report.matched = []
  if (VISION && report.orphanMedia.length) {
    const axios = (await import('axios')).default
    const { extractOverlayText } = await import('../src/services/geminiService')
    const { refineWithVision } = await import('../src/services/publicationsService')
    const yaUsados = new Set(report.matched.map((m) => m.videoId).filter(Boolean) as string[])

    console.log(`👁  Leyendo la miniatura de ${report.orphanMedia.length} publicaciones…\n`)
    const res = await refineWithVision(
      report.orphanMedia,
      async (url) => Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 60_000 })).data),
      (buf) => extractOverlayText(buf),
      yaUsados
    )
    report.matched.push(...res.rescued)
    phraseOnly.push(...res.phraseOnly)
    report.orphanMedia = res.stillOrphan
    console.log(`   vinculadas a un video: ${res.rescued.length}`)
    console.log(`   frase recuperada sin video (receta parcial): ${res.phraseOnly.length}\n`)
  }

  console.log(`✅ VINCULADAS (${report.matched.length})`)
  for (const m of report.matched) {
    const pieza = m.videoId ? `video ${m.videoId.slice(0, 8)}` : `carrusel ${m.carouselId!.slice(0, 8)}`
    console.log(`   ${fecha(m.media.timestamp)}  ${(m.media.mediaType ?? '').padEnd(15)} → ${pieza}  [${m.reason}]`)
  }

  console.log(`\n❓ SIN PIEZA EN LA DB (${report.orphanMedia.length}) — publicadas antes del historial o sin match fiable`)
  for (const o of report.orphanMedia) {
    const texto = (o.media.caption ?? '').replace(/\s+/g, ' ').slice(0, 70)
    console.log(`   ${fecha(o.media.timestamp)}  ${(o.media.mediaType ?? '').padEnd(15)}  ${o.media.permalink ?? ''}`)
    console.log(`      "${texto}${texto.length >= 70 ? '…' : ''}"`)
    console.log(`      ↳ ${o.reason}`)
  }

  if (phraseOnly.length) {
    console.log(`\n🧩 FRASE RECUPERADA, SIN PIEZA EN LA DB (${phraseOnly.length}) — receta parcial: mood, energía y paleta`)
    for (const p of phraseOnly) {
      console.log(`   ${fecha(p.media.timestamp)}  ${p.media.permalink ?? ''}`)
      console.log(`      ↳ ${p.reason}`)
    }
  }

  console.log(`\n⚠️  MARCADAS COMO PUBLICADAS PERO NO ESTÁN EN IG (${report.unpublishedPieces.length})`)
  for (const p of report.unpublishedPieces) {
    console.log(`   ${fecha(p.publishedAt)}  ${p.kind.padEnd(8)} ${p.id.slice(0, 8)}  "${p.label}"`)
  }

  if (APPLY) {
    report.matched.push(...phraseOnly)
    const n = persistReconcile(report)
    console.log(`\n💾 Guardadas ${n} filas en \`publications\` (los huérfanos quedan sin vincular).`)
  } else {
    console.log(`\n(dry-run — nada escrito. Añade --apply para persistir.)`)
  }
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
