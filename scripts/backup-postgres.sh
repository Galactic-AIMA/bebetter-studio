#!/usr/bin/env bash
#
# Copia de seguridad de Postgres a R2 — 14 diarias + 1 mensual.
#
#     bash scripts/backup-postgres.sh
#
# Sirve en los dos sitios; el contenedor se detecta solo (o se fuerza con
# CONTENEDOR_PG):
#     · en la VM   → bebetter-pg
#     · en local   → bebetter-pg-dev
#
# ⚠️ Una copia que nunca se ha restaurado NO es una copia. Este script comprueba
# que el volcado se puede LEER (`pg_restore --list`) y que trae las tablas que
# deben estar, antes de subirlo. No es una restauración completa, pero descarta
# el fallo habitual: un fichero truncado o vacío que nadie mira hasta que hace
# falta, que es el día en que ya da igual.

set -euo pipefail

DIR_RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR_RAIZ"

# ─── Dónde está Postgres ────────────────────────────────────────────────────
if [ -n "${CONTENEDOR_PG:-}" ]; then
  PG="$CONTENEDOR_PG"
elif docker ps --format '{{.Names}}' | grep -qx 'bebetter-pg'; then
  PG=bebetter-pg
elif docker ps --format '{{.Names}}' | grep -qx 'bebetter-pg-dev'; then
  PG=bebetter-pg-dev
else
  echo "ERROR: no encuentro ningún contenedor de Postgres en marcha." >&2
  echo "Contenedores vivos: $(docker ps --format '{{.Names}}' | tr '\n' ' ')" >&2
  exit 1
fi

# ─── Credenciales ───────────────────────────────────────────────────────────
# Del .env de al lado. No se imprimen nunca.
# `server/.env` PRIMERO y `.env` después: en el PC de David los dos existen, y el
# de la raíz es un duplicado obsoleto (sin Vertex ni Postgres) que solo leen dos
# scripts como respaldo. En la VM solo existe `.env`, que sí es el bueno.
ENV_FILE=""
for F in server/.env .env; do [ -f "$F" ] && ENV_FILE="$F" && break; done
[ -z "$ENV_FILE" ] && { echo "ERROR: no encuentro .env ni server/.env" >&2; exit 1; }

# El '|| true' NO es decorativo. Con 'set -euo pipefail', un grep que no encuentra
# la clave devuelve 1, el pipe entero devuelve 1, y la asignacion VAR=$(leer X)
# aborta el script ENTERO — antes de imprimir una sola linea, asi que sale con
# codigo 1 y en silencio. Paso con POSTGRES_USER, que esta en el .env de la VM
# pero no en el de local (alli el usuario va dentro de DATABASE_URL).
# Aqui no encontrar una clave es NORMAL: para eso hay valores por defecto.
leer() { { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null || true; } | cut -d= -f2- | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'; }

PGUSER=$(leer POSTGRES_USER); PGUSER=${PGUSER:-bebetter}
PGDB=$(leer POSTGRES_DB);     PGDB=${PGDB:-bebetter}

export AWS_ACCESS_KEY_ID=$(leer R2_ACCESS_KEY_ID)
export AWS_SECRET_ACCESS_KEY=$(leer R2_SECRET_ACCESS_KEY)
R2_ENDPOINT=$(leer R2_ENDPOINT)
R2_BUCKET=$(leer R2_BUCKET)
export AWS_DEFAULT_REGION=auto

for V in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET; do
  [ -z "${!V}" ] && { echo "ERROR: falta $V en $ENV_FILE" >&2; exit 1; }
done

r2() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }

# ─── El volcado ─────────────────────────────────────────────────────────────
HOY=$(date +%F)
MES=$(date +%Y-%m)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FICHERO="$TMP/bebetter-$HOY.dump"

echo "Volcando $PGDB desde $PG …"
# -Fc: formato comprimido y restaurable tabla a tabla con pg_restore.
docker exec "$PG" pg_dump -U "$PGUSER" -d "$PGDB" -Fc > "$FICHERO"

BYTES=$(wc -c < "$FICHERO")
echo "  $BYTES bytes"

# ─── La comprobación, ANTES de subir ────────────────────────────────────────
# Un volcado de 0 bytes o truncado se sube igual de bien que uno bueno, y solo se
# descubre el día que hace falta restaurar.
if [ "$BYTES" -lt 100000 ]; then
  echo "ERROR: el volcado ocupa $BYTES bytes, demasiado poco. No se sube." >&2
  exit 1
fi

TABLAS=$(docker exec -i "$PG" pg_restore --list < "$FICHERO" 2>/dev/null | grep -c "TABLE DATA" || true)
echo "  $TABLAS tablas con datos"
if [ "${TABLAS:-0}" -lt 8 ]; then
  echo "ERROR: solo $TABLAS tablas con datos (se esperan 8 o más). No se sube." >&2
  exit 1
fi

for T in phrases images audio_tracks videos; do
  if ! docker exec -i "$PG" pg_restore --list < "$FICHERO" 2>/dev/null | grep -q " $T "; then
    echo "ERROR: falta la tabla '$T' en el volcado. No se sube." >&2
    exit 1
  fi
done
echo "  comprobado: se lee y trae las tablas clave"

# ─── Subida ─────────────────────────────────────────────────────────────────
echo "Subiendo a R2 …"
r2 s3 cp "$FICHERO" "s3://$R2_BUCKET/backups/diario/bebetter-$HOY.dump" --only-show-errors
echo "  diario/bebetter-$HOY.dump"

# La mensual es la PRIMERA del mes: se escribe una vez y no se pisa, así que el
# 1 de cada mes queda congelado aunque el script corra los 30 días.
if ! r2 s3 ls "s3://$R2_BUCKET/backups/mensual/bebetter-$MES.dump" >/dev/null 2>&1; then
  r2 s3 cp "$FICHERO" "s3://$R2_BUCKET/backups/mensual/bebetter-$MES.dump" --only-show-errors
  echo "  mensual/bebetter-$MES.dump  (primera del mes)"
fi

# ─── Rotación: 14 diarias ───────────────────────────────────────────────────
# Se borran por POSICIÓN en la lista ordenada, no por fecha del objeto: si el
# script no corre unos días, se conservan las 14 últimas que existen de verdad
# en vez de dejar el hueco sin cubrir.
echo "Rotando (se conservan 14 diarias) …"
DIARIAS=$(r2 s3 ls "s3://$R2_BUCKET/backups/diario/" | awk '{print $4}' | grep -E '^bebetter-.*\.dump$' | sort)
TOTAL=$(printf '%s\n' "$DIARIAS" | grep -c . || true)
SOBRAN=$(( TOTAL - 14 ))
if [ "$SOBRAN" -gt 0 ]; then
  printf '%s\n' "$DIARIAS" | head -n "$SOBRAN" | while read -r OBJ; do
    [ -z "$OBJ" ] && continue
    r2 s3 rm "s3://$R2_BUCKET/backups/diario/$OBJ" --only-show-errors
    echo "  borrada $OBJ"
  done
else
  echo "  $TOTAL diarias, nada que borrar"
fi

echo
echo "Hecho. Copias en R2:"
r2 s3 ls "s3://$R2_BUCKET/backups/diario/"  | awk '{print "  diario  " $4 "  " $3 " bytes"}' | tail -5
r2 s3 ls "s3://$R2_BUCKET/backups/mensual/" | awk '{print "  mensual " $4 "  " $3 " bytes"}' | tail -3
