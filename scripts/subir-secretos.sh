#!/usr/bin/env bash
#
# Sube los secretos de producción a AWS SSM Parameter Store (cifrados con KMS).
# SE EJECUTA EN EL PC DE DAVID, desde la raíz del repo:
#
#     bash scripts/subir-secretos.sh
#
# ¿Por qué así y no pegándolos por SSH/SSM a mano?
#   · Pegar un JSON multilínea en una sesión interactiva se trunca o se come
#     líneas, y un JSON roto falla de formas que no apuntan a la causa.
#   · Los valores NO pasan por el historial de comandos de SSM (que se guarda y
#     es visible en la consola) ni por ninguna conversación.
#   · Quedan cifrados, auditables en CloudTrail y rotables sin volver a tocar
#     la VM: se cambia el parámetro y se vuelve a bajar.
#
# La VM los lee con su propio rol (AmazonSSMManagedInstanceCore ya trae
# ssm:GetParameter, verificado el 2026-08-19). No hay credenciales que copiar.
#
# Este script NO imprime ningún valor. Solo dice qué subió y qué faltaba.

set -euo pipefail

PERFIL="${AWS_PROFILE:-bebetter}"
REGION="${AWS_REGION:-us-east-2}"
PREFIJO="/bebetter"
ENV_ORIGEN="server/.env"
CRED_ORIGEN="server/credentials"

if [ ! -f "$ENV_ORIGEN" ]; then
  echo "ERROR: no encuentro $ENV_ORIGEN. Ejecútalo desde la raíz del repo." >&2
  exit 1
fi

# Las claves que producción necesita. Deliberadamente NO están:
#   · las que fija el compose (DATABASE_URL, rutas, PUBLIC_BASE_URL…)
#   · las generadas dentro de la VM (POSTGRES_PASSWORD, SESSION_SECRET,
#     SERVICE_TOKEN) y las de la puerta (AUTH_GOOGLE_CLIENT_*), que se ponen allí
#     con `scripts/montar-puerta.sh`. El rol de la instancia solo puede LEER de
#     Parameter Store, así que lo que nace en la VM se queda en la VM — igual que
#     la contraseña de Postgres. Por eso `bajar-secretos.sh` hace copia del .env
#     antes de tocarlo.
#   · las de la cosecha de audio (GALLERY_DL_*, YTDLP_*), que se queda en local
CLAVES="
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
R2_BUCKET
R2_PUBLIC_URL
WEBHOOK_TEST_URL
WEBHOOK_PROD_URL
WEBHOOK_APPROVAL_URL
WEBHOOK_SECRET
GOOGLE_API_KEY
GOOGLE_API_KEY_FREE
VERTEX_PROJECT
VERTEX_LOCATION
VERTEX_TEXT_LOCATION
VERTEX_IMAGE_LOCATION
VERTEX_IMAGE_MODEL
VERTEX_IMAGE_MODEL_FALLBACK
IMAGE_BACKEND
KIE_API_KEY
IA_PRIMERO
IA_PROPORCION
GOOGLE_SHEET_ID
GOOGLE_DRIVE_FOLDER_ID
PINTEREST_APP_ID
PINTEREST_APP_SECRET
PINTEREST_BOARD_ID
APIFY_TOKEN
"

echo "Subiendo a $PREFIJO/env/ (perfil $PERFIL, región $REGION)"
echo

SUBIDAS=0
VACIAS=""

for CLAVE in $CLAVES; do
  # Coge la primera aparición y se queda con todo lo que hay tras el primer '='
  # (los valores pueden llevar '=' dentro, p. ej. en una URL con parámetros).
  VALOR=$(grep -m1 "^${CLAVE}=" "$ENV_ORIGEN" 2>/dev/null | cut -d= -f2- || true)
  # Quita comillas envolventes y el \r que deja Windows: un \r invisible al final
  # de un secreto lo rompe sin decir por qué.
  VALOR=$(printf '%s' "$VALOR" | tr -d '\r' | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/')

  if [ -z "$VALOR" ]; then
    VACIAS="$VACIAS $CLAVE"
    continue
  fi

  aws ssm put-parameter \
    --name "$PREFIJO/env/$CLAVE" \
    --value "$VALOR" \
    --type SecureString \
    --overwrite \
    --profile "$PERFIL" --region "$REGION" \
    --output text --query 'Version' > /dev/null
  echo "  ok   $CLAVE"
  SUBIDAS=$((SUBIDAS + 1))
done

echo
echo "Subiendo los ficheros de credenciales a $PREFIJO/credentials/"
echo

# origen (como se llama en el PC)  →  destino (nombre canónico en el servidor)
subir_fichero() {
  local ORIGEN="$CRED_ORIGEN/$1"
  local DESTINO="$2"
  if [ ! -f "$ORIGEN" ]; then
    echo "  FALTA  $1  (no se sube)"
    return
  fi
  # Parameter Store estándar admite 4 KB. Si algún JSON creciera, hay que pasar
  # ese parámetro a --tier Advanced (8 KB, 0,05 USD/mes).
  local BYTES
  BYTES=$(wc -c < "$ORIGEN")
  if [ "$BYTES" -gt 4000 ]; then
    echo "  AVISO  $1 ocupa $BYTES bytes (>4 KB) — necesita --tier Advanced"
  fi
  aws ssm put-parameter \
    --name "$PREFIJO/credentials/$DESTINO" \
    --value "file://$ORIGEN" \
    --type SecureString \
    --overwrite \
    --profile "$PERFIL" --region "$REGION" \
    --output text --query 'Version' > /dev/null
  echo "  ok   $1  →  $DESTINO  ($BYTES bytes)"
}

# Se renombran a nombres canónicos: el del JSON de Vertex lleva un hash del
# proyecto y no queremos que ese detalle viaje al compose.
subir_fichero "galactic-vertex-bebetter-a1e9a9763f4a.json" "vertex-service-account.json"
subir_fichero "google-service-account.json"                "google-oauth.json"
subir_fichero "drive-token.json"                           "google-token.json"
subir_fichero "pinterest-token.json"                       "pinterest-token.json"

echo
echo "─────────────────────────────────────────────"
echo "Subidas $SUBIDAS variables."
if [ -n "$VACIAS" ]; then
  echo
  echo "SIN VALOR en $ENV_ORIGEN (no se subieron):"
  for C in $VACIAS; do echo "  · $C"; done
  echo "Si alguna hace falta en producción, rellénala y vuelve a ejecutar."
fi
echo
echo "ACME_EMAIL no sale del .env de desarrollo. Súbelo a mano:"
echo "  aws ssm put-parameter --name $PREFIJO/env/ACME_EMAIL --value 'tu@correo' \\"
echo "      --type SecureString --overwrite --profile $PERFIL --region $REGION"
echo
echo "Ahora, en la VM:  bash scripts/bajar-secretos.sh"
