import { useEffect, useState } from 'react'
import { cadenceApi, ScheduleResult, EVENTO_COLA } from '../../api'
import { splitByTiempos } from '@shared/splitByTiempos'
import { dayLabel } from '../../lib/cola'

/**
 * La tira del pie del escenario: lo que sale en las próximas franjas.
 *
 * La hora de cada pieza no está guardada en ningún sitio —[Sched] drena el
 * aprobado más antiguo en cada franja—, así que es una PROYECCIÓN de
 * `/api/cadence/schedule` (posición en la cola + cadencia). Se muestra el primer
 * tiempo de la frase: es lo que se lee en el primer segundo del reel.
 */
export default function ProximasSalidas() {
  const [datos, setDatos] = useState<ScheduleResult | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    const cargar = () =>
      cadenceApi.schedule().then((d) => { setDatos(d); setFallo(false) }).catch(() => setFallo(true))
    cargar()
    // Lo que se encola desde la app avisa al momento; lo que se aprueba desde
    // Telegram no, y para eso basta con mirar cada cinco minutos.
    const t = setInterval(cargar, 5 * 60_000)
    addEventListener(EVENTO_COLA, cargar)
    return () => { clearInterval(t); removeEventListener(EVENTO_COLA, cargar) }
  }, [])

  const items = datos?.items ?? []

  return (
    <section aria-label="Próximas salidas" className="flex min-w-0 items-center gap-5">
      <p className="rotulo w-[76px] shrink-0 leading-normal">Próximas salidas</p>
      {fallo || !datos ? (
        <p className="text-ui text-hueso-3">{fallo ? 'No se pudo leer la cola.' : 'Leyendo la cola…'}</p>
      ) : items.length === 0 ? (
        <p className="text-ui text-hueso-3">La cola está vacía. Lo que apruebes saldrá en la próxima franja.</p>
      ) : (
        <ol
          className="flex min-w-0 gap-2 overflow-hidden"
          style={{ maskImage: 'linear-gradient(to right, #000 85%, transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 85%, transparent)' }}
        >
          {items.map((it) => {
            const primero = splitByTiempos(it.phrase)[0]
            return (
              <li key={it.id} className="flex w-[200px] shrink-0 items-center gap-2.5 rounded-panel p-1.5 pr-2.5">
                {it.thumbnailUrl ? (
                  <img src={it.thumbnailUrl} alt="" className="h-[78px] w-11 shrink-0 rounded-control object-cover" loading="lazy" />
                ) : (
                  <span className="h-[78px] w-11 shrink-0 rounded-control bg-s2" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="line-clamp-2 text-ui font-medium leading-snug">{primero}</p>
                  <p className="mt-1 font-mono text-meta text-hueso-3">
                    {dayLabel(it, datos.timezone)} {it.time}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
