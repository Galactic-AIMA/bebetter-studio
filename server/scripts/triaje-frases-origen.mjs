/* Triaje de las 56 frases de origen: marca las que tienen un defecto objetivo, para
   no tener que leer las 56 a ciegas en el panel. */
import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query(
  `SELECT source_url, filename, source_phrase FROM audio_sources WHERE source_phrase IS NOT NULL`)

const REGLAS = [
  [/\bquire\b/,                          'typo: «quire» → «quiere»'],
  [/\bfé\b/,                             'tilde de más: «fé» → «fe» (monosílabo)'],
  [/ojos puesto\b/,                      'concordancia: «los ojos puesto» → «puestos»'],
  [/\bdia\b|\bpodre\b|\bmas\b(?! )/,     'faltan tildes («dia», «podre»…)'],
  [/[a-záéíóúñ]”|“[^”]*$|"[^"]*$/,       'comillas sin cerrar — frase cortada'],
  [/[a-záéíóúñ]\s+[A-ZÁÉÍÓÚÑ][a-z]/,     'falta un punto entre las dos oraciones'],
  [/\s+[:;,]/,                           'espacio antes de signo de puntuación'],
  [/^«|»$/,                              'comillas angulares que sobran'],
]
let n = 0
for (const r of rows) {
  const fallos = REGLAS.filter(([re]) => re.test(r.source_phrase)).map(([, m]) => m)
  // Sin punto final y sin cerrar: candidata a estar truncada
  if (!/[.!?»"”]$/.test(r.source_phrase.trim())) fallos.push('sin punto final (¿truncada?)')
  if (!fallos.length) continue
  n++
  console.log(`\n${n}. ${r.source_url}`)
  console.log(`   pista : ${r.filename}`)
  console.log(`   texto : ${r.source_phrase}`)
  fallos.forEach((f) => console.log(`   ⚠ ${f}`))
}
console.log(`\n${n} de ${rows.length} con algo que revisar`)
await pool.end()
