#!/usr/bin/env bash
# Vectoriza las frases pendientes UNA A UNA, con tope por llamada.
#
# `/embed-all` sin filtro las hace todas dentro de UNA sola petición HTTP: si una
# frase tarda mucho o falla, no se sabe por cuál iba ni cuántas quedaban. Así cada
# frase tiene su propio límite, se ve el avance y una caída no arrastra al resto.
# (Los `fetch` a Vertex ya llevan su propio tope desde el 2026-08-19, pero la cuota
# compartida hace que un lote de 28 tarde media hora y convenga verlo.)
cd "$(dirname "$0")/.."
ids=$(node scripts/frases-sin-vector.mjs)
total=$(echo "$ids" | grep -c .)
i=0
for id in $ids; do
  i=$((i+1))
  r=$(curl -s -X POST http://localhost:5173/api/phrases/embed-all \
        -H "Content-Type: application/json" \
        -d "{\"only\":[\"$id\"]}" --max-time 150)
  echo "[$i/$total] ${id:0:8} → ${r:-TIMEOUT}"
done
echo "FIN"
