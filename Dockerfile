# beBetterStudio — imagen única, dos entrypoints (decisión 6 del diseño 2026-08-16).
#
# La MISMA imagen sirve la app en la VM y —cuando llegue la Fase 4— el render por
# lotes en Cloud Run Jobs. Se cambia el comando, no la imagen, para que el render
# del editor y el del lote salgan SIEMPRE del mismo digest y no puedan divergir.
# Por eso también la VM es x86 y no ARM: una imagen multi-arch no comparte digest
# entre arquitecturas, y esa garantía se perdería.
#
# ⚠️ LA BASE ES `trixie`, NO `bookworm`, Y NO ES INTERCAMBIABLE.
# El texto de los reels lo pinta `drawtext` de FFmpeg, y el kerning depende de que
# FFmpeg esté compilado con libharfbuzz. Verificado el 2026-08-19:
#     debian:bookworm-slim → ffmpeg 5.1.9  SIN libharfbuzz   ❌
#     debian:trixie-slim   → ffmpeg 7.1.5  CON libharfbuzz   ✅
#     local de David       → ffmpeg 8.0.1  CON libharfbuzz   ✅
# Sin harfbuzz el texto sale ~0,15 % más ancho de lo que midió el servidor: mismo
# corte de línea, pero la composición se mueve respecto a TODO lo ya publicado.
# `node:22-slim` a secas resuelve hoy a bookworm ⇒ hay que decir `trixie` explícito.

# ─────────────────────────────────────────────────────────────────────────────
# Etapa 1 — build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-trixie-slim AS build

WORKDIR /app

# `better-sqlite3` es un módulo NATIVO y hay que compilarlo. Sigue haciendo falta
# aunque la app corra sobre Postgres: `server/src/db.ts` abre la instancia de
# SQLite al cargar el módulo, pase lo que pase con DB_ENGINE.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Los manifiestos primero: mientras no cambien, Docker reutiliza la capa de
# dependencias y el build no vuelve a descargar nada.
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY . .

# client: `tsc && vite build` → client/dist
# server: `tsc`               → server/dist
# El cliente importa `@shared` desde `server/src/text`, así que las dos partes
# tienen que estar presentes en el mismo contexto de build. Lo están.
#
# ⚠️ EL HEAP, A MANO. V8 dimensiona su heap por defecto a partir de la RAM que ve,
# y en la VM (t3.small, 1,9 GB) le sale tan pequeño que el `vite build` del
# cliente muere con "Reached heap limit — JavaScript heap out of memory".
# Verificado el 2026-08-19: sin esto el build falla en la VM con exit code 134,
# y en el portátil pasa sin enterarse — el fallo solo aparece donde importa.
# Ojo al detalle que despista: el swap NO lo salva. V8 se mata al llegar a SU
# tope lógico, no cuando se acaba la RAM física, así que el swap ni se toca
# (14 MB usados de 2 GB en el intento fallido). Lo que hace falta es subir el
# tope; el swap solo sirve para que subirlo no reviente la máquina.
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build

# Fuera las dependencias de desarrollo ANTES de copiar node_modules al runtime.
# Se poda aquí y no allí porque los binarios nativos ya están compilados contra
# esta misma base: recompilarlos en el runtime obligaría a arrastrar g++ a la
# imagen final.
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Etapa 2 — runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-trixie-slim AS runtime

# ffmpeg  → el render (con libharfbuzz, ver arriba)
# fontconfig → FFmpeg resuelve familias por nombre además de por ruta
# ca-certificates → HTTPS hacia Vertex, R2, la Graph API y n8n
# tini → PID 1 de verdad: reenvía SIGTERM y entierra a los zombis que deja ffmpeg
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg fontconfig ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -version | grep -q 'enable-libharfbuzz' \
      || (echo 'FATAL: este ffmpeg NO trae libharfbuzz — el texto saldria mas ancho' && exit 1)

ENV NODE_ENV=production

WORKDIR /app

# Dependencias ya compiladas y podadas. Build y runtime comparten base (misma
# glibc, misma arquitectura), así que los binarios nativos se copian tal cual.
# Solo el node_modules de la RAÍZ: npm workspaces hoistea ahí las dependencias
# de los dos paquetes, y `server/node_modules` no llega a existir.
COPY --from=build /app/node_modules       ./node_modules
COPY --from=build /app/server/dist        ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/dist        ./client/dist

# HORNEADO A PROPÓSITO: las tipografías y la marca de agua.
# Las fuentes son las MISMAS que sirve la app en /api/fonts y las que pinta
# FFmpeg. Si viajaran por volumen, un despliegue podría quedarse sin ellas y el
# texto cambiaría de forma sin que nada avisara.
COPY --from=build /app/data/fonts     ./data/fonts
COPY --from=build /app/data/watermark ./data/watermark

# ⚠️ LO QUE NO SE HORNEA NUNCA: `VERTEX_CREDENTIALS` y demás secretos. Van
# montados (ver docker-compose.yml). Una clave dentro de la imagen viaja a todos
# los sitios a los que viaje la imagen y no se puede rotar sin reconstruir.

# `data/` debe existir y ser escribible: db.ts abre ahí el fichero SQLite aunque
# el motor real sea Postgres, y mediaStore baja a disco lo que FFmpeg necesita
# como fichero real.
RUN mkdir -p /app/data /app/output /app/credentials \
 && chown -R node:node /app/data /app/output /app/credentials

# Sin root. El proceso no necesita privilegios y un contenedor con FFmpeg
# procesando ficheros de terceros es justo donde no se quiere UID 0.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]

# Entrypoint 1 (por defecto): la app.
# Entrypoint 2 (Fase 4): el Job de Cloud Run sobreescribirá el comando con el
# worker de render. Misma imagen, mismo digest, otro `command`.
CMD ["node", "server/dist/index.js"]
