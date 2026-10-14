#!/usr/bin/env bash
#
# Monta el login de Google en la VM. SE EJECUTA EN LA VM, desde la raíz del repo:
#
#     bash scripts/montar-puerta.sh
#
# Pregunta lo que hace falta y lo escribe en el `.env`. Los dos secretos que no
# vienen de ninguna parte —la firma de la sesión y el token de servicio— se
# GENERAN AQUÍ con `openssl rand`, igual que la contraseña de Postgres.
#
# ⚠️ Por qué aquí y no en un chat ni en un `aws ssm send-command`: el historial de
# Run Command se guarda y se ve en la consola. Un secreto que pasa por ahí es un
# secreto publicado. Este script no imprime ningún valor y usa `read -s` para lo
# que no debe aparecer ni en pantalla.
#
# El rol de la instancia solo puede LEER de Parameter Store, así que lo que nace
# aquí se queda aquí — por eso lo primero que hace es una copia del `.env`.
#
# Es idempotente: se puede repetir. Lo que ya tenga valor se respeta salvo que se
# pida cambiarlo.

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || { echo "ERROR: no encuentro $ENV_FILE. ¿Estás en /home/ubuntu/bebetter-studio?" >&2; exit 1; }

COPIA="$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$COPIA"
echo "Copia de seguridad: $COPIA"
echo

leer_actual() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true; }

# Escribe con python3 y no con sed: los valores llevan caracteres que sed
# interpreta dentro del reemplazo, y un escapado a medias corrompe el fichero sin
# avisar. python3 ya está en la VM — lo usa bajar-secretos.sh.
poner() {
  CLAVE="$1" VALOR="$2" python3 - "$ENV_FILE" <<'PY'
import os, sys
ruta = sys.argv[1]
clave, valor = os.environ['CLAVE'], os.environ['VALOR']
lineas = open(ruta, encoding='utf-8').read().splitlines()
for i, l in enumerate(lineas):
    if l.startswith(clave + '='):
        lineas[i] = f'{clave}={valor}'
        break
else:
    lineas.append(f'{clave}={valor}')
open(ruta, 'w', encoding='utf-8', newline='\n').write('\n'.join(lineas) + '\n')
PY
  echo "  ok   $1"
}

echo "─── El cliente OAuth de Google ──────────────────────────────────────────"
echo "Se saca de la consola del proyecto PERMANENTE (no el del ensayo Vertex):"
echo "  APIs y servicios → Credenciales → Crear credenciales → ID de cliente OAuth"
echo

ACTUAL_ID=$(leer_actual AUTH_GOOGLE_CLIENT_ID)
if [ -n "$ACTUAL_ID" ]; then
  echo "AUTH_GOOGLE_CLIENT_ID ya tiene valor (…${ACTUAL_ID: -14})."
  read -rp "¿Cambiarlo? [s/N] " R
  [ "${R,,}" = "s" ] && ACTUAL_ID=""
fi
if [ -z "$ACTUAL_ID" ]; then
  read -rp "Client ID    : " NUEVO_ID
  [ -z "$NUEVO_ID" ] && { echo "ERROR: el Client ID no puede quedar vacío." >&2; exit 1; }
  poner AUTH_GOOGLE_CLIENT_ID "$NUEVO_ID"
fi

if [ -z "$(leer_actual AUTH_GOOGLE_CLIENT_SECRET)" ] || [ -n "${NUEVO_ID:-}" ]; then
  # -s: no se hace eco. El secreto no aparece en pantalla ni en el scrollback de
  # la sesión, que en Session Manager se puede quedar grabado.
  read -rsp "Client Secret: " NUEVO_SECRET; echo
  [ -z "$NUEVO_SECRET" ] && { echo "ERROR: el Client Secret no puede quedar vacío." >&2; exit 1; }
  poner AUTH_GOOGLE_CLIENT_SECRET "$NUEVO_SECRET"
fi

echo
echo "─── Quién puede entrar ──────────────────────────────────────────────────"
ACTUAL_CORREOS=$(leer_actual AUTH_ALLOWED_EMAILS)
echo "Ahora: ${ACTUAL_CORREOS:-(nadie)}"
read -rp "Correos autorizados, separados por comas [Intro = dejar como está]: " CORREOS
[ -n "$CORREOS" ] && poner AUTH_ALLOWED_EMAILS "$CORREOS"
[ -z "$CORREOS" ] && [ -z "$ACTUAL_CORREOS" ] && {
  echo "ERROR: sin correos autorizados no podría entrar nadie nunca." >&2; exit 1; }

echo
echo "─── Lo demás ────────────────────────────────────────────────────────────"
BASE=$(leer_actual AUTH_BASE_URL)
[ -z "$BASE" ] && { poner AUTH_BASE_URL "https://bebetter.itsciro.com"; BASE="https://bebetter.itsciro.com"; }
echo "  AUTH_BASE_URL = $BASE"

# La firma de la sesión. Solo se genera si no existe: regenerarla cerraría todas
# las sesiones abiertas, y eso tiene que ser una decisión, no un efecto de correr
# este script otra vez.
if [ -z "$(leer_actual SESSION_SECRET)" ]; then
  poner SESSION_SECRET "$(openssl rand -hex 32)"
  echo "       (generado aquí — no se imprime, y no existe en ningún otro sitio)"
else
  echo "  ok   SESSION_SECRET (ya existía, se respeta)"
fi

# El token de las máquinas. Vacío mientras no haya ninguna que entre: un secreto
# que existe es un secreto que se puede filtrar.
if [ -z "$(leer_actual SERVICE_TOKEN)" ]; then
  read -rp "¿Generar ya el token de servicio para n8n / Cloud Run? [s/N] " R
  if [ "${R,,}" = "s" ]; then
    poner SERVICE_TOKEN "$(openssl rand -hex 32)"
    echo "       Para leerlo cuando lo necesites:  grep '^SERVICE_TOKEN=' .env"
  else
    poner SERVICE_TOKEN ""
    echo "  --   SERVICE_TOKEN vacío (ninguna máquina entra todavía)"
  fi
fi

poner AUTH_ENABLED true
[ -z "$(leer_actual SESSION_MAX_AGE)" ] && poner SESSION_MAX_AGE 2592000

chmod 600 "$ENV_FILE"

echo
echo "─────────────────────────────────────────────────────────────────────────"
echo "Comprobación del compose:"
if docker compose config > /dev/null 2>&1; then
  echo "  ok — todas las variables obligatorias tienen valor"
else
  docker compose config 2>&1 | grep -iE "required variable|error" | head -5
  echo "  ⚠️ revisa lo de arriba antes de levantar"
fi

echo
echo "La URI que TIENE que estar registrada en el cliente OAuth de Google,"
echo "carácter por carácter (un solo carácter de más da error 400):"
echo
echo "    ${BASE}/auth/google/callback"
echo
echo "Cuando esté, recrea la app para que lea el .env nuevo:"
echo "    docker compose up -d --build --force-recreate app caddy"
echo
echo "⚠️ 'up -d' a secas NO basta: env_file se lee al CREAR el contenedor, no al"
echo "   vuelo. Es el mismo fallo que dio por buena una medición entera el 2026-08-20."
