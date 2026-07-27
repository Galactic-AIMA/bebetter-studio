# Auditoría de insights de @bebetter.path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** Pasar de "publicar" a **decidir con datos**: saber qué contenido rindió, y sobre todo **por qué** — cruzando el rendimiento real de cada publicación con la *receta* que la produjo (frase, mood, imagen, audio, estilo, formato). Después, extender el mismo análisis a las cuentas del nicho.

**Architecture:** Todo por **Graph API propia** (sin ELT de terceros — se evaluó Windsor.ai y se descartó para la cuenta propia: cobra por un token que ya tenemos rotando en el Sheet). Los insights aterrizan en `data/bebetter.db` como **serie temporal**, se unen con las tablas de producción que ya existen (`videos`, `carousels`, `phrases`, `images`) y se consumen en un **panel de analítica** dentro de la app.

**Tech Stack:** Node + TS (server), `better-sqlite3`, `graph.instagram.com` (cuenta propia, token del Sheet) + `graph.facebook.com` (nicho, Page token de n8n), `node-cron`, Gemini (visión + audio, ya en uso), FFmpeg (ya en uso), React (panel).

**Decisión de David (2026-07-26):** vía = **Graph API propia**; consumo = **panel en la app**.

---

## Contexto y constantes (verificadas)

| Dato | Valor |
|------|-------|
| IG User ID (@bebetter.path) | `17841425527150540` |
| Host cuenta propia | `graph.instagram.com/v21.0` — **Instagram Login** |
| Token IG | Sheet `config` → `ig_access_token` (rotado semanalmente por `[IGToken]`) |
| Page ID FB | `1058087370724713` (`Bebetter.path`) |
| Page token (permanente) | credencial n8n `Facebook Graph API Ciro` (`1vlAzOHMeLysGufG`) — **no está en `server/.env`** |
| App de Meta | `bebetterAutomatization` (permisos hoy: `pages_manage_posts`, `pages_read_engagement`) |
| DB | `data/bebetter.db` |
| Sheet | `1QwH2iT0t0h9mIhoHRnWO-pVXhNXwhV1mtyuvdV7kkgs` · Cola gid `1637724194` · `ColaCarruseles` gid `6995674` · config gid `491336242` |
| Workflows que publican | `[Pub]` `fRgHVl5PndZVDNa8` (58 nodos) · `[Sched]` `FOMc7gC90VOo0BGL` · `[SchedCarrusel]` `C2c3luiE1MIVtsMQ` |

**Tablas existentes que ya guardan la "receta"** (esto es el activo — no hay que crearlo):

| Tabla | Columnas útiles para el cruce |
|---|---|
| `videos` | `phrase_id`, `style`, `font`, `effect`, `resolution`, `mode`, `viral`, `config_extra` (JSON: `imageId`, `audioTrack`), `s3_url`, `created_at` |
| `carousels` | `tipo`, `aspect`, `slides_json` (roles + textos + símbolos), `fuente_json`, `status` |
| `phrases` | `mood_category`, `nivel_energia`, `paleta`, `descripcion_mood`, `author` |
| `images` | `analysis_json` (elementos, temas, paleta, composición), `origen` (`ia` \| banco) |
| `audio_tracks` | energía, `mood_category`, descripción |

**Restricción clave descubierta:** `business_discovery` (el endpoint del nicho) **exige Instagram API with Facebook Login** + página vinculada + permisos `instagram_basic` e `instagram_manage_insights`. El token de Instagram Login que usa la app **no sirve** para eso. Por eso el nicho es una fase aparte y condicionada.

---

## Fase 0 — Desbloqueo del nicho (verificación, ~5 min)

**No bloquea las fases 1–4.** Se hace pronto solo porque define si la Fase 5 existe.

1. Con el Page token: `GET /v25.0/1058087370724713?fields=instagram_business_account`
   - Devuelve un id → @bebetter.path **está vinculada** a la página ⇒ el nicho es viable.
   - No devuelve nada → hay que vincular la cuenta IG a la página desde la app de Instagram, o el nicho vuelve al cajón.
2. Comprobar el `followers_count` de la cuenta. **Meta oculta varias métricas (demografía sobre todo) por debajo de 100 seguidores** — condiciona qué se puede prometer en el panel.
3. Si (1) sale bien: añadir `instagram_basic` + `instagram_manage_insights` a la app `bebetterAutomatization` y regenerar el Page token.

**Verificación:** una llamada `business_discovery` de prueba contra un @username cualquiera devuelve datos.

---

## Fase 1 — El eslabón perdido: `media_id` de vuelta a la DB ⭐

> **Es lo urgente.** Hoy publicamos y perdemos el vínculo: `[Pub]`/`[SchedCarrusel]` conocen el `media_id` en el momento de publicar y no se lo devuelven a la app. Cada día sin esto es un dato que después solo se puede reconstruir a mano.

