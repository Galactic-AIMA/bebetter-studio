/**
 * Repara `publications.phrase_id` en las publicaciones que salieron por la cola
 * antes del fix del 2026-08-02.
 *
 *   npx tsx server/scripts/backfill-phrase-id.ts            (dry-run)
 *   npx tsx server/scripts/backfill-phrase-id.ts --apply
 *
 * Contexto: `syncPublicationsFromSheet` registraba la publicación con `video_id`
 * pero nunca con `phrase_id`, aunque el vídeo sí sabe qué frase lleva. Resultado:
 * 41 de 80 publicaciones sin frase, y el 37% de las frases activas con el
 * contador `usage_count` divergiendo de sus publicaciones reales.
 *
 * Aquí sólo se recupera lo que es deducible con certeza: `publications` →
 * `videos.phrase_id` por `video_id`. No se adivina nada. Las publicaciones sin
 * `video_id` (carruseles, que no usan el banco de frases) se dejan como están.
 *
 * `match_source` pasa a 'video-join' para que el origen del vínculo quede
 * distinguible de 'sheet' (flujo normal) y de 'vision' (backfill por OCR).
 */
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'bebetter.db')

function main() {
  const apply = process.argv.includes('--apply')
  const db = new Database(DB_PATH)

  const candidatas = db
    .prepare(
      `SELECT p.media_id, p.media_type, p.published_at, v.phrase_id, f.text
         FROM publications p
         JOIN videos v   ON v.id = p.video_id
         LEFT JOIN phrases f ON f.id = v.phrase_id
        WHERE p.phrase_id IS NULL AND v.phrase_id IS NOT NULL
        ORDER BY p.published_at`
    )
    .all() as any[]

  const huerfanasSinVideo = db
    .prepare(`SELECT COUNT(*) AS n FROM publications WHERE phrase_id IS NULL AND video_id IS NULL`)
    .get() as any

  console.log(`\n${apply ? 'APLICANDO' : 'DRY-RUN'} — backfill de publications.phrase_id\n`)
  for (const c of candidatas) {
    console.log(`  ${c.media_id}  ${(c.published_at ?? '').slice(0, 10)}  → ${String(c.phrase_id).slice(0, 8)}`)
    console.log(`     ${(c.text ?? '(frase borrada)').slice(0, 78)}`)
  }
  console.log(`\nReparables: ${candidatas.length}`)
  console.log(`Sin video_id, se dejan como están: ${huerfanasSinVideo.n} (carruseles: no usan banco de frases)\n`)

  if (!apply) {
    console.log('Dry-run: no se ha tocado nada. Repetir con --apply.\n')
    db.close()
    return
  }

  const upd = db.prepare(
    `UPDATE publications SET phrase_id = ?, match_source = COALESCE(match_source, 'video-join') WHERE media_id = ?`
  )
  const tx = db.transaction(() => {
    for (const c of candidatas) upd.run(c.phrase_id, c.media_id)
  })
  tx()

  const restantes = db
    .prepare(`SELECT COUNT(*) AS n FROM publications WHERE phrase_id IS NULL`)
    .get() as any
  console.log(`✓ ${candidatas.length} publicaciones vinculadas a su frase.`)
  console.log(`  Publicaciones aún sin frase: ${restantes.n}\n`)
  db.close()
}

main()
