import fs from 'fs'
import { GoogleAuth } from 'google-auth-library'
import { config } from '../config'

// Generación de imágenes con los modelos Gemini de imagen en Vertex AI.
// Sustituto directo de kieService: mismo `nano-banana-pro` detrás, pero sin
// revendedor de por medio y con cargo a los créditos del ensayo.
//
// Diferencias de forma respecto a KIE, todas verificadas el 2026-08-18:
//   · KIE es asíncrono (createTask → polling) y devuelve una URL.
//     Vertex es síncrono y devuelve la imagen en base64 (`inlineData`).
//   · El formato va en `generationConfig.imageConfig.aspectRatio`. SÍ se respeta:
//     1:1 → 1024x1024, 9:16 → 768x1344.
//   · ⚠️ Los modelos de imagen SOLO responden en `global`, no en us-central1.
//   · ⚠️ `gemini-3-pro-image` devuelve 429 con frecuencia (Dynamic Shared Quota:
//     no hay cuota propia, se reparte capacidad entre todos). Un 429 ahí NO
//     significa "gastaste tu límite" sino "ahora no hay hueco", así que no depende
//     de cuánto hayas generado y llega en cualquier momento.
//     ⇒ Por eso hay CADENA DE MODELOS, no solo backoff: si el Pro no da hueco se
//     genera con `gemini-2.5-flash-image`. Medido el 2026-08-18 con el mismo
//     prompt: Pro 430,5 s (reintentos encadenados) contra flash 7,2 s.

export type ImagenAspect = '9:16' | '4:5' | '1:1' | '16:9' | '3:4'

export interface VertexImageOptions {
  prompt: string
  aspectRatio?: ImagenAspect
  /**
   * Imágenes de referencia para coherencia visual entre slides. Acepta **rutas
   * locales** (lo normal con Vertex) y **URLs http(s)** — estas últimas por los
   * carruseles empezados con KIE antes del cambio de backend: su portada quedó
   * guardada como URL, y si no se descargara, la slide se generaría ==sin
   * referencia y sin avisar==, perdiendo la coherencia en silencio.
   */
  imageInput?: string | string[]
}

export interface VertexImageResult {
  buffer: Buffer
  mime: string
}

let _auth: GoogleAuth | null = null
function auth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      keyFile: config.google.vertex.credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return _auth
}

function endpoint(modelo: string): string {
  const { project, imageLocation } = config.google.vertex
  if (!project) throw new Error('VERTEX_PROJECT no está configurada')
  const host = imageLocation === 'global' ? 'aiplatform.googleapis.com' : `${imageLocation}-aiplatform.googleapis.com`
  return `https://${host}/v1/projects/${project}/locations/${imageLocation}/publishers/google/models/${modelo}:generateContent`
}

async function parteImagen(ref: string) {
  if (/^https?:\/\//i.test(ref)) {
    const r = await fetch(ref, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`No se pudo descargar la imagen de referencia (${r.status}): ${ref.slice(0, 120)}`)
    const buf = Buffer.from(await r.arrayBuffer())
    return { inlineData: { mimeType: r.headers.get('content-type') || 'image/png', data: buf.toString('base64') } }
  }
  if (!fs.existsSync(ref)) throw new Error(`Imagen de referencia no encontrada: ${ref}`)
  const jpg = /\.jpe?g$/i.test(ref)
  return { inlineData: { mimeType: jpg ? 'image/jpeg' : 'image/png', data: fs.readFileSync(ref).toString('base64') } }
}

// Backoff exponencial. Los 429 de la cuota compartida son la norma, no la excepción.
async function conReintento<T>(fn: () => Promise<T>, intentos = 4, esperaMs = 5_000): Promise<T> {
  let ultimo: any
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn()
    } catch (e: any) {
      ultimo = e
      if (e?.status !== 429 || i === intentos - 1) throw e
      await new Promise((r) => setTimeout(r, esperaMs * Math.pow(2, i)))
    }
  }
  throw ultimo
}

/** Una llamada al modelo indicado, sin reintentos. */
async function llamar(modelo: string, cuerpo: unknown): Promise<any> {
  const { token } = await (await auth().getClient()).getAccessToken()
  const r = await fetch(endpoint(modelo), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(300_000),
  })
  if (!r.ok) {
    const err: any = new Error(`Vertex imagen ${r.status}: ${(await r.text()).slice(0, 400)}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

export async function generateImage(opts: VertexImageOptions): Promise<VertexImageResult> {
  const partes: any[] = [{ text: opts.prompt }]
  if (opts.imageInput) {
    const refs = Array.isArray(opts.imageInput) ? opts.imageInput : [opts.imageInput]
    for (const r of refs) partes.push(await parteImagen(r))
  }

  const cuerpo = {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: { imageConfig: { aspectRatio: opts.aspectRatio ?? '9:16' } },
  }

  // Cadena de modelos: el bueno primero, el ligero cuando el bueno no da hueco.
  //
  // El primario solo se reintenta DOS veces, no cuatro. Insistirle a un modelo
  // saturado deja de tener sentido en cuanto hay una alternativa que responde en
  // segundos: medido el 2026-08-18 con el mismo prompt, `gemini-3-pro-image` tardó
  // **430,5 s** (o sea, ciclos de reintento encadenados) y `gemini-2.5-flash-image`
  // **7,2 s**. Sesenta veces. Y la calidad no es de otra categoría — el Pro sale más
  // minimalista y el flash con más textura, pero los dos cumplen la norma de marca y
  // ninguno mete texto.
  const cadena = [config.google.vertex.imageModel, config.google.vertex.imageModelRespaldo]
    .filter((m, i, a): m is string => !!m && a.indexOf(m) === i)

  let json: any
  let ultimo: any
  for (const [i, modelo] of cadena.entries()) {
    const esUltimo = i === cadena.length - 1
    try {
      json = await conReintento(() => llamar(modelo, cuerpo), esUltimo ? 3 : 2)
      if (i > 0) console.log(`[vertex] ${cadena[0]} sin hueco; generado con ${modelo}`)
      break
    } catch (e: any) {
      ultimo = e
      // Solo se cambia de modelo por FALTA DE CAPACIDAD. Un 400 o un bloqueo del
      // filtro de contenido fallarían igual en el otro y esconderían el motivo real.
      if (e?.status !== 429 || esUltimo) throw e
    }
  }
  if (!json) throw ultimo

  const parts = json?.candidates?.[0]?.content?.parts ?? []
  const inline = parts.map((p: any) => p.inlineData || p.inline_data).find((x: any) => x?.data)
  if (!inline) {
    const texto = parts.find((p: any) => p.text)?.text
    throw new Error(`Vertex no devolvió imagen${texto ? ` (respondió texto: ${texto.slice(0, 200)})` : ''}`)
  }
  return { buffer: Buffer.from(inline.data, 'base64'), mime: inline.mimeType || inline.mime_type || 'image/png' }
}
