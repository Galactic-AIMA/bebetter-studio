#!/usr/bin/env node
/**
 * Prueba de la puerta. Sin Google, sin base de datos, sin red.
 *
 *     node scripts/probar-puerta.js
 *
 * Comprueba lo que NO se ve al entrar bien: que una firma cambiada no pasa, que
 * una sesión caducada no pasa, y que un correo BIEN FIRMADO pero retirado de la
 * lista blanca tampoco — que es lo que hace que quitar un correo eche a esa
 * sesión en el acto y no dentro de 30 días.
 *
 * Necesita el build del servidor (`npm run build` en server/). Vale igual en la
 * VM: comprueba la lógica, no la configuración real, así que no toca el .env.
 */
process.env.AUTH_ENABLED = 'true'
process.env.AUTH_GOOGLE_CLIENT_ID = 'x.apps.googleusercontent.com'
process.env.AUTH_GOOGLE_CLIENT_SECRET = 'GOCSPX-falso'
process.env.AUTH_BASE_URL = 'https://bebetter.itsciro.com'
process.env.AUTH_ALLOWED_EMAILS = 'David.CiroOrtiz06@Gmail.com , otro@ejemplo.com'
process.env.SESSION_SECRET = 'a'.repeat(64)
process.env.SERVICE_TOKEN = 'b'.repeat(64)

const a = require('../server/dist/middleware/auth')

let fallos = 0
const comprobar = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`${ok ? 'OK  ' : 'FALLO'}  ${nombre}` + (ok ? '' : `\n        esperado ${JSON.stringify(esperado)}, salio ${JSON.stringify(real)}`))
}

// 1. La revision de arranque pasa con todo puesto
comprobar('revisarPuerta() no encuentra fallos', a.revisarPuerta(), [])

// 2. Ida y vuelta de la sesion. El correo se guarda en minusculas.
const t = a.crearSesion('david.ciroortiz06@gmail.com', 'David')
comprobar('sesion valida devuelve el correo', a.verificarSesion(t).email, 'david.ciroortiz06@gmail.com')

// 3. Un token manipulado NO pasa
const partes = t.split('.')
comprobar('firma cambiada -> null', a.verificarSesion(partes[0] + '.' + 'z'.repeat(partes[1].length)), null)
const otroCuerpo = Buffer.from(JSON.stringify({ email: 'intruso@ejemplo.com', exp: 9e9 })).toString('base64url')
comprobar('cuerpo cambiado sin refirmar -> null', a.verificarSesion(otroCuerpo + '.' + partes[1]), null)
comprobar('basura -> null', a.verificarSesion('nada'), null)
comprobar('vacio -> null', a.verificarSesion(null), null)

// 4. Caducada
const caducado = (() => {
  const crypto = require('crypto')
  const cuerpo = Buffer.from(JSON.stringify({ email: 'david.ciroortiz06@gmail.com', exp: 1 })).toString('base64url')
  return cuerpo + '.' + crypto.createHmac('sha256', process.env.SESSION_SECRET).update(cuerpo).digest('base64url')
})()
comprobar('sesion caducada -> null', a.verificarSesion(caducado), null)

// 5. Un correo BIEN FIRMADO pero fuera de la lista blanca tampoco pasa.
//    Es lo que hace que quitar un correo eche a esa sesion en el acto.
const expulsado = (() => {
  const crypto = require('crypto')
  const cuerpo = Buffer.from(JSON.stringify({ email: 'exempleado@ejemplo.com', exp: 9e9 })).toString('base64url')
  return cuerpo + '.' + crypto.createHmac('sha256', process.env.SESSION_SECRET).update(cuerpo).digest('base64url')
})()
comprobar('firmada pero fuera de la lista -> null', a.verificarSesion(expulsado), null)

// 6. Lectura de cookies del encabezado crudo
const req = { headers: { cookie: `otra=1; ${a.COOKIE_SESION}=${encodeURIComponent(t)}; z=2` } }
comprobar('leerCookie encuentra la sesion', a.leerCookie(req, a.COOKIE_SESION), t)
comprobar('leerCookie con nombre ausente', a.leerCookie(req, 'no_existe'), null)

// 7. El guardia: los tres caminos
const correr = (headers) => {
  let estado = 200, cuerpo = null, paso = false
  const res = { status(c) { estado = c; return this }, json(b) { cuerpo = b; return this } }
  const r = { headers, header: (n) => headers[n.toLowerCase()] }
  a.exigirSesion(r, res, () => { paso = true })
  return { paso, estado, tipo: r.identidad && r.identidad.tipo }
}
comprobar('sin nada -> 401', correr({}), { paso: false, estado: 401, tipo: undefined })
comprobar('con cookie buena -> pasa como persona', correr({ cookie: `${a.COOKIE_SESION}=${encodeURIComponent(t)}` }), { paso: true, estado: 200, tipo: 'persona' })
comprobar('con X-API-Key buena -> pasa como maquina', correr({ 'x-api-key': 'b'.repeat(64) }), { paso: true, estado: 200, tipo: 'maquina' })
comprobar('con X-API-Key mala -> 401', correr({ 'x-api-key': 'c'.repeat(64) }), { paso: false, estado: 401, tipo: undefined })
comprobar('con X-API-Key de otra longitud -> 401 (sin reventar)', correr({ 'x-api-key': 'corta' }), { paso: false, estado: 401, tipo: undefined })

// 8. La cookie sale con los atributos que debe
const c = a.cookieSesion('v', 100)
comprobar('cookie HttpOnly', c.includes('HttpOnly'), true)
comprobar('cookie Secure (baseUrl https)', c.includes('Secure'), true)
comprobar('cookie SameSite=Lax', c.includes('SameSite=Lax'), true)

console.log(fallos === 0 ? '\n== TODO CORRECTO ==' : `\n== ${fallos} FALLOS ==`)
process.exit(fallos === 0 ? 0 : 1)
