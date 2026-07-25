# Audio Matching Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Auto-asignar la pista de audio de fondo que mejor encaja (energía + mood) con cada pieza, con tagging de pistas por IA (híbrido: propone/confirma) y sin embeddings.

**Architecture:** Tabla SQLite `audio_tracks` guarda por pista `{energia 0–10, mood_category, descripcion}`. Un servicio de análisis manda una muestra de la pista a Gemini (audio input) y devuelve esas etiquetas; David las confirma en un panel. Un scorer puro (energía + mood, empate → menos usada) empareja pista↔frase reusando `phrases.nivel_energia` (0–10) y un nuevo `phrases.mood_category`. La generación individual auto-asigna la mejor pista si no se eligió una a mano.

**Tech Stack:** Express + better-sqlite3 + TypeScript (backend); `@google/generative-ai` (Gemini `gemini-3.5-flash`, audio inlineData); React + Zustand + Tailwind (frontend); FFmpeg (ya integra el audio).

**Diseño de referencia:** vault `Audio — emparejamiento por energía y mood.md`.

---

## Taxonomía de mood (enum compartido, 6)

Slugs sin acento (claves de matching); etiqueta bonita en UI:

| slug | etiqueta UI | energía típica |
|------|-------------|----------------|
| `reflexivo` | Reflexivo / íntimo | baja |
| `melancolico` | Melancólico | baja |
| `esperanzador` | Esperanzador | media |
| `motivador` | Motivador | media-alta |
| `epico` | Épico / heroico | alta |
| `tenso` | Tenso / oscuro | alta |

Energía en **0–10** (misma escala que `phrase.nivel_energia` e imágenes).

---

## Mapa de archivos

**Backend (crear):**
- `server/src/services/audioMetadata.ts` — CRUD de `audio_tracks` + merge con archivos de disco.
- `server/src/services/audioMatching.ts` — enum de mood + scorer + `pickAudioForPhrase`.

**Backend (modificar):**
- `server/src/db.ts` — tabla `audio_tracks` + columna `phrases.mood_category`.
- `server/src/services/geminiService.ts` — `analyzeAudioStructured()` + `mood_category` en el análisis de frase.
- `server/src/routes/audio.ts` — merge de metadata en `GET /`, `POST /analyze`, `PUT /:filename/tags`.
- `server/src/routes/phrases.ts` — persistir `mood_category` en `embed-all`.
- `server/src/routes/videos.ts` — auto-pick de audio en la generación.

**Frontend (modificar):**
- `client/src/api/index.ts` — `audioApi.analyze/saveTags` + tipos.
- `client/src/components/Audio/AudioTagsPanel.tsx` (crear) — panel de confirmación de tags.
- El editor de video: opción "Auto (por mood)" para el audio.

---

## FASE 1 — DB + metadata

### Tarea 1.1 — Esquema

**Modificar** `server/src/db.ts`. Añadir al bloque `db.exec(...)` de `CREATE TABLE`:

```sql
  CREATE TABLE IF NOT EXISTS audio_tracks (
    filename      TEXT PRIMARY KEY,
    energia       INTEGER,
    mood_category TEXT,
    descripcion   TEXT,
    usage_count   INTEGER DEFAULT 0,
    analyzed_at   TEXT
  );
```

Y en el array de ALTER idempotentes añadir:

```js
  `ALTER TABLE phrases ADD COLUMN mood_category TEXT`,
```

**Steps:**
- [ ] Añadir el `CREATE TABLE audio_tracks`.
- [ ] Añadir el `ALTER TABLE phrases ADD COLUMN mood_category TEXT` al loop try/catch.
- [ ] `cd server && npx tsc --noEmit` → exit 0 (arrancar el server crea la tabla).

### Tarea 1.2 — Servicio de metadata

**Crear** `server/src/services/audioMetadata.ts`:

