#!/usr/bin/env bash
#
# Compone el .env y los ficheros de credenciales desde SSM Parameter Store.
# SE EJECUTA EN LA VM, desde la raíz del repo:
#
#     bash scripts/bajar-secretos.sh
#
# La instancia se autentica con SU PROPIO ROL (beBetterStudio-ec2-ssm-role): no
# hay claves de AWS en la máquina, ni que copiar ni que rotar. El rol solo puede
# LEER, así que un descuido aquí no puede corromper los secretos de origen.
#
# Es idempotente: se puede volver a correr tras rotar cualquier secreto. Ese es
# el flujo de rotación — cambiar el parámetro y volver a ejecutar esto.
#
# NO imprime ningún valor. Solo qué escribió y qué faltaba.

set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
PREFIJO="/bebetter"
ENV_FILE=".env"
CRED_DIR="credentials"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: no encuentro $ENV_FILE. ¿Estás en /home/ubuntu/bebetter-studio?" >&2
  exit 1
fi

echo "Leyendo $PREFIJO/env/ …"

# Copia de seguridad antes de tocar nada: este fichero lleva la contraseña de
# Postgres y el hash de la puerta, que se generaron aquí y no están en ningún
# otro sitio. Perderlos obligaría a recrear la base.
cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# get-parameters-by-path pagina de 10 en 10 por defecto. Sin --recursive porque
# credentials/ se trata aparte (son ficheros, no variables).
aws ssm get-parameters-by-path \
  --path "$PREFIJO/env" \
  --with-decryption \
  --region "$REGION" \
  --max-items 100 \
  --query 'Parameters[].[Name,Value]' \
  --output text > "$TMP"

if [ ! -s "$TMP" ]; then
  echo "ERROR: no hay ningún parámetro en $PREFIJO/env/." >&2
  echo "¿Ejecutaste 'bash scripts/subir-secretos.sh' en el PC?" >&2
  exit 1
fi

ESCRITAS=0
while IFS=$'\t' read -r NOMBRE VALOR; do
  [ -z "$NOMBRE" ] && continue
  CLAVE="${NOMBRE##*/}"

  if grep -q "^${CLAVE}=" "$ENV_FILE"; then
    # Reemplaza en su sitio. El separador es | y no / porque los valores llevan
    # URLs; y se escapan | y & , que sed interpreta dentro del reemplazo.
    SEGURO=$(printf '%s' "$VALOR" | sed -e 's/[|&\\]/\\&/g')
    sed -i "s|^${CLAVE}=.*|${CLAVE}=${SEGURO}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$CLAVE" "$VALOR" >> "$ENV_FILE"
  fi
  echo "  ok   $CLAVE"
  ESCRITAS=$((ESCRITAS + 1))
done < "$TMP"

echo
echo "Leyendo $PREFIJO/credentials/ …"

mkdir -p "$CRED_DIR"

for DESTINO in vertex-service-account.json google-oauth.json google-token.json pinterest-token.json; do
  if aws ssm get-parameter --name "$PREFIJO/credentials/$DESTINO" --with-decryption \
       --region "$REGION" --query 'Parameter.Value' --output text > "$CRED_DIR/$DESTINO" 2>/dev/null; then
    # Un JSON que llega truncado o vacío rompe más tarde y lejos de aquí, así
    # que se comprueba AHORA que al menos parsea.
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$CRED_DIR/$DESTINO" 2>/dev/null; then
      chmod 600 "$CRED_DIR/$DESTINO"
      echo "  ok   $DESTINO  ($(wc -c < "$CRED_DIR/$DESTINO") bytes, JSON válido)"
    else
      echo "  ROTO $DESTINO  — no es JSON válido. Revisa el parámetro en origen." >&2
      rm -f "$CRED_DIR/$DESTINO"
    fi
  else
    rm -f "$CRED_DIR/$DESTINO"
    echo "  FALTA  $DESTINO  (no está en Parameter Store)"
  fi
done

chmod 600 "$ENV_FILE"
chmod 700 "$CRED_DIR"

echo
echo "─────────────────────────────────────────────"
echo "Escritas $ESCRITAS variables en $ENV_FILE."
echo
echo "Variables que siguen SIN valor:"
grep -E "^[A-Z0-9_]+=$" "$ENV_FILE" | sed 's/=$//; s/^/  · /' || echo "  (ninguna)"
echo
echo "Comprobación del compose:"
if docker compose config > /dev/null 2>&1; then
  echo "  ok — todas las variables obligatorias tienen valor"
  echo
  echo "Ya se puede levantar:  docker compose up -d"
else
  docker compose config 2>&1 | grep -iE "required variable|error" | head -5
fi
