import { Router } from 'express'
import crypto from 'crypto'
import { OAuth2Client } from 'google-auth-library'
import { config } from '../config'
import {
  COOKIE_ESTADO,
  COOKIE_SESION,
  cookieEstado,
  cookieSesion,
  crearSesion,
  leerCookie,
  verificarSesion,
} from '../middleware/auth'
import { logInfo, logError } from '../services/logService'

/**
 * Login de Google, restringido a una lista blanca de correos.
 *
 * Estas rutas van FUERA del guardia por necesidad: son la puerta, y una puerta
 * cerrada con llave por dentro no deja entrar a nadie.
 *
 * El `id_token` de Google se usa UNA VEZ, para saber qué correo hay al otro lado.
 * No se guarda el access token ni se pide refresh token —no llamamos a ninguna
 * API de Google en nombre del usuario—, así que no hay ningún secreto de Google
 * que custodiar ni que caduque. La sesión que viaja después es nuestra.
 */

const router = Router()

const RUTA_CALLBACK = '/auth/google/callback'

function cliente(): OAuth2Client {
  return new OAuth2Client(
    config.auth.clientId,
    config.auth.clientSecret,
    config.auth.baseUrl + RUTA_CALLBACK
  )
}

/** Manda al usuario a Google. */
router.get('/google', (req, res) => {
  if (!config.auth.activo) return res.status(404).json({ error: 'auth_desactivado' })

  // `state` contra CSRF: se guarda en una cookie de vida corta y se compara al
  // volver. Sin esto, cualquiera puede provocar que tu navegador complete un
  // login que él inició, y acabas con la sesión de OTRA cuenta sin notarlo.
  const estado = crypto.randomBytes(16).toString('hex')
  res.setHeader('Set-Cookie', cookieEstado(estado, 600))

  res.redirect(
    cliente().generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state: estado,
      // Ninguno de los dos es sensible ⇒ la pantalla de consentimiento se puede
      // publicar sin pasar la verificación de Google.
      // `select_account` para poder elegir cuenta: David tiene varias, y sin esto
      // Google reutiliza la última en silencio.
      prompt: 'select_account',
    })
  )
})

/** Vuelta de Google. Aquí se decide si entra o no. */
router.get('/google/callback', async (req, res) => {
  if (!config.auth.activo) return res.status(404).json({ error: 'auth_desactivado' })

  const rechazar = (motivo: string, detalle?: string) => {
    logError('system', `Login rechazado: ${motivo}`, detalle)
    // Se borra la cookie de estado y se vuelve a la pantalla de entrada con el
    // motivo. Un JSON crudo aquí lo vería el usuario en el navegador.
    res.setHeader('Set-Cookie', cookieEstado('', 0))
    res.redirect('/?auth=' + encodeURIComponent(motivo))
  }

  const { code, state, error } = req.query as Record<string, string | undefined>
  if (error) return rechazar('cancelado', error)
  if (!code) return rechazar('sin_codigo')

  const esperado = leerCookie(req, COOKIE_ESTADO)
  if (!esperado || !state || esperado !== state) return rechazar('estado_invalido')

  try {
    const c = cliente()
    const { tokens } = await c.getToken(code)
    if (!tokens.id_token) return rechazar('sin_id_token')

    // verifyIdToken comprueba la firma de Google, el emisor, la caducidad y que
    // el token fue emitido PARA nuestro client_id. Decodificarlo a mano sería
    // aceptar cualquier token que cualquiera fabrique.
    const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: config.auth.clientId })
    const p = ticket.getPayload()
    if (!p?.email) return rechazar('sin_correo')

    // `email_verified` importa: sin esto, una cuenta con un correo puesto a mano
    // y sin comprobar podría colarse en la lista blanca.
    if (!p.email_verified) return rechazar('correo_sin_verificar', p.email)

    const correo = p.email.toLowerCase()
    if (!config.auth.correos.includes(correo)) return rechazar('correo_no_autorizado', correo)

    res.setHeader('Set-Cookie', [
      cookieSesion(crearSesion(correo, p.name), config.auth.duracionSesionSeg),
      cookieEstado('', 0),
    ])
    logInfo('system', `Sesión iniciada: ${correo}`)
    res.redirect('/')
  } catch (e: any) {
    rechazar('fallo_google', e?.message)
  }
})

/** Quién soy. Lo consulta el cliente al arrancar para saber si pintar el login. */
router.get('/me', (req, res) => {
  if (!config.auth.activo) {
    // En local no hay puerta, y el cliente tiene que saberlo para no enseñar una
    // pantalla de login que no lleva a ninguna parte.
    return res.json({ autenticado: true, puertaActiva: false })
  }
  const s = verificarSesion(leerCookie(req, COOKIE_SESION))
  if (!s) return res.status(401).json({ autenticado: false, puertaActiva: true })
  res.json({ autenticado: true, puertaActiva: true, email: s.email, nombre: s.nombre })
})

router.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', cookieSesion('', 0))
  res.json({ ok: true })
})

export default router