```typescript
import db from '../db'

export interface AudioMeta {
  filename: string
  energia: number | null
  moodCategory: string | null
  descripcion: string | null
  usageCount: number
  analyzedAt: string | null
}

interface Row {
  filename: string
  energia: number | null
  mood_category: string | null
  descripcion: string | null
  usage_count: number
  analyzed_at: string | null
}

const toMeta = (r: Row): AudioMeta => ({
  filename: r.filename,
  energia: r.energia,
  moodCategory: r.mood_category,
  descripcion: r.descripcion,
  usageCount: r.usage_count,
  analyzedAt: r.analyzed_at,
})

/** Todas las filas de audio_tracks, indexadas por filename. */
export function getAllAudioMeta(): Map<string, AudioMeta> {
  const rows = db.prepare(`SELECT * FROM audio_tracks`).all() as Row[]
  return new Map(rows.map((r) => [r.filename, toMeta(r)]))
}

export function getAudioMeta(filename: string): AudioMeta | null {
  const r = db.prepare(`SELECT * FROM audio_tracks WHERE filename = ?`).get(filename) as Row | undefined
  return r ? toMeta(r) : null
}

/** Inserta/actualiza las etiquetas (mantiene usage_count si ya existía). */
export function upsertAudioMeta(
  filename: string,
  energia: number,
  moodCategory: string,
  descripcion: string
): void {
  db.prepare(
    `INSERT INTO audio_tracks (filename, energia, mood_category, descripcion, analyzed_at)
     VALUES (@filename, @energia, @mood_category, @descripcion, @analyzed_at)
     ON CONFLICT(filename) DO UPDATE SET
       energia = excluded.energia,
       mood_category = excluded.mood_category,
       descripcion = excluded.descripcion,
       analyzed_at = excluded.analyzed_at`
  ).run({
    filename,
    energia,
    mood_category: moodCategory,
    descripcion,
    analyzed_at: new Date().toISOString(),
  })
}

/** +1 al usage_count (best-effort; crea la fila si no existía). */
export function bumpAudioUsage(filename: string): void {
  const exists = db.prepare(`SELECT 1 FROM audio_tracks WHERE filename = ?`).get(filename)
  if (exists) {
    db.prepare(`UPDATE audio_tracks SET usage_count = usage_count + 1 WHERE filename = ?`).run(filename)
  } else {
    db.prepare(`INSERT INTO audio_tracks (filename, usage_count) VALUES (?, 1)`).run(filename)
  }
}
```

**Steps:**
- [ ] Crear el archivo con el código de arriba.
- [ ] `cd server && npx tsc --noEmit` → exit 0.

---

## FASE 2 — Tagging por IA (Gemini audio)

### Tarea 2.1 — `analyzeAudioStructured` en geminiService

**Modificar** `server/src/services/geminiService.ts`. Añadir al final (usa `getClient`, `withRetry` ya presentes en el módulo):

