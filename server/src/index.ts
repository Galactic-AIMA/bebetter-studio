import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import cron from 'node-cron'
import { config } from './config'
import videosRouter from './routes/videos'
import imagesRouter from './routes/images'
import phrasesRouter from './routes/phrases'
import uploadRouter from './routes/upload'
import pinterestRouter from './routes/pinterest'
import imagesOutputRouter from './routes/imagesOutput'
import historyRouter from './routes/history'
import imageTagsRouter from './routes/imageTags'
import audioRouter from './routes/audio'
import logsRouter from './routes/logs'
import cadenceRouter from './routes/cadence'
import batchRouter from './routes/batch'
import aiImagesRouter from './routes/aiImages'
import carouselsRouter from './routes/carousels'
import analyticsRouter from './routes/analytics'
import devWrapRouter from './routes/devWrap'
import { collectInsights, haySnapshotDeHoy } from './services/insightsService'
import { syncBoardImages } from './services/pinterestService'
import { runCleanup } from './services/cleanupService'
import { reconciliarRechazosSeguro } from './services/queueReconcile'
import { logInfo } from './services/logService'
import { initDb } from './db'

const app = express()

app.use(cors({ origin: config.clientUrl }))
app.use(express.json())

// Servir videos generados como archivos estáticos (URL pública directa para n8n/Meta)
app.use('/output', express.static(path.resolve(config.paths.output)))

// Las tipografías salen de aquí, no del CDN de Google: el navegador tiene que
// medir el MISMO TTF que pinta FFmpeg o el corte de línea del preview y el del
// vídeo no pueden coincidir. De paso, la app deja de depender de una red externa
// para renderizar bien —que es condición para el contenedor.
app.use('/api/fonts', express.static(path.resolve(config.paths.fonts), {
  maxAge: '30d',
  setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
}))

app.use('/api/videos', videosRouter)
app.use('/api/images', imagesRouter)
app.use('/api/phrases', phrasesRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/pinterest', pinterestRouter)
app.use('/api/images-output', imagesOutputRouter)
app.use('/api/history', historyRouter)
app.use('/api/images', imageTagsRouter)
app.use('/api/audio', audioRouter)
app.use('/api/logs', logsRouter)
app.use('/api/cadence', cadenceRouter)
app.use('/api/batch', batchRouter)
app.use('/api/ai-images', aiImagesRouter)
app.use('/api/carousels', carouselsRouter)
app.use('/api/analytics', analyticsRouter)

// Verificación del wrap servidor↔navegador (Fase 0.1). Fuera de producción:
// escribe en disco y solo sirve para comprobar que los dos cortan igual.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev', devWrapRouter)
}

app.get('/api/watermark', (req, res) => {
  const wmPath = config.watermark.path
  if (!wmPath || !fs.existsSync(wmPath)) return res.status(404).json({ error: 'Watermark not configured' })
  res.sendFile(path.resolve(wmPath))
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// ─── El build de React, servido por el propio Express (Fase 3) ───────────────
//
// Cliente y API en el MISMO origen ⇒ el `baseURL: '/api'` del cliente deja de
// cruzar orígenes y **CORS desaparece**: no hay preflight que configurar ni una
// lista de orígenes que mantener a mano cada vez que cambia el dominio.
//
// Va DESPUÉS de todas las rutas `/api` a propósito: montado antes, el comodín se
// las tragaría y la API devolvería el HTML del index.
//
// Si no hay build (desarrollo, con Vite aparte en el 5173) no se monta nada y la
// app sigue sirviendo solo la API. Así el mismo `index.ts` vale en los dos sitios.
const CLIENT_DIST = process.env.CLIENT_DIST_PATH || path.join(__dirname, '../../client/dist')

if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST))

  // Comodín para el enrutado del lado del cliente: recargar en una ruta interna
  // tiene que devolver el index, no un 404. Se excluyen los prefijos que sirve el
  // servidor de verdad, porque un 404 de la API debe seguir siendo un 404 y no
  // una página HTML que el cliente no sabe interpretar.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/output') || req.path === '/health') {
      return next()
    }
    res.sendFile(path.join(CLIENT_DIST, 'index.html'))
  })

  console.log(`Cliente: sirviendo el build desde ${CLIENT_DIST}`)
} else {
  console.log('Cliente: sin build, se sirve solo la API (modo desarrollo)')
}

