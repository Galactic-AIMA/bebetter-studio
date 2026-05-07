import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import fs from 'fs'
import path from 'path'

function resolvePath(envVar: string): string {
  const p = process.env[envVar]
  if (!p) throw new Error(`${envVar} no configurado en .env`)
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
}

export function createOAuthClient(): OAuth2Client {
  const credPath = resolvePath('GOOGLE_OAUTH_CREDENTIALS_PATH')
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'))
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web
  const redirectUri = (redirect_uris && redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob'
  return new google.auth.OAuth2(client_id, client_secret, redirectUri)
}

function getAuthenticatedClient(): OAuth2Client {
  const tokenPath = resolvePath('GOOGLE_OAUTH_TOKEN_PATH')
  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      'No hay token de Drive. Ejecuta: npx ts-node scripts/authorize-drive.ts'
    )
  }
  const client = createOAuthClient()
  client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf-8')))
  return client
}

export async function uploadToDrive(localPath: string, filename: string): Promise<string> {
  const auth = getAuthenticatedClient()
  const drive = google.drive({ version: 'v3', auth })

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || undefined

  const response = await drive.files.create({
    requestBody: {
      name: filename,
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(localPath),
    },
    fields: 'id,webViewLink',
  })

  await drive.permissions.create({
    fileId: response.data.id!,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return response.data.webViewLink!
}