```typescript
export const MOOD_CATEGORIES = [
  'reflexivo', 'melancolico', 'esperanzador', 'motivador', 'epico', 'tenso',
] as const
export type MoodCategory = (typeof MOOD_CATEGORIES)[number]

export interface AudioAnalysis {
  energia: number        // 0–10
  moodCategory: MoodCategory
  descripcion: string    // 1-2 frases
}

const AUDIO_ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    energia: {
      type: SchemaType.NUMBER,
      description: 'Energía/intensidad de la música de 0 (muy calmada, íntima, lenta) a 10 (muy intensa, épica, rápida).',
    },
    moodCategory: {
      type: SchemaType.STRING,
      description:
        'Mood dominante. UNO de exactamente estos slugs: reflexivo (calmado, introspectivo), melancolico (triste, nostálgico), esperanzador (luminoso, positivo), motivador (impulso, decisión), epico (grandioso, heroico, triunfal), tenso (oscuro, dramático, inquietante).',
    },
    descripcion: {
      type: SchemaType.STRING,
      description: '1-2 frases en español describiendo la atmósfera de la pista (instrumentación, ritmo, sensación).',
    },
  },
  required: ['energia', 'moodCategory', 'descripcion'],
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mp3', mpeg: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
}

/**
 * Analiza una pista de audio (mood/energía) con Gemini. `audioBuffer` debe ser
 * una MUESTRA corta (~30-45s) para acotar tokens; ver el recorte en la ruta.
 */
export async function analyzeAudioStructured(
  audioBuffer: Buffer,
  ext: string
): Promise<AudioAnalysis> {
  const model = getClient().getGenerativeModel({
    model: 'gemini-3.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: AUDIO_ANALYSIS_SCHEMA as any,
    },
  })
  const mimeType = AUDIO_MIME[ext.toLowerCase().replace('.', '')] ?? 'audio/mpeg'
  const prompt = `Analiza esta pista musical instrumental (para fondo de un Reel motivacional). Devuelve su energía (0-10), su mood dominante (uno de los slugs indicados) y una descripción breve. Es música sin voz; juzga por ritmo, instrumentación y atmósfera.`

  const result = await withRetry(() =>
    model.generateContent([prompt, { inlineData: { mimeType, data: audioBuffer.toString('base64') } }])
  )
  const parsed = JSON.parse(result.response.text()) as AudioAnalysis
  // Normaliza: energía a [0,10]; mood a un slug conocido (fallback 'motivador').
  parsed.energia = Math.max(0, Math.min(10, Math.round(Number(parsed.energia) || 0)))
  if (!MOOD_CATEGORIES.includes(parsed.moodCategory)) parsed.moodCategory = 'motivador'
  return parsed
}
```

**Steps:**
- [ ] Añadir el bloque al final de `geminiService.ts`.
- [ ] `cd server && npx tsc --noEmit` → exit 0.

### Tarea 2.2 — Rutas de audio (merge + analyze + confirm)

**Modificar** `server/src/routes/audio.ts`.

1) Importes arriba:
```typescript
import { getAllAudioMeta, upsertAudioMeta } from '../services/audioMetadata'
import { analyzeAudioStructured, MOOD_CATEGORIES } from '../services/geminiService'
import { execFile } from 'child_process'
import os from 'os'
```

2) Extender el tipo y el `GET /` para incluir metadata:
```typescript
export interface AudioTrack {
  filename: string
  name: string
  energia?: number | null
  moodCategory?: string | null
  descripcion?: string | null
  analyzed?: boolean
}
```
En el handler `GET /`, tras construir la lista base, mezclar metadata:
```typescript
  const meta = getAllAudioMeta()
  const tracks: AudioTrack[] = files.map((filename) => {
    const m = meta.get(filename)
    return {
      filename,
      name: path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' '),
      energia: m?.energia ?? null,
      moodCategory: m?.moodCategory ?? null,
      descripcion: m?.descripcion ?? null,
      analyzed: !!(m && m.energia !== null && m.moodCategory),
    }
  })
```
(donde `files` es el `readdirSync(...).filter(...).sort(...)` ya existente, extraído a una const.)

3) Helper para recortar una muestra con FFmpeg (evita mandar la pista entera):
```typescript
// Extrae ~40s de muestra a mp3 mono 64k en un archivo temporal. Devuelve la ruta
// y un cleanup. Si FFmpeg falla, cae a leer el archivo completo.
function sampleAudio(src: string): Promise<{ buffer: Buffer; ext: string }> {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `bb-audio-${Date.now()}.mp3`)
    execFile(
      'ffmpeg',
      ['-y', '-t', '40', '-i', src, '-ac', '1', '-b:a', '64k', tmp],
      (err) => {
        if (err || !fs.existsSync(tmp)) {
          resolve({ buffer: fs.readFileSync(src), ext: path.extname(src) })
          return
        }
        const buffer = fs.readFileSync(tmp)
        try { fs.unlinkSync(tmp) } catch { /* ignore */ }
        resolve({ buffer, ext: '.mp3' })
      }
    )
  })
}
```