// El esquema ANTES de escuchar: si la base no está lista, es mejor no arrancar que
// aceptar peticiones que van a fallar una por una.
initDb().then(() => arrancar()).catch((e: any) => {
  console.error('[db] No se pudo preparar la base:', e.message)
  process.exit(1)
})

function arrancar() {
app.listen(config.port, () => {
  logInfo('system', `Servidor iniciado en http://localhost:${config.port}`)
  console.log(`Server running on http://localhost:${config.port}`)
  console.log(`Output folder: ${config.paths.output}`)
  console.log(`Images folder: ${config.paths.images}`)

  cron.schedule('0 */6 * * *', () => { runCleanup() })
  console.log('Cleanup: activo (cada 6 horas, archivos >24h)')

  // Devuelve a la rotación las frases de piezas descartadas en Telegram. Va por
  // sondeo y no por aviso porque n8n (EC2) no puede alcanzar esta app (local).
  // Se corre al arrancar además de cada 2 h: el PC no está siempre encendido, y
  // los rechazos se acumulan mientras tanto.
  reconciliarRechazosSeguro()
  cron.schedule('15 */2 * * *', () => { reconciliarRechazosSeguro() })
  console.log('Reconciliación de rechazos: activa (al arrancar y cada 2 horas)')

  // Snapshot diario de insights. De madrugada porque no compite con nada y la
  // granularidad de la serie es el día. Best-effort: si el token o la red fallan,
  // se pierde un punto de la serie, no la app.
  cron.schedule('30 4 * * *', async () => {
    try {
      const r = await collectInsights(true)
      console.log(`Insights: snapshot de ${r.ok}/${r.total} publicaciones`)
    } catch (err: any) {
      console.error('Insights: fallo al recoger —', err.message)
    }
  })
  console.log('Insights: activo (snapshot diario 4:30)')

  // Red de seguridad del cron: n8n publica con el PC apagado, pero el recolector
  // vive aquí — si la máquina no estaba encendida a las 4:30, ese día no habría
  // snapshot y el punto se perdería. Al arrancar se recoge lo que falte del día.
  // Condicionado a que no haya snapshot de hoy: si no, cada reinicio del server
  // repetiría ~60 llamadas a la Graph API sin añadir nada a la serie.
  // Encadenado y no `await`: el callback de `app.listen` es síncrono, y volverlo
  // async convertiría cualquier fallo de aquí dentro en un rechazo sin dueño.
  haySnapshotDeHoy()
    .then((hay) => {
      if (hay) {
        console.log('Insights: ya hay snapshot de hoy, no se repite al arrancar')
        return
      }
      return collectInsights(true)
        .then((r) => console.log(`Insights: snapshot de arranque, ${r.ok}/${r.total} publicaciones`))
    })
    .catch((err) => console.error('Insights (arranque): fallo al recoger —', err.message))

  // gallery-dl retirado (2026-07-26): duplicaba imágenes que la Pinterest API ya
  // baja. La sincronización queda solo por la Pinterest API v5 (abajo).
  if (config.pinterest.appId && config.pinterest.boardId) {
    console.log('Pinterest API: sincronizando al arranque...')
    syncBoardImages().then((r) => {
      console.log(`Pinterest API sync: ${r.newImages} nuevas imágenes de ${r.totalChecked} pines`)
    }).catch((err) => {
      console.error('Pinterest API sync (arranque) error:', err.message)
    })
  }
})
}

