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
import { syncBoardImages } from './services/pinterestService'
import { runCleanup } from './services/cleanupService'

const app = express()

app.use(cors({ origin: config.clientUrl }))
app.use(express.json())

// Servir videos generados como archivos estáticos (URL pública directa para n8n/Meta)
app.use('/output', express.static(path.resolve(config.paths.output)))

app.use('/api/videos', videosRouter)
app.use('/api/images', imagesRouter)
app.use('/api/phrases', phrasesRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/pinterest', pinterestRouter)
app.use('/api/images-output', imagesOutputRouter)
app.use('/api/history', historyRouter)

app.get('/api/watermark', (req, res) => {
  const wmPath = config.watermark.path
  if (!wmPath || !fs.existsSync(wmPath)) return res.status(404).json({ error: 'Watermark not configured' })
  res.sendFile(path.resolve(wmPath))
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`)
  console.log(`Output folder: ${config.paths.output}`)
  console.log(`Images folder: ${config.paths.images}`)

  cron.schedule('0 */6 * * *', () => { runCleanup() })
  console.log('Cleanup: activo (cada 6 horas, archivos >24h)')

  if (config.pinterest.appId && config.pinterest.boardId) {
    cron.schedule('0 * * * *', () => { syncBoardImages() })
    console.log('Pinterest sync: activo (cada hora)')
  }
})