4) `POST /analyze` — analiza las pistas sin etiquetar (o `{ filenames: [...] }`); NO persiste todavía, devuelve propuestas para que David confirme:
```typescript
// POST /api/audio/analyze  { filenames?: string[] }  → propuestas (no persiste)
router.post('/analyze', async (req, res) => {
  const dir = path.resolve(config.paths.audio)
  if (!fs.existsSync(dir)) return res.json({ proposals: [] })
  const all = fs.readdirSync(dir).filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
  const meta = getAllAudioMeta()
  const requested: string[] | undefined = Array.isArray(req.body?.filenames) ? req.body.filenames : undefined
  const targets = (requested ?? all).filter((f) => all.includes(f) && (requested || !meta.get(f)?.moodCategory))

  const proposals: any[] = []
  const errors: string[] = []
  for (const filename of targets) {
    try {
      const { buffer, ext } = await sampleAudio(path.join(dir, filename))
      const a = await analyzeAudioStructured(buffer, ext)
      proposals.push({ filename, ...a })
      await new Promise((r) => setTimeout(r, 200))
    } catch (e: any) {
      errors.push(`${filename}: ${e.message}`)
    }
  }
  res.json({ proposals, errors })
})
```

5) `PUT /:filename/tags` — confirma/edita (persiste):
```typescript
// PUT /api/audio/:filename/tags  { energia, moodCategory, descripcion }
router.put('/:filename/tags', (req, res) => {
  const safe = path.basename(req.params.filename)
  const energia = Math.max(0, Math.min(10, Math.round(Number(req.body?.energia))))
  const moodCategory = String(req.body?.moodCategory || '')
  const descripcion = String(req.body?.descripcion || '')
  if (!Number.isFinite(energia)) return res.status(400).json({ error: 'energia inválida' })
  if (!MOOD_CATEGORIES.includes(moodCategory as any)) {
    return res.status(400).json({ error: `moodCategory debe ser uno de: ${MOOD_CATEGORIES.join(', ')}` })
  }
  upsertAudioMeta(safe, energia, moodCategory, descripcion)
  res.json({ success: true })
})
```

**Steps:**
- [ ] Extraer `files` a una const en `GET /` y mezclar metadata.
- [ ] Añadir `sampleAudio`, `POST /analyze`, `PUT /:filename/tags`.
- [ ] `cd server && npx tsc --noEmit` → exit 0.
- [ ] Probar analyze con curl: `curl -s -X POST localhost:3001/api/audio/analyze -H "Content-Type: application/json" -d '{}'` → propuestas con energia/moodCategory por pista.

---

## FASE 3 — Matching + moodCategory de frase

### Tarea 3.1 — `mood_category` en el análisis de frase

**Modificar** `server/src/services/geminiService.ts`:
- En `PhraseAnalysis` añadir `moodCategory: string`.
- En `PHRASE_ANALYSIS_SCHEMA.properties` añadir (y a `required`):
```typescript
    moodCategory: {
      type: SchemaType.STRING,
      description: 'Mood dominante de la frase. UNO de: reflexivo, melancolico, esperanzador, motivador, epico, tenso.',
    },
```
- Al final de `analyzePhraseStructured`, antes del `return`, normalizar:
```typescript
  const out = JSON.parse(result.response.text()) as PhraseAnalysis
  if (!MOOD_CATEGORIES.includes(out.moodCategory as any)) out.moodCategory = 'motivador'
  return out
```
(cambiar el `return JSON.parse(...)` actual por esto).

**Modificar** `server/src/routes/phrases.ts` en `embed-all`:
- En el `UPDATE phrases SET ...` añadir `mood_category = @mood_category`.
- En `update.run({...})` añadir `mood_category: analysis.moodCategory`.

**Steps:**
- [ ] Editar el schema + interface + normalización en geminiService.
- [ ] Editar el UPDATE de `embed-all`.
- [ ] `cd server && npx tsc --noEmit` → exit 0.

