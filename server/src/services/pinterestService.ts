import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { config } from '../config'
import { analyzeImage } from './geminiService'

interface PinterestToken {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  issued_at: number
  scope: string
}

interface Pin {
  id: string
  media?: {
    images?: {
      '150x150'?: { url: string; width: number; height: number }
      '400x300'?: { url: string; width: number; height: number }
      '600x'?: { url: string; width: number }
      '1200x'?: { url: string; width: number }
    }
    media_type?: string
  }
}

interface SyncEntry {
  timestamp: string
  newImages: number
  totalChecked: number
  status: 'success' | 'error'
  error?: string
}

interface SyncData {
  downloadedPinIds: string[]
  lastSync: SyncEntry | null
}

export interface SyncResult {
  newImages: number
  totalChecked: number
  status: 'success' | 'error'
  error?: string
}

const SYNC_DATA_PATH = path.join(__dirname, '../../../data/pinterest-sync.json')

function loadToken(): PinterestToken {
  const tokenPath = config.pinterest.credentialsPath
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Token de Pinterest no encontrado en ${tokenPath}. Ejecuta: npm run authorize:pinterest`)
  }
  return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'))
}

function saveToken(token: PinterestToken): void {
  const tokenPath = config.pinterest.credentialsPath
  const dir = path.dirname(tokenPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2))
}

function loadSyncData(): SyncData {
  if (!fs.existsSync(SYNC_DATA_PATH)) {
    return { downloadedPinIds: [], lastSync: null }
  }
  return JSON.parse(fs.readFileSync(SYNC_DATA_PATH, 'utf-8'))
}

function saveSyncData(data: SyncData): void {
  fs.writeFileSync(SYNC_DATA_PATH, JSON.stringify(data, null, 2))
}

async function refreshAccessToken(): Promise<PinterestToken> {
  const token = loadToken()
  const credentials = Buffer.from(
    `${config.pinterest.appId}:${config.pinterest.appSecret}`
  ).toString('base64')

  const response = await axios.post(
    'https://api.pinterest.com/v5/oauth/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      scope: 'boards:read,pins:read,offline_access',
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  )

  const refreshed: PinterestToken = { ...response.data, issued_at: Date.now() }
  saveToken(refreshed)
  return refreshed
}

async function getValidToken(): Promise<string> {
  const token = loadToken()
  // Refresh if expires within 5 minutes
  const expiresAt = token.issued_at + token.expires_in * 1000 - 5 * 60 * 1000
  if (Date.now() >= expiresAt) {
    const refreshed = await refreshAccessToken()
    return refreshed.access_token
  }
  return token.access_token
}

async function fetchAllBoardPins(boardId: string, accessToken: string): Promise<Pin[]> {
  const pins: Pin[] = []
  let bookmark: string | null | undefined = undefined

  do {
    const params: Record<string, string> = { page_size: '100' }
    if (bookmark) params.bookmark = bookmark

    const response = await axios.get(`https://api.pinterest.com/v5/boards/${boardId}/pins`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
    })

    pins.push(...(response.data.items ?? []))
    bookmark = response.data.bookmark ?? null
  } while (bookmark)

  return pins
}

function getBestImageUrl(pin: Pin): string | null {
  const images = pin.media?.images
  if (!images) return null
  return (
    images['1200x']?.url ||
    images['600x']?.url ||
    images['400x300']?.url ||
    images['150x150']?.url ||
    null
  )
}

function getExtension(url: string): string {
  const match = url.split('?')[0].match(/\.([a-zA-Z]+)$/)
  return match ? match[1].toLowerCase() : 'jpg'
}

async function downloadImage(url: string, destPath: string): Promise<void> {
  const response = await axios.get(url, { responseType: 'stream' })
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath)
    response.data.pipe(writer)
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

export async function syncBoardImages(): Promise<SyncResult> {
  if (!config.pinterest.appId || !config.pinterest.boardId) {
    return { newImages: 0, totalChecked: 0, status: 'error', error: 'Pinterest no configurado' }
  }

  const syncData = loadSyncData()

  try {
    const accessToken = await getValidToken()
    const allPins = await fetchAllBoardPins(config.pinterest.boardId, accessToken)
    const newPins = allPins.filter((p) => !syncData.downloadedPinIds.includes(p.id))

    let downloaded = 0
    for (const pin of newPins) {
      const imageUrl = getBestImageUrl(pin)
      if (!imageUrl) continue

      const ext = getExtension(imageUrl)
      const filename = `pinterest_${pin.id}.${ext}`
      const destPath = path.join(config.paths.images, filename)

      await downloadImage(imageUrl, destPath)
      syncData.downloadedPinIds.push(pin.id)
      downloaded++
      // Analizar en background
      analyzeImage(destPath).then((tags) => {
        const metaPath = path.join(__dirname, '../../../data/images-metadata.json')
        const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {}
        meta[filename] = { tags, analyzedAt: new Date().toISOString() }
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      }).catch(() => {})
    }

    const result: SyncResult = { newImages: downloaded, totalChecked: allPins.length, status: 'success' }
    syncData.lastSync = { timestamp: new Date().toISOString(), ...result }
    saveSyncData(syncData)

    console.log(`[Pinterest] Sync: ${downloaded} nuevas de ${allPins.length} pines`)
    return result
  } catch (err: any) {
    const result: SyncResult = { newImages: 0, totalChecked: 0, status: 'error', error: err.message }
    syncData.lastSync = { timestamp: new Date().toISOString(), ...result }
    saveSyncData(syncData)
    console.error('[Pinterest] Error en sync:', err.message)
    return result
  }
}

export function getSyncStatus() {
  const isConfigured = !!(config.pinterest.appId && config.pinterest.boardId)
  const syncData = loadSyncData()
  return { isConfigured, lastSync: syncData.lastSync }
}

export async function listUserBoards() {
  const accessToken = await getValidToken()
  const response = await axios.get('https://api.pinterest.com/v5/boards', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return response.data.items ?? []
}
