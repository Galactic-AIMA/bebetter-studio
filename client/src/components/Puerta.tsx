import { createContext, useContext, useEffect, useState } from 'react'
import axios from 'axios'
import { GoogleLogo, WarningCircle } from '@phosphor-icons/react'

/**
 * La puerta de la app.
 *
 * Pregunta a `/auth/me` quién hay al otro lado y decide entre pintar el login o
 * dejar pasar. Si el servidor dice que no hay puerta (`AUTH_ENABLED != true`, que
 * es el caso en local) deja pasar sin preguntar nada: en el PC de casa no hay
 * nada que atravesar y una pantalla de login ahí no llevaría a ningún sitio.
 */

/**
 * Quién hay dentro, para el resto de la app. Lo consume la barra lateral, que solo debe
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-sala">
        <p className="text-ui text-hueso-3">Comprobando la sesión…</p>
      </div>
    )
  }

  if (quien.autenticado) return <SesionContext.Provider value={quien}>{children}</SesionContext.Provider>

  // Estado de entrada (DESIGN.md §3: uno de los tres usos de Anton). La sala a
  // oscuras con su luz de proyector, el wordmark y una sola acción.
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-sala px-4">
      <div className="luz-proyector encender pointer-events-none absolute inset-0" aria-hidden />
      <div className="grano fixed inset-0" aria-hidden />
      <div className="relative flex w-full max-w-sm flex-col items-start gap-8">
        <h1 className="flex items-baseline gap-3">
          <span className="pt-[.16em] font-display text-[56px] leading-[.98] tracking-[.02em] text-hueso">BEBETTER</span>
          <span className="rotulo tracking-[.24em]">Studio</span>
        </h1>

        {motivo && (
          <p role="alert" className="flex items-start gap-2 text-ui text-lacre">
            <WarningCircle size={16} className="mt-0.5 shrink-0" /> {motivo}
          </p>
        )}

        <div className="flex w-full flex-col gap-3">
          <a href="/auth/google" className="btn-sec h-12 w-full gap-2 border-hueso text-body lg:h-12">
            <GoogleLogo size={18} /> Entrar con Google
          </a>
          <p className="text-ui text-hueso-3">Solo pueden entrar las cuentas autorizadas.</p>
        </div>
      </div>
    </main>
  )
}