### Tarea 3.2 — Scorer `audioMatching.ts`

**Crear** `server/src/services/audioMatching.ts`:

```typescript
import db from '../db'
import { getAllAudioMeta } from './audioMetadata'

const ENERGY_WEIGHT = 0.7
const MOOD_WEIGHT = 0.3
const SCORE_EPSILON = 0.05 // dentro de este margen, desempata la menos usada

export interface AudioCandidate {
  filename: string
  score: number
  energia: number
  moodCategory: string | null
  usageCount: number
}

/** Score pista↔frase: cercanía de energía (0–10) + coincidencia de mood. */
export function scoreAudio(
  phraseEnergia: number | null,
  phraseMood: string | null,
  audioEnergia: number | null,
  audioMood: string | null
): number {
  const eA = typeof phraseEnergia === 'number' ? phraseEnergia : 5
  const eB = typeof audioEnergia === 'number' ? audioEnergia : 5
  const energyScore = 1 - Math.abs(eA - eB) / 10 // 0..1
  const moodScore = phraseMood && audioMood && phraseMood === audioMood ? 1 : 0
  return ENERGY_WEIGHT * energyScore + MOOD_WEIGHT * moodScore
}

/**
 * Elige la mejor pista para una frase. Solo considera pistas etiquetadas
 * (con energia y mood). Empate dentro de ε → la menos usada. Devuelve null si
 * no hay pistas etiquetadas.
 */
export function pickAudioForPhrase(phraseId: string): AudioCandidate | null {
  const p = db.prepare(
    `SELECT nivel_energia, mood_category FROM phrases WHERE id = ?`
  ).get(phraseId) as { nivel_energia: number | null; mood_category: string | null } | undefined
  if (!p) return null

  const meta = [...getAllAudioMeta().values()].filter(
    (m) => m.energia !== null && m.moodCategory
  )
  if (meta.length === 0) return null

  const cands: AudioCandidate[] = meta.map((m) => ({
    filename: m.filename,
    score: scoreAudio(p.nivel_energia, p.mood_category, m.energia, m.moodCategory),
    energia: m.energia as number,
    moodCategory: m.moodCategory,
    usageCount: m.usageCount,
  }))
  cands.sort((a, b) => {
    if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score
    return a.usageCount - b.usageCount
  })
  return cands[0]
}
```

**Steps:**
- [ ] Crear el archivo.
- [ ] `cd server && npx tsc --noEmit` → exit 0.

### Tarea 3.3 — Auto-pick en la generación individual

**Modificar** `server/src/routes/videos.ts`, en el handler `POST /generate`. Antes de llamar a `generateVideo(config, ...)`, si no hay pista elegida y llega `phraseId`:

```typescript
import { pickAudioForPhrase } from '../services/audioMatching'
import { bumpAudioUsage } from '../services/audioMetadata'
// ...
// Auto-pick de audio por mood si el usuario no eligió pista (o eligió 'auto').
if ((!config.audioTrack || config.audioTrack === 'auto') && phraseId) {
  const pick = pickAudioForPhrase(phraseId)
  config.audioTrack = pick ? pick.filename : undefined
}
if (config.audioTrack) bumpAudioUsage(config.audioTrack)
```

**Steps:**
- [ ] Localizar el `POST /generate` y el punto donde se arma `config`/`phraseId`.
- [ ] Insertar el auto-pick antes de `generateVideo`.
- [ ] `cd server && npx tsc --noEmit` → exit 0.

---

## FASE 4 — Frontend

### Tarea 4.1 — API cliente

**Modificar** `client/src/api/index.ts`. Extender `AudioTrack` y `audioApi`:

```typescript
export interface AudioTrack {
  filename: string
  name: string
  energia?: number | null
  moodCategory?: string | null
  descripcion?: string | null
  analyzed?: boolean
}
export interface AudioProposal {
  filename: string
  energia: number
  moodCategory: string
  descripcion: string
}
export const audioApi = {
  list: () => api.get<AudioTrack[]>('/audio').then((r) => r.data),
  analyze: (filenames?: string[]) =>
    api.post<{ proposals: AudioProposal[]; errors: string[] }>('/audio/analyze', { filenames }).then((r) => r.data),
  saveTags: (filename: string, energia: number, moodCategory: string, descripcion: string) =>
    api.put(`/audio/${encodeURIComponent(filename)}/tags`, { energia, moodCategory, descripcion }).then((r) => r.data),
}
```

**Steps:**
- [ ] Reemplazar la definición actual de `AudioTrack`/`audioApi`.
- [ ] Typecheck cliente.

### Tarea 4.2 — Panel de tags (híbrido: propone/confirma)

**Crear** `client/src/components/Audio/AudioTagsPanel.tsx`: modal accesible desde un botón 🎵 en el Header (junto a ⏰/📜).

- Lista las pistas (`audioApi.list()`), badge "sin etiquetar" para las que no tienen mood.
- Botón "Analizar sin etiquetar" → `audioApi.analyze()` → llena un estado editable de propuestas.
- Cada fila: nombre + slider energía (0–10) + `<select>` de mood (las 6 categorías, con etiqueta bonita) + descripción (input) + botón "Guardar" → `audioApi.saveTags(...)`.
- Constante local `MOODS = [{slug:'reflexivo',label:'Reflexivo / íntimo'}, ...]` (las 6).

**Steps:**
- [ ] Crear el componente con lista + analyze + edición + guardar por fila.
- [ ] Añadir el botón 🎵 y el estado `showAudio` en `Header.tsx`.
- [ ] Typecheck cliente.

### Tarea 4.3 — Opción "Auto (por mood)" en el editor de audio

En la sección "Audio de fondo" del editor (donde hoy se elige `audioTrack`), añadir una opción **"Auto (por mood)"** que fija `config.audioTrack = 'auto'`. El backend (Tarea 3.3) la resuelve a la mejor pista al generar.

**Steps:**
- [ ] Añadir la opción "Auto (por mood)" al selector de audio.
- [ ] Typecheck cliente.

---

## FASE 5 — Verificación e2e

- [ ] Levantar server + client (`npm run dev`).
- [ ] Abrir panel 🎵 → "Analizar sin etiquetar" → las 11 pistas reciben propuesta de energía/mood.
- [ ] Ajustar 1-2 que no convenzan y Guardar; verificar que `GET /api/audio` las devuelve como `analyzed`.
- [ ] Re-correr `embed-all` con `{force:true}` (una vez) para poblar `phrases.mood_category`. Verificar con SQL que hay `mood_category` no nulo.
- [ ] Generar un video individual de una frase reflexiva con audio "Auto" → confirmar (log/BD) que eligió una pista de energía baja / mood cercano, y que el MP4 trae ese audio (ffprobe).
- [ ] Generar una frase épica → confirmar que elige otra pista (mayor energía).
- [ ] Commit: `feat: emparejamiento de audio por energía + mood (fundación) + tagging IA`.

---

## Riesgos / notas
- **Gemini audio input:** confirmar en la Fase 2 que `gemini-3.5-flash` acepta `inlineData` de audio; si no, probar `gemini-2.5-flash`/otro que sí. La muestra de 40s acota tokens.
- **FFmpeg para la muestra:** `sampleAudio` cae al archivo completo si FFmpeg falla (no bloquea).
- **Escala de energía:** audio y frase ambos en 0–10 → comparación directa.
- **Fiabilidad del mood:** por eso el flujo es híbrido (David confirma). Verificable con 11 pistas.
- **`embed-all force`** re-analiza TODAS las frases (127) para poblar `mood_category` — costo bajo pero es una corrida; hacerla una vez.

## Links
- Diseño: vault `Audio — emparejamiento por energía y mood.md`.
- Fase que lo consume después: vault `Rediseño Batch — selección y emparejamiento.md`.
