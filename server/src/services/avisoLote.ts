import axios from 'axios'
import { config } from '../config'
import type { TrabajoLote } from './batchRunner'
import { logError } from './logService'

/**
 * Avisos de progreso de un lote hacia n8n (y de ahí a Telegram).
 *
 * Existe porque `POST /api/batch/run` es asíncrono: devuelve 202 y el render
 * sigue por su cuenta durante minutos —27 con IA para 30 piezas—. Desde la app se
 * ve la barra de progreso, pero quien lanza el lote desde Telegram se queda a
 * ciegas: «lanzado» y silencio hasta que se acuerda de preguntar.
 *
 * Aquí el sentido de la llamada se invierte: la app EMPUJA los avisos en vez de
 * que n8n tenga que sondear. Un sondeo desde n8n costaría un workflow colgado
 * media hora, y n8n no es el sitio donde dejar cosas esperando.
 *
 * Todo es best-effort: un fallo de red, un webhook mal puesto o n8n caído **no
 * pueden tumbar un lote de 30 piezas**. Se registra y se sigue.
 */

/** Cada cuántas piezas se avisa. Con 30 piezas son ~4 avisos, no 30. */
const CADA = 8

/** Y como suelo de tiempo: si el lote es corto, no se avisa a mitad de nada. */
const MINIMO_PARA_PROGRESO = 6

export type MomentoAviso = 'inicio' | 'progreso' | 'fin'

function resumen(t: TrabajoLote) {
  return {
    loteId: t.id,
    estado: t.estado,
    pedidas: t.pedidas,
    planificadas: t.planificadas,
    hechas: t.hechas,
    errores: t.errores.length,
    empezado: t.empezado,
    terminado: t.terminado ?? null,
  }
}

export function avisar(trabajo: TrabajoLote, momento: MomentoAviso, origen?: string): void {
  const url = config.webhooks.lote
  if (!url) return

  // Sin await y sin devolver la promesa: quien llama está en mitad del bucle de
  // render y no debe esperar a una red ajena. El .catch() es obligatorio — una
  // promesa rechazada sin dueño tumba el proceso de Node.
  axios
    .post(
      url,
      { momento, origen: origen ?? 'app', ...resumen(trabajo) },
      {
        timeout: 10_000,
        headers: config.webhooks.secret ? { 'X-Webhook-Secret': config.webhooks.secret } : undefined,
      }
    )
    .catch((e: any) => {
      logError('generate', `Aviso de lote (${momento}) no salió`, e?.message)
    })
}

/**
 * ¿Toca avisar tras esta pieza? Cada `CADA` piezas, y nunca en lotes cortos —
 * para 3 reels, el aviso de inicio y el de fin ya lo cuentan todo.
 *
 * La última NO avisa aquí: le corresponde el aviso de 'fin', y si no se excluyera
 * llegarían dos mensajes seguidos diciendo casi lo mismo.
 */
export function tocaAvisar(hechas: number, planificadas: number): boolean {
  if (planificadas < MINIMO_PARA_PROGRESO) return false
  if (hechas >= planificadas) return false
  return hechas > 0 && hechas % CADA === 0
}
