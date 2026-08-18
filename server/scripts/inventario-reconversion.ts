/**
 * Qué le falta a cada frase activa para quedar EN NORMA y en la franja de longitud,
 * y si se puede reescribir en su sitio o hay que archivarla y crear una nueva.
 *
 * La regla de seguridad viene de la tanda 5: solo es seguro un UPDATE si la frase
 * tiene 0 publicaciones Y 0 vídeos. Mirar `publications` a solas no basta — el
 * 2026-08-02 una frase con el contador en cero resultó estar publicada.
 *
 *   npx tsx scripts/inventario-reconversion.ts [--json]
 */
import fs from 'fs'
import path from 'path'
import db from '../src/db'

const MIN = 90
const MAX = 130

interface Fila {
  id: string; text: string; author: string | null
  estructura: string | null; persona: string | null
  usos: number; pubs: number; vids: number
}

const filas = db.prepare(`
  SELECT p.id, p.text, p.author, p.estructura, p.persona, p.usage_count AS usos,
         (SELECT COUNT(*) FROM publications pub WHERE pub.phrase_id = p.id) AS pubs,
         (SELECT COUNT(*) FROM videos v WHERE v.phrase_id = p.id) AS vids
  FROM phrases p WHERE p.archived = 0
  ORDER BY p.usage_count ASC, p.created_at DESC
`).all() as Fila[]

function faltas(f: Fila): string[] {
  const l: string[] = []
  if (f.estructura !== 'dos_tiempos') l.push('giro')
  if (f.persona !== 'tercera') l.push('persona')
  if (f.text.length < MIN) l.push('corta')
  else if (f.text.length > MAX) l.push('larga')
  return l
}

const trabajo = filas.map((f) => ({
  ...f,
  largo: f.text.length,
  faltas: faltas(f),
  libre: f.pubs === 0 && f.vids === 0,
})).filter((f) => f.faltas.length > 0)

const ok = filas.length - trabajo.length
console.log(`Activas: ${filas.length} · ya en norma y en franja: ${ok} · a reconvertir: ${trabajo.length}\n`)

const porFalta: Record<string, number> = {}
for (const t of trabajo) porFalta[t.faltas.join('+')] = (porFalta[t.faltas.join('+')] ?? 0) + 1
console.log('Qué les falta:')
for (const [k, v] of Object.entries(porFalta).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`)

const libres = trabajo.filter((t) => t.libre)
console.log(`\nSe pueden reescribir en su sitio (0 publicaciones y 0 vídeos): ${libres.length}`)
console.log(`Hay que archivar y crear una nueva (tienen histórico)        : ${trabajo.length - libres.length}`)

const citas = trabajo.filter((t) => t.author)
console.log(`\nDe las ${trabajo.length}, son citas de autor: ${citas.length} (reescribirlas cambia la autoría: decisión aparte)`)

if (process.argv.includes('--json')) {
  const salida = path.join(__dirname, 'reconversion-pendiente.json')
  fs.writeFileSync(salida, JSON.stringify(trabajo.map((t) => ({
    id: t.id, texto: t.text, autor: t.author, largo: t.largo,
    estructura: t.estructura, persona: t.persona,
    faltas: t.faltas, libre: t.libre, usos: t.usos, pubs: t.pubs, vids: t.vids,
  })), null, 2), 'utf-8')
  console.log(`\nEscrito ${salida}`)
}
