/**
 * Script de autorización OAuth2 para Google Drive.
 * Ejecutar una sola vez: npx ts-node scripts/authorize-drive.ts
 */

import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../.env') })

import { createOAuthClient } from '../src/services/driveService'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']
const PORT = 4321

async function main() {
  const client = createOAuthClient()

  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    redirect_uri: `http://localhost:${PORT}`,
  })

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
        res.end('<h2>✓ Autorización completada</h2><p>Puedes cerrar esta pestaña y volver a la terminal.</p>')
        server.close()
        resolve(code)
      }
    })

    server.listen(PORT)
  })

  const { tokens } = await client.getToken({ code, redirect_uri: `http://localhost:${PORT}` })

  const tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH!
  const resolved = path.isAbsolute(tokenPath)
    ? tokenPath
    : path.resolve(process.cwd(), tokenPath)

  fs.writeFileSync(resolved, JSON.stringify(tokens, null, 2))
  console.log('✓ Token guardado en:', resolved)
  console.log('Ya puedes usar el botón "Subir a Drive" en la app.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
