import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { config } from '../config'

/**
 * La puerta de la app (2026-08-20).
 *
 * Sustituye al `basic_auth` de Caddy, que era un tapón: una contraseña compartida
 * que no distingue quién entra, no se puede revocar sin cambiarla para todos y no
 * sirve para las máquinas.
 *
 * Deja pasar dos identidades y ninguna más:
 *
 *   · **persona** — cookie de sesión firmada, emitida tras un login de Google
 *     cuyo correo está en la lista blanca
 *   · **máquina** — cabecera `X-API-Key` con el token de servicio, para n8n y el
 *     futuro Job de Cloud Run
 *
 * Sin dependencias nuevas a propósito: `crypto` firma, y la cookie se lee del
 * `Cookie:` crudo. Meter `jsonwebtoken` y `cookie-parser` para esto sería añadir
 * dos cadenas de dependencias a una imagen que ya está montada y probada.
 */

export const COOKIE_SESION = 'bb_sesion'
export const COOKIE_ESTADO = 'bb_oauth_estado'

export interface Sesion {
  email: string
  nombre?: string
  exp: number
}

export interface Identidad {
  tipo: 'persona' | 'maquina'
  email?: string
}

/** Lee una cookie de la cabecera cruda. No merece una dependencia. */
export function leerCookie(req: Request, nombre: string): string | null {
  const cruda = req.headers.cookie
  if (!cruda) return null
  for (const trozo of cruda.split(';')) {
    const i = trozo.indexOf('=')
    if (i < 0) continue
    if (trozo.slice(0, i).trim() === nombre) return decodeURIComponent(trozo.slice(i + 1).trim())
  }
  return null
}

function firmar(datos: string): string {
  return crypto.createHmac('sha256', config.auth.sessionSecret).update(datos).digest('base64url')
}

/**
 * Comparación en tiempo constante. `a === b` sobre un secreto filtra información
 * por lo que tarda en fallar: cuanto más prefijo acierta el atacante, más tarda.
 */
function igualesSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // timingSafeEqual EXIGE la misma longitud, y si no, lanza. La comparación de
  // longitud sí puede ser directa: la longitud no es el secreto.
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

export function crearSesion(email: string, nombre?: string): string {
  const exp = Math.floor(Date.now() / 1000) + config.auth.duracionSesionSeg
  const cuerpo = Buffer.from(JSON.stringify({ email, nombre, exp })).toString('base64url')
  return cuerpo + '.' + firmar(cuerpo)
}

export function verificarSesion(token: string | null): Sesion | null {
  if (!token) return null
  const punto = token.lastIndexOf('.')
  if (punto < 1) return null

  const cuerpo = token.slice(0, punto)
  if (!igualesSeguro(token.slice(punto + 1), firmar(cuerpo))) return null

  let s: Sesion
  try {
    s = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (!s.email || typeof s.exp !== 'number') return null
  if (s.exp < Math.floor(Date.now() / 1000)) return null

  // La lista blanca se revalida en CADA petición, no solo al entrar. Así, quitar
  // un correo de AUTH_ALLOWED_EMAILS echa a esa persona en el siguiente clic en
  // vez de dentro de 30 días, cuando caduque su cookie.
  if (!config.auth.correos.includes(s.email.toLowerCase())) return null

  return s
}

/** Atributos de la cookie de sesión. `Secure` solo si el sitio va por HTTPS. */
export function cookieSesion(valor: string, segundos: number): string {
  const seguro = config.auth.baseUrl.startsWith('https://') ? '; Secure' : ''
  // SameSite=Lax y no Strict: el callback de Google llega como navegación
  // top-level desde accounts.google.com, y con Strict el navegador NO mandaría
  // la cookie de estado — el login fallaría siempre con «estado inválido».
  return `${COOKIE_SESION}=${encodeURIComponent(valor)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${segundos}${seguro}`
}

export function cookieEstado(valor: string, segundos: number): string {
  const seguro = config.auth.baseUrl.startsWith('https://') ? '; Secure' : ''
  return `${COOKIE_ESTADO}=${encodeURIComponent(valor)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${segundos}${seguro}`
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identidad?: Identidad
    }
  }
}

/** El guardia. Va sobre `/api` y `/output`. */
export function exigirSesion(req: Request, res: Response, next: NextFunction) {
  if (!config.auth.activo) return next()

  const clave = req.header('x-api-key')
  if (clave && config.auth.tokenServicio && igualesSeguro(clave, config.auth.tokenServicio)) {
    req.identidad = { tipo: 'maquina' }
    return next()
  }

  const sesion = verificarSesion(leerCookie(req, COOKIE_SESION))
  if (sesion) {
    req.identidad = { tipo: 'persona', email: sesion.email }
    return next()
  }

  // JSON y no una redirección: quien llama es axios desde el cliente o una
  // máquina, y a los dos les sirve mejor un 401 que el HTML de una pantalla de
  // login. El navegador ya sabe qué hacer con esto: lo lleva el interceptor.
  res.status(401).json({ error: 'no_autenticado', login: '/auth/google' })
}

/**
 * Comprueba que la puerta está bien montada ANTES de escuchar.
 *
 * Existe por la lección del «motor equivocado»: una variable que falta no falla,
 * ELIGE — y aquí elegiría dejar la app abierta de par en par sin decir nada. Un
 * `AUTH_ENABLED=true` con el `SESSION_SECRET` vacío firmaría todas las sesiones
 * con la cadena vacía, que es exactamente lo que cualquiera puede reproducir.
 *
 * Devuelve la lista de motivos por los que NO se puede arrancar. Vacía = todo ok.
 */
export function revisarPuerta(): string[] {
  if (!config.auth.activo) return []
  const fallos: string[] = []
  const a = config.auth

  if (!a.sessionSecret || a.sessionSecret.length < 32) {
    fallos.push('SESSION_SECRET vacío o de menos de 32 caracteres')
  }
  if (!a.clientId) fallos.push('AUTH_GOOGLE_CLIENT_ID vacío')
  if (!a.clientSecret) fallos.push('AUTH_GOOGLE_CLIENT_SECRET vacío')
  if (!a.baseUrl) fallos.push('AUTH_BASE_URL vacío (p. ej. https://bebetter.itsciro.com)')
  if (a.correos.length === 0) fallos.push('AUTH_ALLOWED_EMAILS vacío: nadie podría entrar nunca')
  if (a.tokenServicio && a.tokenServicio.length < 32) {
    fallos.push('SERVICE_TOKEN de menos de 32 caracteres')
  }
  return fallos
}
