# Agente conversacional bebetter (Telegram) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** Un agente de Telegram que responde consultas (lenguaje natural + comandos slash, texto y voz) sobre la cola de publicación de bebetter, leyendo solo el Google Sheet (Cola + config).

**Architecture:** Workflow n8n nuevo `[Agente] bebetter` con `Telegram Trigger → filtro chat → switch texto/voz → AI Agent (GPT) → Telegram`. El AI Agent usa OpenAI (`Galactic OpenAI`), Window Buffer Memory y 3 tools: leer Cola, leer cadencia, y proyectar publicaciones (Code tool con el algoritmo determinista `projectSchedule`). Entregable 2 aparte: refactor de bots para separar Agente / Publicación / Errores-infra.

**Tech Stack:** n8n (self-hosted EC2, API v1), OpenAI gpt-4o-mini, Google Gemini (transcripción audio), Google Sheets, Telegram. Scripts de mutación en Python (stdlib `urllib`), patrón backup + dry-run + `--apply` (David corre los `--apply`).

---

## Contexto y constantes (verificadas esta sesión)

| Dato | Valor |
|------|-------|
| API n8n | `https://n8n.galacticaima.com/api/v1` · key en `.n8n-key` (raíz beBetterStudio) · header `X-N8N-API-KEY` · curl con `-k` |
| Chat de David (Telegram) | `8739538908` |
| Sheet "Cola bebetter" | `1QwH2iT0t0h9mIhoHRnWO-pVXhNXwhV1mtyuvdV7kkgs` |
| gid Cola | `1637724194` · gid config | `491336242` |
| Credencial Google Sheets (n8n) | `17f89ToWBxB84qVF` |
| Credencial OpenAI (n8n) | `Galactic OpenAI` |
| Credencial Gemini (n8n) | `Galactic Gemini` |
| Credencial Telegram Agente (n8n) | **`bebetter Agente`** — la crea David |
| Credencial Telegram Publicación (n8n) | **`bebetter Publicación`** — la crea David |
| Bot actual (queda para errores infra) | `Galactic Ciro Bot` (`1GVE4jgeFSp4LWAQ`) |
| Workflows a tocar en Fase B | `[Pub]` `fRgHVl5PndZVDNa8` · `[Aprob]` `ukG6JlnUxmyGgf6H` · `[Sched]` `FOMc7gC90VOo0BGL` · `[IGToken]` `GAw1F3srZa93YAw8` |

**Moldes de referencia** (workflows existentes, para copiar estructura de nodos/connections):
- `Agent_AsistentePersonalTelegram` (`TcQIEM1w3o7r0q09`): Telegram Trigger → Switch texto/voz → getVoiceMessage → transcribe (Gemini) → AI Agent (OpenAI + Window Buffer Memory + tools). **Es el molde principal.**
- `agenteSecretario` (`RyAY428to7SgZ7w7`): AI Agent + tools nativos (Google Calendar) — molde de cómo un tool nativo se conecta por `ai_tool`.

**Tipos de nodo exactos:**
- `n8n-nodes-base.telegramTrigger`, `n8n-nodes-base.telegram`, `n8n-nodes-base.switch`, `n8n-nodes-base.if`
- `@n8n/n8n-nodes-langchain.agent`, `@n8n/n8n-nodes-langchain.lmChatOpenAi`, `@n8n/n8n-nodes-langchain.memoryBufferWindow`, `@n8n/n8n-nodes-langchain.googleGemini`
- `n8n-nodes-base.googleSheetsTool` (tool de lectura), `@n8n/n8n-nodes-langchain.toolCode` (Code tool)

**Connections especiales del AI Agent** (del molde): `OpenAI → ai_languageModel → AI Agent`; `Window Buffer Memory → ai_memory → AI Agent`; cada tool `→ ai_tool → AI Agent`. El flujo principal (`main`) entra al AI Agent desde el nodo que trae el texto.

---

