#!/usr/bin/env bash
#
# Mide un lote real de renders en la VM, con instrumentación fina.
#
#     bash scripts/medir-lote.sh <n_piezas> <etiqueta>
#     bash scripts/medir-lote.sh 30 sin-ia
#
# Para qué existe: decidir CON DATOS si el render necesita salir de esta máquina
# a Cloud Run Jobs, o si la VM aguanta y esa fase entera se puede ahorrar.
# La pregunta NO es "¿cuál es más rápido?" sino "¿hace falta el otro carril?".
#
# ⚠️ LA BASE SE RESTAURA AL TERMINAR. Antes de empezar hace un pg_dump y al
# acabar lo restaura, así que los contadores de uso, las filas de `videos` y
# `images_output` quedan EXACTAMENTE como estaban. Dos motivos:
#   1. Estas pruebas no deben ensuciar el estado ni empujar la rotación.
#   2. Y sobre todo: las dos pruebas tienen que partir del MISMO estado, o los
#      tiempos no son comparables entre sí.
# Los MP4 que se suban a R2 NO se borran aquí: son para revisar a ojo.

set -uo pipefail

N="${1:-30}"
ETIQUETA="${2:-lote}"
DIR="/home/ubuntu/bebetter-studio"
SALIDA="/home/ubuntu/mediciones"
SELLO="$(date +%Y%m%d-%H%M%S)"
BASE="$SALIDA/$ETIQUETA-$SELLO"

cd "$DIR"
mkdir -p "$SALIDA"

echo "════════════════════════════════════════════════════════"
echo " MEDICIÓN: $ETIQUETA · $N piezas · $SELLO"
echo "════════════════════════════════════════════════════════"

# ─── 0 · Estado de partida ──────────────────────────────────────────────────
echo "[0] Guardando el estado de la base para restaurarlo al final…"
docker compose exec -T postgres pg_dump -U bebetter -d bebetter -Fc > "$BASE.antes.dump"
echo "    $(wc -c < "$BASE.antes.dump") bytes"

CONTADORES_ANTES=$(docker compose exec -T postgres psql -U bebetter -d bebetter -t -A -F'|' -c \
  "SELECT (SELECT sum(usage_count) FROM phrases), (SELECT sum(usage_count) FROM images), (SELECT sum(usage_count) FROM audio_tracks), (SELECT count(*) FROM videos);")
echo "    contadores antes (frases|imagenes|audio|videos): $CONTADORES_ANTES"

echo "[0] Configuración vigente — LA QUE VE LA APP, no la del fichero:"
# ⚠️ Se lee de DENTRO del contenedor a propósito, y se compara con el .env.
# `env_file` se lee al CREAR el contenedor, no al vuelo: editar el .env y lanzar
# la prueba sin recrear deja la app con la configuración ANTERIOR, y la medición
# sale perfectamente plausible... del sistema equivocado. Pasó el 2026-08-20 con
# IA_PRIMERO: el disco decía true, el contenedor false, y la "prueba con IA"
# generó las 30 piezas del banco. Mismo molde que el motor equivocado de la
# tanda D: un valor por defecto que no falla, elige — y elige mal en silencio.
DISCREPA=0
for V in IA_PRIMERO IA_PROPORCION IMAGE_BACKEND VERTEX_IMAGE_MODEL VERTEX_IMAGE_MODEL_REELS; do
  EN_APP=$(docker compose exec -T app sh -c "printenv $V" 2>/dev/null | tr -d "")
  EN_DISCO=$( { grep -m1 "^$V=" .env || true; } | cut -d= -f2- | tr -d "")
  if [ "$EN_APP" = "$EN_DISCO" ] || [ -z "$EN_DISCO" ]; then
    printf "    %-26s %s
" "$V" "${EN_APP:-(por defecto)}"
  else
    printf "    %-26s app=%-22s disco=%s   <-- DISCREPA
" "$V" "${EN_APP:-vacio}" "$EN_DISCO"
    DISCREPA=1
  fi
done
if [ "$DISCREPA" = "1" ]; then
  echo "" >&2
  echo "ABORTADO: la app NO tiene la configuración del .env." >&2
  echo "Recrea el contenedor y vuelve a lanzar:" >&2
  echo "    docker compose up -d --force-recreate app" >&2
  rm -f "$BASE.antes.dump"
  exit 1
fi

