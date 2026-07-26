import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

// Cliente de KIE AI (Nano Banana Pro) — generación de imágenes async.
// Replica el flujo probado en el skill carrusel-bebetter (kie_generate.py):
// createTask → polling de recordInfo → URL del resultado.
// Doc API: POST /api/v1/jobs/createTask + GET /api/v1/jobs/recordInfo?taskId=

const BASE = 'https://api.kie.ai'
const MODEL = 'nano-banana-pro'

export type KieAspect = '9:16' | '4:5' | '1:1' | '16:9' | '3:4'

export interface KieGenerateOptions {
  prompt: string
  aspectRatio?: KieAspect
  resolution?: '1K' | '2K' | '4K'
  outputFormat?: 'png' | 'jpeg'
  imageInput?: string | string[]  // URL(s) de referencia (consistencia entre slides)
}

function getKey(): string {
  if (!config.kie.apiKey) {
    throw new Error('KIE_API_KEY no está configurada en el .env del servidor')
  }
  return config.kie.apiKey
}

function authHeaders() {
  return { Authorization: `Bearer ${getKey()}`, 'Content-Type': 'application/json' }
}

async function createTask(opts: KieGenerateOptions): Promise<string> {
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio ?? '9:16',
    resolution: opts.resolution ?? '2K',
    output_format: opts.outputFormat ?? 'png',
  }
  if (opts.imageInput) {
    input.image_input = Array.isArray(opts.imageInput) ? opts.imageInput : [opts.imageInput]
  }

  const { data } = await axios.post(
    `${BASE}/api/v1/jobs/createTask`,
    { model: MODEL, input },
    { headers: authHeaders(), timeout: 60_000 }
  )
  if (data?.code !== 200 || !data?.data?.taskId) {
    throw new Error(`KIE createTask falló: ${JSON.stringify(data)}`)
  }
  return data.data.taskId as string
}

// Espera a que la tarea termine. KIE suele tardar 40–100s por imagen.
async function pollResult(taskId: string, timeoutMs = 300_000, intervalMs = 5_000): Promise<string> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await axios.get(`${BASE}/api/v1/jobs/recordInfo`, {
      params: { taskId },
      headers: authHeaders(),
      timeout: 60_000,
    })
    const info = data?.data ?? {}
    const state = info.state
    if (state === 'success') {
      const parsed = JSON.parse(info.resultJson)
      const url = parsed?.resultUrls?.[0]
      if (!url) throw new Error(`KIE terminó sin resultUrls: ${info.resultJson}`)
      return url as string
    }
    if (state === 'fail') {
      throw new Error(`KIE generación falló: ${info.failMsg || info.failCode || 'sin detalle'}`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`KIE timeout tras ${Math.round(timeoutMs / 1000)}s (taskId ${taskId})`)
}

// Descarga la imagen resultante a disco. User-Agent para evitar el 403 del CDN.
export async function downloadImage(url: string, outPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 120_000,
  })
  fs.writeFileSync(outPath, Buffer.from(res.data))
}

// Genera una imagen y devuelve la URL del resultado (aún no descargada).
export async function generateImage(opts: KieGenerateOptions): Promise<string> {
  const taskId = await createTask(opts)
  return pollResult(taskId)
}
