/**
 * ¿Los cortes cosechados llevan voz encima? (2026-08-18)
 *
 * Un reel del nicho puede tener locución sobre la música. Si la tiene, usar su audio
 * de fondo metería a otra persona hablando dentro de los reels de bebetter — un
 * problema mucho peor que emparejar mal. Se comprueba ANTES de dar el banco por
 * bueno.
 *
 *   npx tsx scripts/_comprobar-voz.ts [n]
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { config } from '../src/config'

async function main() {
  const n = Number(process.argv[2]) || 8
  const dir = path.resolve(config.paths.audio)
  const todos = fs.readdirSync(dir).filter((f) => f.startsWith('reel-') && f.endsWith('.mp3'))
  // Muestra repartida por todo el banco, no los primeros por orden alfabético.
  const paso = Math.max(1, Math.floor(todos.length / n))
  const muestra = todos.filter((_, i) => i % paso === 0).slice(0, n)

  const model = new GoogleGenerativeAI(config.google.apiKey).getGenerativeModel({
    model: 'gemini-3.5-flash',
  })
  const prompt = `Escucha este audio, sacado de un reel de Instagram.

Responde EXACTAMENTE en una línea con este formato:
VOZ|<sí|no>|<qué se oye, en menos de 12 palabras>

"sí" solo si hay una persona HABLANDO o CANTANDO con letra inteligible. La música
instrumental, los coros sin palabras y los efectos NO cuentan como voz.`

  console.log(`Comprobando ${muestra.length} de ${todos.length} cortes\n`)
  let conVoz = 0
  for (const f of muestra) {
    try {
      const data = fs.readFileSync(path.join(dir, f)).toString('base64')
      const r = await model.generateContent([
        prompt, { inlineData: { mimeType: 'audio/mpeg', data } },
      ])
      const linea = r.response.text().trim().split('\n')[0]
      if (/^VOZ\|s/i.test(linea)) conVoz++
      console.log(`  ${f.padEnd(28)} ${linea}`)
    } catch (e: any) {
      console.log(`  ${f.padEnd(28)} ✗ ${e.message.slice(0, 80)}`)
    }
  }
  console.log(`\n${conVoz}/${muestra.length} con voz encima.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