# FASE A — Workflow `[Agente] bebetter` (green-field, no toca producción)

Todo vive en un script nuevo `server/scripts/create-agent-workflow.py` que arma el JSON del workflow y hace `POST /api/v1/workflows`. Dry-run por defecto; `--apply` crea el workflow (lo corre David).

### Task A1 — Esqueleto del script + helpers de API
**Archivo:** crear `server/scripts/create-agent-workflow.py`

- [ ] Cabecera con docstring (qué crea, uso `python server/scripts/create-agent-workflow.py [--apply]`).
- [ ] `KEY = open('../../.n8n-key').read().strip()`; `BASE='https://n8n.galacticaima.com/api/v1'`.
- [ ] Helper `api(method, path, data=None)` con `urllib`, header `X-N8N-API-KEY`, `ssl._create_unverified_context()` (equivalente a `curl -k`), Content-Type JSON.
- [ ] Constantes de la tabla de arriba (chat id, sheet id, gids, nombres de credencial).
- [ ] `python server/scripts/create-agent-workflow.py` corre sin error e imprime "DRY-RUN" (aún sin construir nodos).

### Task A2 — Nodo Code tool: proyección de publicaciones
**Archivo:** modificar `server/scripts/create-agent-workflow.py`

- [ ] Definir `PROJECT_JS` reusando el algoritmo de `server/scripts/add-cola-command.py` (constante `PROJECT_JS`) y de `server/src/utils/schedule.ts` (`projectSchedule`). Adaptación: en vez de leer de nodos `$('📥 Leer cola')`, el Code tool recibe la cola como **input del propio tool** — pero como el tool no tiene acceso directo al Sheet, este Code tool hace el cálculo sobre datos que le pasa el agente. **Decisión de implementación:** el Code tool NO lee el Sheet; recibe `approved` (JSON array) + `times` + `tz` como argumentos del tool (el agente los obtiene con la tool "Leer Cola"/"Leer cadencia" y se los pasa). Devuelve un **string** legible: lista `Hoy/Mañana HH:00 — <frase>`.
  - Firma del Code tool (`toolCode`, lenguaje JS): entrada `query` con `{ approvedJson, times, tz }`; salida string.
  - Reusa `tzOffsetMinutes` y el loop de asignación de franjas de `PROJECT_JS`.
- [ ] `toolDescription`: "Proyecta las próximas publicaciones. Dale approvedJson (filas approved sin publishedAt), times (cadence_times separados por coma) y tz. Devuelve la lista con día y hora."
- [ ] Verificar: el string `PROJECT_JS` es JS válido (pegar en `node -e` un smoke test con datos dummy → imprime la proyección).

### Task A3 — Tools de Google Sheets (Leer Cola + Leer cadencia)
**Archivo:** modificar `server/scripts/create-agent-workflow.py`

- [ ] Nodo `Leer Cola` (`n8n-nodes-base.googleSheetsTool`): operation `read`, documentId = Sheet id, sheetName por gid `1637724194`, credencial `17f89ToWBxB84qVF`. `toolDescription`: "Lee todas las filas de la Cola de publicación (columnas: id, phrase, status, createdAt, publishedAt, attempts, captionIG…). Úsala para contar aprobados, buscar por frase, ver atascados (status needs-attention) o últimos publicados (status published)."
- [ ] Nodo `Leer cadencia` (`googleSheetsTool`): read, gid config `491336242`, misma credencial. `toolDescription`: "Lee la config: cadence_times (horas de publicación) y timezone."
- [ ] Verificar: ambos nodos serializan a JSON sin error.

### Task A4 — Modelo, memoria y transcripción
**Archivo:** modificar `server/scripts/create-agent-workflow.py`

