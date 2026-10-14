/**
 * Copia los datos de SQLite a Postgres — Fase 2 (2026-08-19).
 *
 *   npx tsx scripts/migrar-a-postgres.ts            # ensayo: crea el esquema y copia
 *   npx tsx scripts/migrar-a-postgres.ts --limpiar  # vacía las tablas antes de copiar
 *
 * Se conecta a Postgres por `DATABASE_URL`. No toca SQLite más que para leer, así
 * que se puede repetir tantas veces como haga falta: el ensayo sobre una copia que
 * pedía el roadmap es, en la práctica, correr esto contra una base de desarrollo.
 *
 * Verifica al final CONTANDO LAS FILAS de los dos lados. Una copia que "no dio
 * error" no prueba nada: lo que prueba algo es que los números cuadren, y que los
 * embeddings sigan midiendo lo mismo en bytes.
 */
import 'dotenv/config'
import { Pool } from 'pg'
import Database from 'better-sqlite3'
import path from 'path'
import { ESQUEMA_PG, VISTA_PG } from '../src/schemaPg'

const SQLITE = path.join(__dirname, '../../data/bebetter.db')

// En orden: nada depende de nada por claves foráneas (no hay), pero copiar las
// tablas grandes al final deja los fallos rápidos al principio.
const TABLAS = [
  'phrases', 'images', 'videos', 'images_output', 'pinterest_pins',
  'pinterest_sync_log', 'audio_tracks', 'audio_sources', 'carousels',
  'publications', 'media_insights',
]

// Cuántas filas van en cada INSERT. 200 mantiene la sentencia por debajo del límite
// de 65.535 parámetros de Postgres incluso en la tabla más ancha (videos, 20 columnas).
const LOTE = 200

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL en el .env')

  const limpiar = process.argv.includes('--limpiar')
  const sqlite = new Database(SQLITE, { readonly: true })
  const pool = new Pool({ connectionString: url })

  console.log('Creando esquema…')
  await pool.query(ESQUEMA_PG)
  await pool.query(VISTA_PG)

  if (limpiar) {
    // La vista depende de las tablas: TRUNCATE va bien, DROP no haría falta.
    await pool.query(`TRUNCATE ${TABLAS.join(', ')}`)
    console.log('Tablas vaciadas')
  }

  const resumen: { tabla: string; origen: number; destino: number }[] = []

  for (const tabla of TABLAS) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${tabla})`).all() as any[]).map((c) => c.name)
    // `pinterest_sync_log.id` es IDENTITY en Postgres: se copia igualmente con
    // OVERRIDING SYSTEM VALUE para conservar los ids, y después se recoloca la
    // secuencia — si no, el primer INSERT nuevo chocaría con un id ya usado.
    const esIdentity = tabla === 'pinterest_sync_log'
    const filas = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${tabla}`).all() as any[]

    for (let i = 0; i < filas.length; i += LOTE) {
      const trozo = filas.slice(i, i + LOTE)
      const valores: any[] = []
      const tuplas = trozo.map((f) => {
        const marcas = cols.map((c) => {
          valores.push(f[c] === undefined ? null : f[c])
          return `$${valores.length}`
        })
        return `(${marcas.join(', ')})`
      })
      await pool.query(
        `INSERT INTO ${tabla} (${cols.join(', ')})
         ${esIdentity ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES ${tuplas.join(', ')}
         ON CONFLICT DO NOTHING`,
        valores
      )
    }

    if (esIdentity && filas.length > 0) {
      await pool.query(
        `SELECT setval(pg_get_serial_sequence('pinterest_sync_log', 'id'),
                       (SELECT COALESCE(MAX(id), 1) FROM pinterest_sync_log))`
      )
    }

    const destino = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`)).rows[0].n)
    resumen.push({ tabla, origen: filas.length, destino })
    console.log(`  ${tabla.padEnd(20)} ${String(filas.length).padStart(5)} → ${String(destino).padStart(5)}`)
  }

  console.log('\n— Comprobación —')
  const malas = resumen.filter((r) => r.origen !== r.destino)
  console.log(malas.length === 0
    ? `Todas las tablas cuadran (${resumen.reduce((a, r) => a + r.destino, 0)} filas)`
    : `NO CUADRAN: ${malas.map((m) => `${m.tabla} ${m.origen}≠${m.destino}`).join(', ')}`)

  // Los embeddings son lo más fácil de romper en silencio: un BLOB que viaja mal
  // sigue siendo un BLOB, solo que con otra longitud, y el coseno daría números
  // plausibles pero falsos.
  const bytesSqlite = (sqlite.prepare(
    `SELECT SUM(LENGTH(embedding)) AS n FROM phrases WHERE embedding IS NOT NULL`
  ).get() as any).n
  const bytesPg = Number((await pool.query(
    `SELECT SUM(OCTET_LENGTH(embedding))::bigint AS n FROM phrases WHERE embedding IS NOT NULL`
  )).rows[0].n)
  console.log(`Embeddings de frases: ${bytesSqlite} bytes en SQLite, ${bytesPg} en Postgres — ` +
    (bytesSqlite === bytesPg ? 'IDÉNTICOS' : 'DIFIEREN ⚠️'))

  // Y la vista, que es lo único reescrito a mano.
  const vista = await pool.query(
    `SELECT recipe_status, COUNT(*)::int AS n FROM v_publication_recipe GROUP BY 1 ORDER BY 1`
  )
  console.log('Vista v_publication_recipe:', vista.rows.map((r: any) => `${r.recipe_status}=${r.n}`).join(' · '))

  sqlite.close()
  await pool.end()
}

main().catch((e) => { console.error('FALLO:', e.message); process.exit(1) })