# ─── 1 · Muestreo de recursos en segundo plano ──────────────────────────────
# Cada 3 s. El muestreo es lo que distingue "tardó 40 min" de "tardó 40 min
# porque se quedó sin créditos de CPU en el minuto 12".
echo "[1] Arrancando el muestreo de recursos (cada 3 s)…"
{
  echo "ts_rel_s,mem_usada_mb,mem_disp_mb,swap_usada_mb,load1,app_mem_mb,app_cpu_pct,pg_mem_mb,procs_ffmpeg"
  T0=$(date +%s)
  while :; do
    AHORA=$(( $(date +%s) - T0 ))
    read -r MU MD <<< "$(free -m | awk '/^Mem:/ {print $3, $7}')"
    SW=$(free -m | awk '/^Swap:/ {print $3}')
    LOAD=$(awk '{print $1}' /proc/loadavg)
    STATS=$(docker stats --no-stream --format '{{.Name}};{{.MemUsage}};{{.CPUPerc}}' 2>/dev/null)
    APPM=$(echo "$STATS" | awk -F';' '/bebetter-app/{split($2,a,"MiB");print a[1]}' | tr -d ' ')
    APPC=$(echo "$STATS" | awk -F';' '/bebetter-app/{gsub(/%/,"",$3);print $3}' | tr -d ' ')
    PGM=$(echo "$STATS"  | awk -F';' '/bebetter-pg/{split($2,a,"MiB");print a[1]}'  | tr -d ' ')
    # `docker top` desde el HOST: la imagen slim no trae `ps` dentro, y el
    # `grep -c` sobre un "command not found" devolvia 0 siempre.
    NFF=$(docker top bebetter-app 2>/dev/null | grep -c ffmpeg || echo 0)
    echo "$AHORA,${MU:-},${MD:-},${SW:-},${LOAD:-},${APPM:-},${APPC:-},${PGM:-},${NFF:-0}"
    sleep 3
  done
} > "$BASE.recursos.csv" &
PID_MUESTREO=$!
trap 'kill $PID_MUESTREO 2>/dev/null' EXIT

# ─── 2 · Lanzar el lote ─────────────────────────────────────────────────────
# Se llama a la app DIRECTAMENTE en su puerto, sin pasar por Caddy: así el
# basic_auth no estorba y se mide el render, no el proxy.
echo "[2] Lanzando el lote de $N piezas…"
INICIO=$(date +%s)
RESP=$(docker compose exec -T app node -e "
const http=require('http');
const body=JSON.stringify({count:$N, driver:'phrases'});
const req=http.request({host:'127.0.0.1',port:3001,path:'/api/batch/run',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log(d)})});
req.on('error',e=>console.log(JSON.stringify({error:e.message})));
req.write(body);req.end();
")
echo "    respuesta: $RESP"
ID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
if [ -z "$ID" ]; then
  echo "ERROR: no se obtuvo id del lote. Respuesta: $RESP" >&2
  kill $PID_MUESTREO 2>/dev/null
  exit 1
fi
echo "    id del lote: $ID"

# ─── 3 · Sondeo del progreso ────────────────────────────────────────────────
echo "[3] Sondeando cada 10 s (Ctrl-C no cancela el lote, solo el sondeo)…"
echo "ts_rel_s,hechas,total,errores,estado" > "$BASE.progreso.csv"
ULTIMAS=-1
while :; do
  sleep 10
  REL=$(( $(date +%s) - INICIO ))
  P=$(docker compose exec -T app node -e "
const http=require('http');
http.get('http://127.0.0.1:3001/api/batch/run/$ID',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d))}).on('error',e=>console.log('{}'));
" 2>/dev/null)
  echo "$P" > "$BASE.progreso.json"
  # Se parsea el JSON de verdad y no con sed: `errores` es un ARRAY de objetos
  # ({phraseId, error}), no un numero, y un sed ingenuo devolveria vacio siempre,
  # dando por bueno un lote lleno de fallos.
  # Con python3 y NO con node: node solo existe DENTRO del contenedor, no en el
  # host de la VM. La primera version llamaba a `node` aqui, el 2>/dev/null se
  # tragaba el "command not found" y el sondeo devolvia 0,0,0,? mientras el lote
  # iba perfectamente. Un instrumento roto que dice "no pasa nada".
  # Y `errores` es un ARRAY de objetos, no un numero: hay que contar su longitud.
  LEIDO=$(printf '%s' "$P" | python3 -c "
import sys, json
try:
    j = json.load(sys.stdin)
    e = j.get('errores') or []
    print(j.get('hechas',0), j.get('planificadas',0), len(e) if isinstance(e,list) else 0, j.get('estado','?'))
except Exception:
    print(0, 0, 0, '?')",  2>/dev/null)
  read -r HECHAS TOTAL ERRORES ESTADO <<< "$LEIDO"
  echo "$REL,${HECHAS:-0},${TOTAL:-0},${ERRORES:-0},${ESTADO:-?}" >> "$BASE.progreso.csv"
  if [ "${HECHAS:-0}" != "$ULTIMAS" ]; then
    printf '    %4ds  %s/%s hechas  %s errores  [%s]\n' "$REL" "${HECHAS:-0}" "${TOTAL:-?}" "${ERRORES:-0}" "${ESTADO:-?}"
    ULTIMAS="${HECHAS:-0}"
  fi
  case "${ESTADO:-}" in terminado|completado|error|cancelado) break;; esac
  [ "$REL" -gt 7200 ] && { echo "    (tope de 2 h alcanzado, se corta el sondeo)"; break; }
