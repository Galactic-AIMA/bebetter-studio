import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query(
  `SELECT id FROM phrases WHERE archived=0 AND (embedding IS NULL OR descripcion_mood IS NULL)`)
console.log(rows.map(r => r.id).join('\n'))
await pool.end()