- [ ] Nodo `OpenAI Chat Model` (`lmChatOpenAi`): `model.value = "gpt-4o-mini"`, credencial `Galactic OpenAI` (por nombre → resolver el id, o dejar que David la enlace; ver Task A7).
- [ ] Nodo `Window Buffer Memory` (`memoryBufferWindow`): `sessionIdType=customKey`, `sessionKey = {{ $('Telegram Trigger').item.json.message.chat.id }}`, `contextWindowLength=30`.
- [ ] Nodo `transcribeVoiceMessage` (`googleGemini`): `resource=audio`, `modelId=models/gemini-2.5-flash`, `inputType=binary`, credencial `Galactic Gemini`.
- [ ] Nodo `getVoiceMessage` (`telegram`): `resource=file`, `fileId={{ $json.message.voice.file_id }}`, credencial `bebetter Agente`.

### Task A5 — Trigger, filtro de seguridad, switch texto/voz
**Archivo:** modificar `server/scripts/create-agent-workflow.py`

- [ ] Nodo `Telegram Trigger` (`telegramTrigger`): `updates=["message"]`, credencial `bebetter Agente`.
- [ ] Nodo `Solo David` (`if`): condición `{{ $json.message.chat.id }}` **equals** `8739538908` (number). Rama true sigue; false → nodo `NoOp`/nada (ignora).
- [ ] Nodo `Text or Audio` (`switch`): rama **Audio** = `{{ $json.message.voice.file_id }}` exists; rama **Text** = `{{ $json.message.text }}` exists (copiar molde exacto del asistente personal).
- [ ] Nodo `getMessage` (`set`): en la rama texto, expone `text = {{ $json.message.text }}` para uniformar con la salida de la transcripción.

### Task A6 — AI Agent + system prompt + wiring
**Archivo:** modificar `server/scripts/create-agent-workflow.py`

- [ ] Nodo `AI Agent` (`agent`): `promptType=define`, `text = {{ $json.text || $('transcribeVoiceMessage').item.json.content.parts[0].text }}`, `options.systemMessage` = **PROMPT COMPLETO** (abajo).
- [ ] Nodo `Responder` (`telegram`): sendMessage, `chatId = {{ $('Telegram Trigger').item.json.message.chat.id }}`, `text = {{ $json.output }}`, credencial `bebetter Agente`.
- [ ] `connections`:
  - `Telegram Trigger → main → Solo David`
  - `Solo David (true) → main → Text or Audio`
  - `Text or Audio [Audio] → getVoiceMessage → transcribeVoiceMessage → AI Agent (main)`
  - `Text or Audio [Text] → getMessage → AI Agent (main)`
  - `OpenAI Chat Model → ai_languageModel → AI Agent`
  - `Window Buffer Memory → ai_memory → AI Agent`
  - `Leer Cola / Leer cadencia / Proyectar → ai_tool → AI Agent`
  - `AI Agent → main → Responder`

**System prompt (systemMessage):**
```
Eres el asistente de bebetter Studio. Respondes SOLO a David, en español, breve y directo, sin florituras. La fecha/hora actual es {{ $now }} (zona America/Bogota).

Tu único dominio es la COLA DE PUBLICACIÓN de bebetter, que vive en un Google Sheet. NO inventas datos: si no está en la Cola/config, dilo. NO publicas ni modificas nada: solo consultas e informas.

Herramientas:
- "Leer Cola": trae todas las filas (id, phrase, status, createdAt, publishedAt, attempts). Estados: pending, approved, published, needs-attention.
- "Leer cadencia": trae cadence_times y timezone.
- "Proyectar publicaciones": dale las filas approved (sin publishedAt) + times + tz y te devuelve cuándo se publicará cada una (Hoy/Mañana HH:00). Úsala SIEMPRE que pregunten "qué se publica", "próximas", "cuándo sale". No calcules fechas tú.

Interpreta lenguaje natural y también estos atajos:
- /cola, /proximas → proyección de próximas publicaciones.
- /atascados → filas status = needs-attention.
- /ultimos → filas status = published, ordenadas por publishedAt desc (máx 5).
- "busca <texto>" → filas cuya phrase contenga <texto>.
- "cuántos aprobados" → cuenta status = approved.

Formato: listas cortas con viñetas. Frases largas recórtalas. Si no hay resultados, dilo en una línea.
```