### 1.1 Tabla `publications`
```sql
CREATE TABLE publications (
  media_id TEXT PRIMARY KEY,      -- id de IG (o de YT/FB)
  platform TEXT NOT NULL,         -- 'instagram' | 'youtube' | 'facebook'
  permalink TEXT,
  media_type TEXT,                -- REELS | CAROUSEL_ALBUM | IMAGE
  published_at TEXT NOT NULL,
  video_id TEXT,                  -- FK → videos.id     (nullable)
  carousel_id TEXT,               -- FK → carousels.id  (nullable)
  queue_id TEXT,                  -- fila del Sheet, para reconciliar
  caption TEXT
);
```
Columna idempotente (mismo patrón que `images.origen` / `carousels.fuente_json`).

### 1.2 Capturar el id en los tres caminos
| Camino | Cómo |
|---|---|
| **Express de carrusel** (`POST /:id/publish`) | `instagramService` ya recibe el media id → insert directo. Trivial. |
| **`[Pub]`** (reels: express + cola) | El nodo `📝 Marcar publicado` ya hace un update del Sheet con `status`+`publishedAt` → **añadir `mediaId` y `permalink` a ese mismo update**. Sin webhook de vuelta, sin tocar los 58 nodos. |
| **`[SchedCarrusel]`** | Igual: `📝 Marcar publicado` gana las dos columnas. |

Luego un `syncPublicationsFromSheet()` en la app lee las filas `published` y rellena `publications`. La app ya lee ambas colas (`readQueueRows`, `readCarouselQueueRows`).

> ⚠️ Todo nodo Sheets `appendOrUpdate` creado por script necesita `columns.schema` explícito (lección de `[IGToken]`). Los `update` no lo exigen.

### 1.3 Backfill de lo ya publicado
Script `server/scripts/backfill-publications.ts` (dry-run / `--apply`): recorre `GET /me/media` y empareja con `videos`/`carousels` por **timestamp cercano + similitud del caption/frase**. Lo que no case con confianza se deja sin vincular y se reporta — **nunca adivinar** (un cruce equivocado envenena todo el análisis posterior).

**Verificación:** publicar una pieza de prueba y ver la fila en `publications` con su permalink; el backfill reporta cuántas emparejó y cuántas dejó fuera.

---

## Fase 2 — Recolector de insights

`server/src/services/insightsService.ts`:
- Lee el token del Sheet (`readConfigMap()`, ya existe).
- `GET /me/media` → para cada media, `GET /{media-id}/insights?metric=…`.
- **Set de métricas por tipo** (reels, carrusel e imagen no exponen lo mismo). Ojo con las deprecaciones de v21 (ene-2025): `impressions` para no-Reels, `profile_views`, `website_clicks` y `video_views` ya no existen — se consolidó en `views`. Construir sobre el vocabulario nuevo, no sobre el viejo.
- **Guardar snapshots fechados**, no un valor único:

```sql
CREATE TABLE media_insights (
  media_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  metrics_json TEXT NOT NULL,     -- crudo, tal cual lo devuelve la API
  PRIMARY KEY (media_id, captured_at)
);
```

**Por qué serie temporal y no un valor:** los números crecen con el tiempo, y a nivel cuenta la API solo conserva **90 días**. Guardando snapshots, (a) el histórico propio es ilimitado, y (b) se puede medir **velocidad** — cuánto pegó en las primeras 24 h —, que es mejor señal que el total acumulado, porque no penaliza a lo recién publicado.

Cron diario en `index.ts` (ya hay `node-cron` para Pinterest y cleanup). Best-effort, con `logService` (`LogCategory += 'insights'`).

**Verificación:** correr el recolector a mano, ver filas en `media_insights`; correrlo dos veces el mismo día no duplica (PK compuesta).

---

## Fase 3 — El cruce: rendimiento ↔ receta

`server/src/services/analyticsService.ts` — la consulta que une `publications` + último `media_insights` + `videos`/`carousels` + `phrases`/`images`/`audio_tracks`.

**Métricas derivadas, normalizadas por alcance** (comparar totales entre piezas con distinta exposición no dice nada):
- `saves / reach` — el mejor proxy de "esto merece guardarse"
- `shares / reach` — el que más correlaciona con alcance nuevo
- `engagement_rate`, `follows / reach`
- `velocidad_24h` — del snapshot más cercano a las 24 h

**Dimensiones de agrupación** (todas ya existen): `mood_category` y `nivel_energia` de la frase · `origen` de la imagen (IA vs banco) · `style` / `effect` / `font` del render · `mood` de la pista de audio · formato (reel / carrusel / imagen) · `tipo` y `fuente_json` del carrusel · día y hora de publicación.

**Verificación:** endpoint `GET /api/analytics/summary` devuelve el ranking y los agregados; contrastar 2-3 piezas contra lo que muestra la app de Instagram a mano.

---

## Fase 4 — Panel en la app

Cuarto modo junto a Video / Imagen / Carrusel (o pestaña en el LeftPanel):
1. **Ranking de piezas** — miniatura, frase, métricas normalizadas, link al permalink.
2. **Agregados por dimensión de receta** — qué mood rinde, IA vs banco, carrusel vs reel, franja horaria.
3. **Curva de velocidad** de una pieza (de los snapshots).

