import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3001',

  paths: {
    images: process.env.IMAGES_PATH || path.join(__dirname, '../../data/images'),
    output: process.env.OUTPUT_PATH || path.join(__dirname, '../../output'),
    fonts: process.env.FONTS_PATH || path.join(__dirname, '../../data/fonts'),
    audio: process.env.AUDIO_PATH || path.join(__dirname, '../../data/audio'),
    db: process.env.DB_PATH || path.join(__dirname, '../../data/bebetter.db'),
  },

  aws: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    endpoint: process.env.R2_ENDPOINT || '',
    bucket: process.env.R2_BUCKET || '',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },

  webhooks: {
    test: process.env.WEBHOOK_TEST_URL || '',
    prod: process.env.WEBHOOK_PROD_URL || '',
    secret: process.env.WEBHOOK_SECRET || '',
    approval: process.env.WEBHOOK_APPROVAL_URL || '',  // n8n "Aprobación bebetter" (Fase 4) — manda el paquete a Telegram
  },

  watermark: {
    path: process.env.WATERMARK_PATH || '',
  },

  google: {
    apiKey: process.env.GOOGLE_API_KEY || '',
    // Key de un proyecto SIN billing = capa gratuita. Se usa para el trabajo por
    // lotes (banco de imágenes, audio, análisis del nicho), donde un límite de
    // peticiones solo significa "tarda más". NO se usa para contenido propio
    // —frases, guiones, copies—: en la capa gratuita Google entrena con los datos.
    apiKeyFree: process.env.GOOGLE_API_KEY_FREE || '',
    sheetId: process.env.GOOGLE_SHEET_ID || '',  // Sheet "Cola bebetter" (Fase 4) — lo crea scripts/setup-queue-sheet.ts

    // Vertex AI — ensayo de créditos Google (alta 2026-08-17, corte 2026-11-15).
    // Misma familia de modelos que AI Studio, pero autenticada por service account
    // (IAM) en vez de por clave con candado de IP: una mudanza de servidor ya no la
    // rompe. Y Vertex NO entrena con los datos, así que sirve para contenido propio.
    //
    // Verificado el 2026-08-17 con scripts/vertex-comparar-embeddings.ts:
    // `gemini-embedding-001` devuelve vectores BIT A BIT IDÉNTICOS por las dos
    // puertas (coseno 1.000000000, Δmax 0) ⇒ los embeddings ya guardados siguen
    // siendo válidos y NO hay que re-vectorizar el banco.
    //
    // Con `project` o `credentials` vacíos se cae a AI Studio: es el interruptor
    // de vuelta atrás, sin tocar código.
    //
    // ⚠️ `location`: us-central1 sirve la familia 2.5 y los embeddings (es donde se
    // validó lo de arriba). Los modelos 3.x —incluido gemini-3-pro-image— solo
    // responden en `global`. Si algún día se migran las funciones de texto, van con
    // su propia location.
    vertex: {
      project: process.env.VERTEX_PROJECT || '',
      location: process.env.VERTEX_LOCATION || 'us-central1',
      credentials: process.env.VERTEX_CREDENTIALS || '',
      // Modelos de imagen. Solo responden en `global`, NO en us-central1.
      //   gemini-3-pro-image     = Nano Banana Pro (el mismo que sirve KIE)
      //   gemini-2.5-flash-image = más rápido y barato, calidad menor
      imageLocation: process.env.VERTEX_IMAGE_LOCATION || 'global',
      imageModel: process.env.VERTEX_IMAGE_MODEL || 'gemini-3-pro-image',
      // Los modelos de texto 3.x tampoco están en us-central1: solo en `global`.
      // Los embeddings sí (y ahí es donde se validó que los vectores coinciden),
      // por eso son dos `location` distintas y no una.
      textLocation: process.env.VERTEX_TEXT_LOCATION || 'global',
    },
  },

  kie: {
    apiKey: process.env.KIE_API_KEY || '',  // KIE AI (Nano Banana Pro) — generación de imágenes IA para el banco
  },

  // Qué backend genera las imágenes IA: 'kie' (revendedor, cobra por imagen sin
  // tope) o 'vertex' (directo, con cargo a los créditos del ensayo). Cambiar esta
  // variable es todo el rollback — `kieService` se queda intacto.
  imageBackend: (process.env.IMAGE_BACKEND || 'kie') as 'kie' | 'vertex',

  pinterest: {
    appId: process.env.PINTEREST_APP_ID || '',
    appSecret: process.env.PINTEREST_APP_SECRET || '',
    boardId: process.env.PINTEREST_BOARD_ID || '',
    credentialsPath: path.resolve(
      process.env.PINTEREST_CREDENTIALS_PATH || path.join(__dirname, '../../credentials/pinterest-token.json')
    ),
  },

  galleryDl: {
    bin: process.env.GALLERY_DL_PATH || 'gallery-dl',
    boardUrl: process.env.PINTEREST_BOARD_URL || '',
    limit: parseInt(process.env.GALLERY_DL_LIMIT || '0') || 0,
  },

  // Cosecha de audio con procedencia (2026-08-18). Se queda SIEMPRE en local, y
  // es mejor así: yt-dlp contra Instagram desde una IP de datacenter se bloquea
  // mucho más que desde una residencial, la dispara David pegando links (no
  // necesita ser autónoma) y el resultado sube a R2 como una pista más. Solo
  // viaja el resultado, no la descarga.
  ytDlp: {
    bin: process.env.YTDLP_PATH || 'yt-dlp',
    // Instagram pide sesión para casi todo. `chrome`/`firefox`/`edge` lee las
    // cookies del navegador donde David ya está logueado; el fichero Netscape es
    // la alternativa si el navegador las tiene cifradas y no las suelta.
    cookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || '',
    cookiesFile: process.env.YTDLP_COOKIES_FILE || '',
  },
}