- [ ] Verificar: `json.dumps(workflow)` produce un objeto con `name`, `nodes`, `connections`, `settings` (sin `active`; se activa aparte). Imprimir en dry-run el nº de nodos y las connections.

### Task A7 — POST del workflow (David corre `--apply`)
**Archivo:** modificar `server/scripts/create-agent-workflow.py`

- [ ] Sin `--apply`: imprime el JSON del workflow y "DRY-RUN — no se creó nada".
- [ ] Con `--apply`: `POST /workflows` con el JSON; imprime el `id` creado. **Nota de credenciales:** si la API rechaza credenciales por nombre, el script las omite y David las enlaza a mano en la UI (Telegram Agente, OpenAI, Gemini, Sheets en cada nodo) — documentarlo en la salida.
- [ ] **David:** corre `--apply`, enlaza credenciales faltantes en la UI si aplica, **activa** el workflow, y prueba: escribe/manda audio al bot "bebetter Agente" → "cuántos aprobados quedan", "qué se publica mañana", "/atascados".
- [ ] Verificación e2e (David): las 3 tools responden con datos reales del Sheet; la proyección coincide con el `/cola` de `[Pub]`.

---

# FASE B — Refactor de bots (cirugía en workflows activos)

Un script `server/scripts/rebot-bebetter.py` reasigna la credencial Telegram de bebetter del `Galactic Ciro Bot` al bot nuevo `bebetter Publicación`, en los 4 workflows. Backup + dry-run + `--apply`.

### Task B1 — Script de reasignación de credencial
**Archivo:** crear `server/scripts/rebot-bebetter.py`

- [ ] Helpers de API (igual que A1). Constante `NUEVA_CRED_NOMBRE = "bebetter Publicación"`; el script resuelve su `id` (o lo recibe por `--cred-id`).
- [ ] Para cada WF (`fRgHVl5PndZVDNa8`, `ukG6JlnUxmyGgf6H`, `FOMc7gC90VOo0BGL`, `GAw1F3srZa93YAw8`): `GET`, backup a `server/scripts/wf_<id>_backup_<ts>.json`, recorrer `nodes`, y en cada nodo cuyo `type` sea `telegram` o `telegramTrigger` cuya credencial actual sea el Ciro Bot, cambiar `credentials.telegramApi` a la nueva.
- [ ] Imprimir un diff por workflow (qué nodos cambian). Dry-run por defecto.

### Task B2 — Aplicar y verificar (David)
- [ ] **David** corre `rebot-bebetter.py --apply` (PUT de cada workflow).
- [ ] **David** abre el bot `bebetter Publicación` en Telegram (envía `/start` una vez para habilitar el chat).
- [ ] Verificación e2e: encolar/publicar un video de prueba → el paquete de aprobación y los avisos llegan al **bot nuevo**; tocar ✅ aprueba; `/cola` responde. Los errores de infra siguen llegando por el `Galactic Ciro Bot`.
- [ ] Confirmar que ningún workflow quedó con el trigger duplicado en el mismo token.

---

## Self-review

- **Cobertura:** NL + slash (A6 system prompt), voz (A4/A5 transcripción), texto (A5), catálogo completo /cola·/proximas·/atascados·/ultimos·buscar·contar (A2/A3/A6), solo-David (A5 filtro), refactor de bots (Fase B). ✓
- **Sin placeholders:** system prompt completo; tipos de nodo y credenciales exactas; algoritmo de proyección reusa fuente existente citada. ✓
- **Riesgos:** (1) enlace de credenciales por API — mitigado con fallback manual en A7; (2) mover el trigger de aprobaciones cambia el bot de destino — documentado en B2 (David hace `/start` en el bot nuevo); (3) mutación n8n prod bloqueada → David corre los `--apply`.
```