> **Honestidad estadística — requisito, no adorno.** Con pocas publicaciones, cualquier diferencia entre grupos es ruido. Cada agregado muestra el **N** al lado, y por debajo de un umbral (~5 piezas por grupo) el panel dice *"datos insuficientes"* en vez de pintar un ganador. El panel sirve para **acumular y luego decidir**, no para justificar corazonadas la primera semana. El indicador `videos.viral` (marcado a mano) queda como contraste entre intuición y dato.

---

## Fase 5 — Nicho (condicionada a la Fase 0)

`business_discovery` con el Page token, por cada @username:
`business_discovery.username(X){followers_count,media_count,media{caption,like_count,comments_count,media_type,media_url,permalink,timestamp}}`

Enriquecimiento con lo que ya está montado (ver la sección siguiente). Reutiliza `analyzeImageStructured` y la taxonomía de 6 moods, para que las cuentas del nicho queden descritas **en el mismo vocabulario** que el contenido propio — sin eso, la comparación no es comparación.

Esto es lo que destraba los **formatos virales** congelados en la v1.8 del roadmap.

---

## Cómo se "ve" el contenido (percepción)

### Contenido propio — no hay que ver nada
La app **produjo** cada pieza: frase, imagen, audio, estilo y efecto ya están en la DB. El "hook" **es** la frase (o su primera mitad si lleva `//`), el "estilo" ya está clasificado (`mood_category`, `nivel_energia`), el caption vive en la cola. Es información de producción, no de percepción: **más fiable que mirar el video**. Lo único que falta es el `media_id` — la Fase 1.

### Contenido del nicho — sí hay que ver, y se puede automatizar
`business_discovery` da `media_url`, así que la cadena es:

| Qué queremos | Cómo se obtiene | ¿Existe ya? |
|---|---|---|
| Caption, tipo, likes, comments, fecha | Directo de la API | — |
| Imagen de fondo, elementos, paleta, composición | Frame → `analyzeImageStructured` (Gemini vision) | ✅ en uso |
| **Hook** (texto en pantalla de los primeros segundos) | FFmpeg extrae frames 0–3 s → Gemini lee el texto incrustado | ✅ FFmpeg + visión |
| Guion completo / voz en off | Descargar el mp4 → transcribir con **Gemini audio input** | ✅ verificado en la fundación de audio |
| Tono (más duro / más empático) | Gemini clasifica caption + transcripción con la **taxonomía de 6 moods** ya existente | ✅ |
| Estructura y ritmo (nº de cortes, duración) | FFmpeg (detección de escenas, `ffprobe`) | ✅ |

**Sin pantallazos y sin asistencia manual.** Lo único que necesito de ti: la Fase 0 (el Page token no está en el repo) y **la lista de @usernames**.

**Dos límites honestos:**
1. **La canción/audio original de un reel ajeno no se puede identificar por API** — no hay campo de audio track en `business_discovery`, y reconocer la pista (tipo Shazam) es otro problema. Si te importa saber qué audios usan, eso sí es revisión manual.
2. **Nada de Stories de terceros** — no son accesibles.

Para una revisión **cualitativa puntual** de un reel concreto (tuyo o ajeno) tengo además el MCP `claude-video-vision`, que ve el video directamente. Sirve para "mira este reel y dime por qué funciona", no para procesar cien en lote — eso es la cadena de arriba.

**Uso de la media ajena:** se descarga para análisis privado y las URLs de Meta son temporales. Ni se republica ni se reusa el material; solo se extraen atributos.

---

## Riesgos y límites conocidos

| Riesgo | Mitigación |
|---|---|
| **N pequeño** → conclusiones falsas | Umbral de N en el panel; empezar a recolectar ya aunque el panel llegue después |
| Métricas ocultas con <100 seguidores | Verificar en Fase 0 y ajustar lo que se promete |
| Deprecaciones de Meta (v21) | Guardar `metrics_json` **crudo**: si cambia el vocabulario, se re-interpreta sin perder histórico |
| Backfill emparejando mal | No adivinar: lo dudoso se reporta sin vincular |
| El token IG del Sheet caduca | Ya lo rota `[IGToken]` (arreglado 2026-07-26) |
| Rate limits de `business_discovery` | Lote diario pequeño, cachear en DB, no re-consultar lo ya analizado |

## Orden de ejecución

**1 → 2 → 0 → 3 → 4 → 5.** La Fase 1 es la única con coste de oportunidad diario. La 0 se puede colar en cualquier hueco (son 5 minutos y depende de David).

## Links

- Vault: [[2026-07-26 — Fix badge en slides + evaluación Windsor.ai]] (evaluación de Windsor y por qué se descartó para la cuenta propia)
- Vault: [[Análisis de cuentas del nicho — diseño en curso]] (diseño previo de la Fase 5)
- Roadmap: sección *Analítica y estrategia de contenido*
