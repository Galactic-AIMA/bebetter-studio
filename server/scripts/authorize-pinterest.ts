/**
 * Script de autorización OAuth2 para Pinterest API v5.
 * Ejecutar una sola vez: npm run authorize:pinterest --workspace=server
 */

import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import axios from 'axios'
import { URLSearchParams } from 'url'

dotenv.config({ path: path.join(__dirname, '../.env') })

const PORT = 4322
const SCOPES = 'boards:read,pins:read,offline_access'

async function main() {
  const appId = process.env.PINTEREST_APP_ID
  const appSecret = process.env.PINTEREST_APP_SECRET
  const credentialsPath =
    process.env.PINTEREST_CREDENTIALS_PATH || './credentials/pinterest-token.json'

  if (!appId || !appSecret) {
    console.error('Error: Faltan PINTEREST_APP_ID o PINTEREST_APP_SECRET en el .env')
    process.exit(1)
  }

  const redirectUri = `http://localhost:${PORT}`
  const state = Math.random().toString(36).substring(2)

  const authUrl =
    `https://www.pinterest.com/oauth/` +
    `?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${SCOPES}` +
    `&state=${state}`

  console.log('\n─────────────────────────────────────────────────')
  console.log('Abre esta URL en el navegador:')
  console.log('\n' + authUrl)
  console.log('\n─────────────────────────────────────────────────')
  console.log('Esperando autorización en http://localhost:' + PORT + ' ...\n')

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.end('<h2>Error: ' + error + '</h2><p>Puedes cerrar esta pestaña.</p>')
        server.close()
        reject(new Error('Autorización denegada: ' + error))
        return
      }

      if (code) {
        res.end(
          '<h2>✓ Autorización completada</h2><p>Puedes cerrar esta pestaña y volver a la terminal.</p>'
        )
        server.close()
        resolve(code)
      }
    })

    server.listen(PORT)
  })

  const credentials = Buffer.from(`${appId}:${appSecret}`).toString('base64')

  const response = await axios.post(
    'https://api.pinterest.com/v5/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  )

  const token = { ...response.data, issued_at: Date.now() }

  const resolved = path.isAbsolute(credentialsPath)
    ? credentialsPath
    : path.resolve(process.cwd(), credentialsPath)

  const dir = path.dirname(resolved)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(resolved, JSON.stringify(token, null, 2))
  console.log('✓ Token guardado en:', resolved)
  console.log('\nPróximo paso: encuentra tu board ID en:')
  console.log('  http://localhost:3001/api/pinterest/boards')
  console.log('\nLuego agrega PINTEREST_BOARD_ID=<id> a tu .env y reinicia el servidor.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