done
FIN=$(date +%s)
TOTAL_S=$(( FIN - INICIO ))

kill $PID_MUESTREO 2>/dev/null

# ─── 4 · Cierre ─────────────────────────────────────────────────────────────
echo "[4] Recogiendo resultados…"
docker compose logs app --since "${TOTAL_S}s" > "$BASE.log-app.txt" 2>&1

CONTADORES_DESPUES=$(docker compose exec -T postgres psql -U bebetter -d bebetter -t -A -F'|' -c \
  "SELECT (SELECT sum(usage_count) FROM phrases), (SELECT sum(usage_count) FROM images), (SELECT sum(usage_count) FROM audio_tracks), (SELECT count(*) FROM videos);")

# Los ficheros generados, ANTES de restaurar la base (después la tabla se revierte).
docker compose exec -T postgres psql -U bebetter -d bebetter -t -A -F'|' -c \
  "SELECT filename, s3_url FROM videos WHERE created_at > to_char(now() - interval '${TOTAL_S} seconds','YYYY-MM-DD\"T\"HH24:MI:SS');" \
  > "$BASE.piezas.txt" 2>/dev/null || true

# ─── 5 · Restaurar la base ──────────────────────────────────────────────────
echo "[5] Restaurando la base al estado de partida…"
docker compose stop app >/dev/null 2>&1
docker compose exec -T postgres psql -U bebetter -d bebetter -q -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO bebetter;" >/dev/null 2>&1
docker compose exec -T postgres pg_restore -U bebetter -d bebetter --no-owner --no-privileges < "$BASE.antes.dump" >/dev/null 2>&1
docker compose start app >/dev/null 2>&1
CONTADORES_FINAL=$(docker compose exec -T postgres psql -U bebetter -d bebetter -t -A -F'|' -c \
  "SELECT (SELECT sum(usage_count) FROM phrases), (SELECT sum(usage_count) FROM images), (SELECT sum(usage_count) FROM audio_tracks), (SELECT count(*) FROM videos);")

# ─── 6 · Resumen ────────────────────────────────────────────────────────────
{
  echo "MEDICIÓN · $ETIQUETA · $SELLO"
  echo "════════════════════════════════════════════"
  echo "Piezas pedidas      : $N"
  echo "Tiempo total        : ${TOTAL_S}s  ($(( TOTAL_S / 60 )) min $(( TOTAL_S % 60 ))s)"
  echo "Progreso final      : $(tail -1 "$BASE.progreso.csv")"
  [ "${HECHAS:-0}" -gt 0 ] && echo "Segundos por pieza  : $(( TOTAL_S / HECHAS ))s"
  echo
  echo "RECURSOS (del muestreo)"
  awk -F, 'NR>1 && $2!="" {
    if ($2>maxm) maxm=$2; if ($4>maxs) maxs=$4; if ($5>maxl) maxl=$5;
    if ($6>maxapp) maxapp=$6; if ($8>maxpg) maxpg=$8; if ($9>maxff) maxff=$9;
    if (mind=="" || $3<mind) mind=$3; n++
  } END {
    printf "  muestras            : %d\n", n
    printf "  RAM usada  (pico)   : %s MB\n", maxm
    printf "  RAM disponible (min): %s MB\n", mind
    printf "  Swap usada (pico)   : %s MB\n", maxs
    printf "  load1      (pico)   : %s\n", maxl
    printf "  contenedor app (pico): %s MiB\n", maxapp
    printf "  contenedor pg  (pico): %s MiB\n", maxpg
    printf "  procesos ffmpeg (max): %s\n", maxff
  }' "$BASE.recursos.csv"
  echo
  echo "CONTADORES (frases|imagenes|audio|videos)"
  echo "  antes    : $CONTADORES_ANTES"
  echo "  después  : $CONTADORES_DESPUES"
  echo "  restaurado: $CONTADORES_FINAL"
  if [ "$CONTADORES_ANTES" = "$CONTADORES_FINAL" ]; then
    echo "  ✅ la base quedó EXACTAMENTE como estaba"
  else
    echo "  ⚠️ NO coinciden — revisar $BASE.antes.dump"
  fi
  echo
  echo "ERRORES EN EL LOG"
  grep -icE "error|exception|429|RESOURCE_EXHAUSTED|OOM|killed" "$BASE.log-app.txt" | sed 's/^/  lineas: /'
  grep -iE "429|RESOURCE_EXHAUSTED" "$BASE.log-app.txt" | wc -l | sed 's/^/  429 de Vertex: /'
  echo
  echo "FICHEROS"
  echo "  $BASE.recursos.csv"
  echo "  $BASE.progreso.csv"
  echo "  $BASE.log-app.txt"
  echo "  $BASE.piezas.txt"
  echo "  $BASE.antes.dump   (la copia con la que se restauró)"
} | tee "$BASE.resumen.txt"

echo
echo "Los MP4 siguen en R2 para revisarlos. NO se han borrado."
