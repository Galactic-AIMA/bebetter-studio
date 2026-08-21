import { createContext, useContext, useEffect, useState } from 'react'
import axios from 'axios'

/**
 * La puerta de la app.
 *
 * Pregunta a `/auth/me` quién hay al otro lado y decide entre pintar el login o
 * dejar pasar. Si el servidor dice que no hay puerta (`AUTH_ENABLED != true`, que
 * es el caso en local) deja pasar sin preguntar nada: en el PC de casa no hay
 * nada que atravesar y una pantalla de login ahí no llevaría a ningún sitio.
 */

/**
 * Quién hay dentro, para el resto de la app. Lo consume el Header, que solo debe
 * enseñar el botón de salir si hay de dónde salir: en local no hay puerta.
 */
const SesionContext = createContext<Quien | null>(null)
export const useSesion = () => useContext(SesionContext)

interface Quien {
  autenticado: boolean
  puertaActiva: boolean
  email?: string
  nombre?: string
}

/** Los motivos que devuelve el servidor en `?auth=`, en cristiano. */
const MOTIVOS: Record<string, string> = {
  correo_no_autorizado: 'Esa cuenta de Google no está autorizada para entrar aquí.',
  correo_sin_verificar: 'Esa cuenta de Google no tiene el correo verificado.',
  cancelado: 'Se canceló el acceso desde Google.',
  estado_invalido: 'El intento de acceso caducó o venía de otro sitio. Prueba otra vez.',
  fallo_google: 'Google devolvió un error al comprobar la identidad.',
  sin_codigo: 'Google no devolvió el código de acceso.',
  sin_id_token: 'Google no devolvió la identidad.',
  sin_correo: 'Google no devolvió ningún correo.',
}

export default function Puerta({ children }: { children: React.ReactNode }) {
  const [quien, setQuien] = useState<Quien | null>(null)
  const [motivo, setMotivo] = useState<string | null>(null)

  useEffect(() => {
    // El motivo del rechazo llega en la URL; se limpia en cuanto se lee para que
    // no se quede pegado en la barra ni sobreviva a una recarga.
    const params = new URLSearchParams(window.location.search)
    const m = params.get('auth')
    if (m) {
      setMotivo(MOTIVOS[m] || `No se pudo entrar (${m}).`)
      params.delete('auth')
      const resto = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (resto ? '?' + resto : ''))
    }

    const preguntar = () =>
      axios
        .get<Quien>('/auth/me')
        .then((r) => setQuien(r.data))
        .catch(() => setQuien({ autenticado: false, puertaActiva: true }))

    preguntar()

    // Si la sesión caduca con la app abierta, el interceptor de axios avisa por
    // aquí y se vuelve al login en vez de dejar la pantalla llena de errores que
    // no explican nada.
    const alPerderla = () => setQuien({ autenticado: false, puertaActiva: true })
    window.addEventListener('bb:sin-sesion', alPerderla)
    return () => window.removeEventListener('bb:sin-sesion', alPerderla)
  }, [])

  if (quien === null) {
    return (
      <div className="min-h-screen bg-carbon-900 flex items-center justify-center">
        <p className="text-bone-700 text-sm tracking-wide">Comprobando la sesión…</p>
      </div>
    )
  }

  if (quien.autenticado) return <SesionContext.Provider value={quien}>{children}</SesionContext.Provider>

  return (
    <div className="min-h-screen bg-carbon-900 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-carbon-800 border border-carbon-600 rounded-lg p-8 text-center">
        <h1 className="text-bone-500 text-2xl font-semibold tracking-tight">bebetter</h1>
        <p className="text-bone-700 text-sm mt-2 mb-8">Studio</p>

        {motivo && (
          <p className="text-neon-red text-sm mb-6 leading-relaxed border border-blood-500/40 bg-blood-500/10 rounded px-3 py-2">
            {motivo}
          </p>
        )}

        <a
          href="/auth/google"
          className="block w-full bg-gold-500 hover:bg-gold-600 text-carbon-900 font-medium rounded px-4 py-3 transition-colors"
        >
          Entrar con Google
        </a>

        <p className="text-bone-700 text-xs mt-6 leading-relaxed">
          Solo las cuentas autorizadas pueden entrar.
        </p>
      </div>
    </div>
  )
}
