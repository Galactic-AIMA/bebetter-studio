import axios from 'axios'
import { readConfigMap } from './sheetsService'

/**
 * Publicación directa en Instagram desde la app (carril "Publicar ya").
 *
 * Replica el mismo flujo que hace el workflow `[SchedCarrusel] bebetter` para la
 * publicación programada. La duplicación app↔n8n es deliberada y ya es un patrón
 * del proyecto (los copies y la proyección de la cola también viven en ambos):
 * n8n publica cuando la app no está corriendo; la app publica al instante y
 * devuelve el error exacto al UI, que es lo que hace usable el carril express.
 *
 * Auth: @bebetter.path usa **Instagram Login** (`graph.instagram.com`), no
 * Facebook Login. El token vive en la pestaña `config` del Sheet (lo rota
 * semanalmente el workflow `[IGToken]`), NO en una credencial ni en el .env.
 */

const IG_API = 'https://graph.instagram.com/v21.0'
// Cuenta @bebetter.path. Igual que en los workflows de n8n; overridable por .env.
const IG_USER_ID = process.env.IG_USER_ID || '17841425527150540'

async function getToken(): Promise<string> {
  const cfg = await readConfigMap()
  const token = cfg.get('ig_access_token')
  if (!token) {
    throw new Error('No hay ig_access_token en la pestaña `config` del Sheet')
  }
  return token
}

/** Extrae el mensaje útil de un error de la Graph API. */
function igError(err: any, paso: string): Error {
  const e = err?.response?.data?.error
  const detalle = e ? `${e.message}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}` : err.message
  return new Error(`Instagram falló en ${paso}: ${detalle}`)
}

/** Límite de `alt_text` en la Graph API. */
const ALT_TEXT_MAX = 1000

export function normalizeAltText(texto?: string): string | undefined {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > ALT_TEXT_MAX ? t.slice(0, ALT_TEXT_MAX - 1).trimEnd() + '…' : t
}

/**
 * Crea el contenedor de UNA imagen del carrusel. Devuelve su creation id.
 *
 * `alt_text` (Graph API, marzo 2025) mejora accesibilidad —crítico aquí, porque
 * las slides son texto incrustado en imagen y un lector de pantalla no lee nada—
 * y desde que Google indexa el contenido público de cuentas profesionales
 * (julio 2025) también cuenta como señal de búsqueda.
 *
 * La doc de Meta es ambigua sobre si `alt_text` aplica a ítems de carrusel, así
 * que si la petición falla CON alt_text la reintentamos SIN él: preferimos
 * publicar sin alt a no publicar.
 */
async function createItemContainer(imageUrl: string, token: string, altText?: string): Promise<string> {
  const base = { image_url: imageUrl, is_carousel_item: true, access_token: token }

  const intentar = async (params: Record<string, unknown>) => {
    const { data } = await axios.post(`${IG_API}/${IG_USER_ID}/media`, null, { params, timeout: 60_000 })
    if (!data?.id) throw new Error(`respuesta sin id: ${JSON.stringify(data)}`)
    return data.id as string
  }

  const alt = normalizeAltText(altText)
  if (alt) {
    try {
      return await intentar({ ...base, alt_text: alt })
    } catch {
      // Meta lo rechazó (probablemente no admite alt_text en ítems de carrusel):
      // seguimos sin él en vez de tumbar la publicación entera.
    }
  }

  try {
    return await intentar(base)
  } catch (err: any) {
    throw igError(err, `crear el contenedor de ${imageUrl.split('/').pop()}`)
  }
}

/** Agrupa los contenedores en un contenedor CAROUSEL con su caption. */
async function createCarouselContainer(children: string[], caption: string, token: string): Promise<string> {
  try {
    const { data } = await axios.post(
      `${IG_API}/${IG_USER_ID}/media`,
      null,
      {
        params: { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token },
        timeout: 60_000,
      }
    )
    if (!data?.id) throw new Error(`respuesta sin id: ${JSON.stringify(data)}`)
    return data.id as string
  } catch (err: any) {
    throw igError(err, 'crear el contenedor del carrusel')
  }
}

/** Espera a que el contenedor termine de procesarse (FINISHED). */
async function waitFinished(containerId: string, token: string, timeoutMs = 120_000): Promise<void> {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5_000))
    const { data } = await axios.get(`${IG_API}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: token },
      timeout: 30_000,
    })
    last = data?.status_code ?? ''
    if (last === 'FINISHED') return
    if (last === 'ERROR' || last === 'EXPIRED') {
      throw new Error(`Instagram rechazó el carrusel (status ${last}): ${data?.status ?? 'sin detalle'}`)
    }
  }
  throw new Error(`El carrusel no terminó de procesarse en Instagram (último status: ${last || 'desconocido'})`)
}

/** Publica el contenedor ya procesado. Devuelve el media id del post. */
async function publishContainer(containerId: string, token: string): Promise<string> {
  try {
    const { data } = await axios.post(
      `${IG_API}/${IG_USER_ID}/media_publish`,
      null,
      { params: { creation_id: containerId, access_token: token }, timeout: 60_000 }
    )
    return (data?.id as string) ?? ''
  } catch (err: any) {
    throw igError(err, 'publicar el carrusel')
  }
}

/**
 * Publica un carrusel nativo en Instagram (2–10 imágenes) y devuelve el media id.
 * Las URLs deben ser públicas y accesibles por Meta (las de R2 lo son).
 *
 * `altTexts` es opcional y va emparejado por índice con `imageUrls`.
 */
export async function publishCarousel(
  imageUrls: string[],
  caption: string,
  altTexts: (string | undefined)[] = []
): Promise<string> {
  if (imageUrls.length < 2) throw new Error('Un carrusel de Instagram necesita al menos 2 imágenes')
  if (imageUrls.length > 10) throw new Error('Instagram admite máximo 10 imágenes por carrusel')

  const token = await getToken()

  // Secuencial: Meta limita las peticiones concurrentes de creación de media.
  const children: string[] = []
  for (let i = 0; i < imageUrls.length; i++) {
    children.push(await createItemContainer(imageUrls[i], token, altTexts[i]))
  }

  const containerId = await createCarouselContainer(children, caption, token)
  await waitFinished(containerId, token)
  return publishContainer(containerId, token)
}
