# BeBetter Studio

Herramienta interna para generar contenido visual (videos y posts) para la marca **BeBetter**. Toma frases motivacionales e imágenes de fondo y produce videos 9:16 listos para Reels/Shorts, o imágenes estáticas para posts e historias.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Generación | FFmpeg (fluent-ffmpeg) |
| Estado | Zustand |
| Storage | AWS S3 · Google Drive |
| Automatización | n8n webhooks |
| Imágenes | Pinterest sync |

## Estructura del proyecto

```
contentCreator/
├── client/          # Frontend React + Vite
│   └── src/
│       ├── components/
│       │   ├── BatchGenerator/   # Generación por lotes
│       │   ├── ImageBank/        # Banco de imágenes
│       │   ├── PhraseBank/       # Banco de frases
│       │   ├── Preview/          # Canvas preview en tiempo real
│       │   └── VideoEditor/      # Panel de controles de estilo
│       ├── hooks/
│       │   └── usePresets.ts     # Presets guardados en localStorage
│       ├── pages/
│       │   └── Editor.tsx        # Página principal
│       ├── presets.ts            # Definición de estilos visuales
│       ├── store/
│       │   └── videoStore.ts     # Estado global (Zustand)
│       └── types/
│           └── index.ts
└── server/          # Backend Express
    └── src/
        ├── routes/
        │   ├── images.ts         # Banco de imágenes
        │   ├── imagesOutput.ts   # Imágenes generadas
        │   ├── phrases.ts        # Banco de frases
        │   ├── pinterest.ts      # Sync Pinterest
        │   ├── upload.ts         # Upload de imágenes
        │   └── videos.ts         # Videos generados
        ├── schemas.ts            # Zod validation schemas
        ├── services/
        │   ├── cleanupService.ts # Auto-limpieza de archivos >24h
        │   ├── driveService.ts   # Google Drive OAuth2
        │   ├── imageGenerator.ts # Generación de imágenes (FFmpeg)
        │   ├── pinterestService.ts
        │   ├── queueService.ts   # Cola serial para FFmpeg
        │   ├── s3Service.ts      # AWS S3
        │   ├── videoGenerator.ts # Generación de videos (FFmpeg)
        │   └── webhookService.ts # n8n webhooks
        └── types/
            └── index.ts
```

## Instalación

**Requisitos:** Node.js 18+, FFmpeg instalado y en el PATH.

```bash
# Instalar dependencias
cd server && npm install
cd ../client && npm install
```

### Variables de entorno

Crea `server/.env` basándote en `server/.env.example`:

```env
PORT=3001
CLIENT_URL=http://localhost:5173
PUBLIC_BASE_URL=http://localhost:3001

# Rutas
OUTPUT_PATH=./output
IMAGES_PATH=./data/images
FONTS_PATH=./data/fonts

# AWS S3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET_NAME=

# Google Drive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/oauth2callback
DRIVE_FOLDER_ID=

# n8n Webhooks
WEBHOOK_URL_TEST=
WEBHOOK_URL_PROD=

# Watermark
WATERMARK_PATH=

# Pinterest (opcional)
PINTEREST_APP_ID=
PINTEREST_APP_SECRET=
PINTEREST_BOARD_ID=
```

### Google Drive

```bash
cd server && npx tsx scripts/authorize-drive.ts
```

Sigue el flujo OAuth en el navegador. El token se guarda en `credentials/drive-token.json`.

## Desarrollo

```bash
# Terminal 1 — servidor
cd server && npm run dev

# Terminal 2 — cliente
cd client && npm run dev
```

El cliente corre en `http://localhost:5173` con proxy al servidor en `3001`.

## Funcionalidades

### Modo Video / Imagen
Toggle en la parte superior del preview. En modo **Video** genera MP4 (9:16 o 1:1). En modo **Imagen** genera JPG estático. Si la frase contiene `//` como separador, el modo imagen ofrece tres variantes: combinada, solo hook, solo remate.

### Estilos visuales
6 presets que aplican fuente, tamaño, color, alineación y posición vertical en un clic:

| Preset | Fuente | Notas |
|--------|--------|-------|
| BeBetter | Montserrat Bold | Default de la marca |
| Serene | Playfair Bold | Suave, beige, sin sombra |
| Raw | RobotoCondensed Bold | Crudo, izquierda, parte baja |
| Minimal | Lato Regular | Pequeño, gris, sin sombra |
| Cinematic | Oswald Bold | Grande, dramático |
| Bold | Montserrat Bold | Amarillo, impactante |

### Efectos de texto (solo video)
- **Fade in** — el texto aparece con fade en el primer segundo
- **Deslizar arriba** — sube 60px en los primeros 0.8s con fade
- **Glow pulse** — borde blanco que pulsa al ritmo de una onda sinusoidal

### Presets guardados
Guarda la configuración de estilo actual con un nombre personalizado. Se persisten en `localStorage`. Aplicar un preset preserva la imagen y la frase activas.

### Generación por lotes
Tab **Lotes**: selecciona múltiples frases e imágenes con checkboxes. Genera uno por uno con barra de progreso. Las imágenes se ciclan si hay menos que frases. Respeta el modo activo (video/imagen) y toda la config de estilo.

### Watermark
Logo de BeBetter superpuesto en cualquiera de las 4 esquinas. Configurable con `WATERMARK_PATH` en `.env`. Visible en el preview canvas y en el output final.

### Resolución
- **9:16 Vertical** — 1080×1920 (Reels, Shorts, Stories)
- **1:1 Cuadrado** — 1080×1080 (feed de Instagram)

### Grano cinematográfico
Filtro FFmpeg `noise=alls=8:allf=t` (ruido temporal). Actívalo con el checkbox en el editor.

### Flujo de publicación
1. Generar video/imagen
2. **Subir a Drive** — sube el archivo a Google Drive y registra la URL
3. **Publicar** — sube a S3 y dispara el webhook de n8n (ambiente test o prod)

## Servicios internos

### Queue Service
Garantiza que solo corra un proceso FFmpeg a la vez. Las peticiones concurrentes (especialmente del generador por lotes) se encolan y ejecutan serialmente.

### Cleanup Service
Cron cada 6 horas. Elimina archivos en `output/` con más de 24 horas de antigüedad y sincroniza los registros JSON. Los archivos ya subidos a Drive/S3 no se eliminan del storage externo.

### Zod Validation
Los endpoints `POST /api/videos/generate` y `POST /api/images-output/generate` validan el body con Zod. Errores de schema devuelven `400` con el campo exacto que falló.

## Datos

Los datos de la aplicación se guardan localmente en `data/`:

```
data/
├── phrases.json          # Banco de frases
├── videos.json           # Registro de videos generados
├── images-output.json    # Registro de imágenes generadas
├── images-usage.json     # Contador de uso por imagen
├── images/               # Imágenes de fondo
├── fonts/                # Fuentes TTF personalizadas
└── pinterest-sync.json   # Estado del último sync de Pinterest
```

## Fuentes personalizadas

Coloca archivos `.ttf` en `data/fonts/` con el nombre exacto del preset:

```
Montserrat-Bold.ttf
Montserrat-Regular.ttf
Playfair-Bold.ttf
Lato-Regular.ttf
Oswald-Bold.ttf
RobotoCondensed-Bold.ttf
```

Si no existe la fuente, cae en fallbacks de Windows (`arialbd.ttf`, `georgiab.ttf`, etc.).
