/**
 * Fase 2 del ensayo Vertex — ¿son comparables los vectores de las dos puertas?
 *
 * PARA QUÉ: `embedText` llama hoy a AI Studio (`generativelanguage.googleapis.com`)
 * con `gemini-embedding-001`. Vertex sirve el MISMO nombre de modelo por otro
 * endpoint (`:predict`) y con otro nombre de parámetro (`task_type` en vez de
 * `taskType`). Que el modelo se llame igual NO garantiza que devuelva el mismo
 * vector.
 *
 * POR QUÉ IMPORTA: hay 118 frases con embeddings guardados, generados por AI
 * Studio. Si Vertex devuelve vectores distintos, el coseno de `utils/matching.ts`
 * compara procedencias mezcladas — y NO da error, solo empeora el matching en
 * silencio. Es el mismo modo de fallo que las tres copias del word-wrap.
 *
 * VEREDICTO: si salen idénticos, se migra `embedText` y lo guardado sigue valiendo.
 * Si no, hay que re-vectorizar el banco entero en una pasada y no mezclar nunca.
 *
 * USO:  VERTEX_PROJECT= npx tsx scripts/vertex-comparar-embeddings.ts
 *
 * ⚠️ El `VERTEX_PROJECT=` vacío del principio es OBLIGATORIO desde que `embedText`
 * migró a Vertex (2026-08-18): sin él, el lado "AI Studio" de la comparación
 * también saldría por Vertex y el test compararía Vertex contra Vertex — daría
 * idéntico siempre, y no probaría nada.
 */
import fs from 'fs'
import path from 'path'
import { GoogleAuth } from 'google-auth-library'
import { embedText } from '../src/services/geminiService'

const PROYECTO = process.env.VERTEX_PROJECT || 'galactic-vertex-bebetter'
const REGION = process.env.VERTEX_LOCATION || 'us-central1'
const MODELO = 'gemini-embedding-001'
// Mismo taskType que usa embedText por defecto. Cambiarlo invalida lo guardado
// (ver el comentario sobre SEMANTIC_SIMILARITY en geminiService.ts).
const TASK_TYPE = 'SEMANTIC_SIMILARITY'

const CLAVE =
  process.env.VERTEX_CREDENTIALS ||
  path.resolve(__dirname, '../credentials/galactic-vertex-bebetter-a1e9a9763f4a.json')

// Frases de control: cortas, en español, del registro real del banco.
const CONTROL = [
  'No estás atrasado, estás en tu propio tiempo.',
  'Deja de esperar el momento perfecto.',
  'La disciplina pesa gramos, el arrepentimiento pesa toneladas.',
  'Hazlo con miedo, pero hazlo.',
  'Tu única competencia es quien fuiste ayer.',
]

async function embedVertex(texto: string): Promise<Float32Array> {
  const auth = new GoogleAuth({
    keyFile: CLAVE,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  const cliente = await auth.getClient()
  const { token } = await cliente.getAccessToken()

  const url =
    `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROYECTO}` +
    `/locations/${REGION}/publishers/google/models/${MODELO}:predict`

  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ content: texto, task_type: TASK_TYPE }] }),
  })
  const cuerpo = await r.text()
  if (!r.ok) throw new Error(`Vertex HTTP ${r.status}: ${cuerpo.slice(0, 500)}`)

  const json = JSON.parse(cuerpo)
  const valores = json?.predictions?.[0]?.embeddings?.values
  if (!Array.isArray(valores)) {
    throw new Error(`Respuesta inesperada de Vertex: ${cuerpo.slice(0, 500)}`)
  }
  return new Float32Array(valores)
}

function coseno(a: Float32Array, b: Float32Array): number {
  let p = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return p / (Math.sqrt(na) * Math.sqrt(nb))
}

function deltaMax(a: Float32Array, b: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

async function main() {
  if (!fs.existsSync(CLAVE)) throw new Error(`No encuentro la clave: ${CLAVE}`)
  console.log(`Proyecto ${PROYECTO} · región ${REGION} · modelo ${MODELO} · taskType ${TASK_TYPE}\n`)

  const filas: { frase: string; dimA: number; dimV: number; cos: number; delta: number }[] = []

  for (const frase of CONTROL) {
    process.stdout.write(`· ${frase.slice(0, 45).padEnd(47)}`)
    const [a, v] = await Promise.all([embedText(frase, TASK_TYPE), embedVertex(frase)])
    const misma = a.length === v.length
    const fila = {
      frase,
      dimA: a.length,
      dimV: v.length,
      cos: misma ? coseno(a, v) : NaN,
      delta: misma ? deltaMax(a, v) : NaN,
    }
    filas.push(fila)
    console.log(misma ? `cos=${fila.cos.toFixed(9)}  Δmax=${fila.delta.toExponential(2)}` : `DIMENSIONES DISTINTAS ${a.length} vs ${v.length}`)
  }

  console.log('\n' + '─'.repeat(72))
  const dimsOk = filas.every((f) => f.dimA === f.dimV)
  const cosMin = Math.min(...filas.map((f) => f.cos))
  const deltaPeor = Math.max(...filas.map((f) => f.delta))

  console.log(`Dimensiones     : AI Studio ${filas[0].dimA} · Vertex ${filas[0].dimV}`)
  if (dimsOk) {
    console.log(`Coseno mínimo   : ${cosMin.toFixed(9)}`)
    console.log(`Δ máxima        : ${deltaPeor.toExponential(3)}`)
  }
  console.log('─'.repeat(72))

  if (!dimsOk) {
    console.log('\n❌ INCOMPATIBLES — distinta dimensionalidad.')
    console.log('   ⇒ Re-vectorizar el banco entero. NO mezclar procedencias.')
    process.exit(1)
  }
  if (cosMin >= 0.999999 && deltaPeor < 1e-5) {
    console.log('\n✅ IDÉNTICOS — se puede migrar `embedText` a Vertex.')
    console.log('   Los 118 embeddings guardados siguen siendo válidos.')
    return
  }
  if (cosMin >= 0.999) {
    console.log('\n⚠️  CASI IGUALES, pero no idénticos.')
    console.log('   El matching no se rompería de golpe, pero se degrada en los empates.')
    console.log('   ⇒ Recomendado re-vectorizar igualmente: cuesta céntimos y quita la duda.')
    process.exit(2)
  }
  console.log('\n❌ DISTINTOS — vectores no comparables.')
  console.log('   ⇒ Re-vectorizar el banco entero. NO mezclar procedencias.')
  process.exit(1)
}

main().catch((e) => { console.error('\n💥', e.message); process.exit(1) })
