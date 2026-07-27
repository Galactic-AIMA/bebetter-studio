#!/usr/bin/env python3
"""
Hace que n8n devuelva el `mediaId` (y el permalink) de cada publicacion.

Por que: la app necesita el media id de Instagram para pedir insights y cruzar
rendimiento con receta. `[Pub]` y `[SchedCarrusel]` lo conocen justo despues de
publicar, pero publican cuando la app no esta corriendo, asi que no pueden
llamarla. La via barata es dejarlo en la fila `published` del Sheet, que ambos
workflows ya actualizan: la app lo recoge con syncPublicationsFromSheet().

Alternativa descartada: webhook de vuelta a la app (obligaria a exponer el
servidor local y a tocar mas nodos de un workflow de produccion de 58 nodos).

Uso:
    python server/scripts/add-mediaid-to-queues.py             # dry-run
    python server/scripts/add-mediaid-to-queues.py --apply     # PUT a n8n

Requiere `.n8n-key` en la raiz de beBetterStudio.

IMPORTANTE (leccion del bug de [IGToken]): un nodo googleSheets creado por API
necesita `columns.schema` explicito. Aqui se AMPLIA el schema existente con las
dos columnas nuevas; si el nodo no lo tuviera, se aborta en vez de romperlo.
"""
import json
import os
import ssl
import sys
import urllib.request
from datetime import datetime

BASE = "https://n8n.galacticaima.com/api/v1"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
APPLY = "--apply" in sys.argv

# workflow id -> (nombre del nodo Sheets a tocar, expresion del media id)
TARGETS = {
    "fRgHVl5PndZVDNa8": ("[Pub] bebetter", "\U0001f4dd Marcar publicado"),
    "C2c3luiE1MIVtsMQ": ("[SchedCarrusel] bebetter", "\U0001f4dd Marcar publicado"),
}

# Columnas nuevas de las pestanas Cola y ColaCarruseles.
NEW_COLUMNS = ["mediaId", "permalink"]

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def key():
    with open(os.path.join(ROOT, ".n8n-key")) as f:
        return f.read().strip()


def api(path, method="GET", body=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        method=method,
        headers={"X-N8N-API-KEY": key(), "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body else None,
    )
    with urllib.request.urlopen(req, context=CTX) as r:
        return json.loads(r.read())


def schema_entry(name):
    """Entrada de resourceMapper para una columna de texto opcional."""
    return {
        "id": name,
        "displayName": name,
        "required": False,
        "defaultMatch": False,
        "display": True,
        "type": "string",
        "canBeUsedToMatch": True,
        "readOnly": False,
        "removed": False,
    }


def patch_node(node, media_expr):
    cols = node["parameters"].get("columns") or {}
    schema = cols.get("schema")
    if schema is None:
        raise SystemExit(
            f"   ABORTADO: el nodo '{node['name']}' no tiene columns.schema. "
            "Abrelo una vez en la UI de n8n para que lo autogenere y vuelve a correr esto."
        )

    ids = {c.get("id") for c in schema}
    added = []
    for name in NEW_COLUMNS:
        if name not in ids:
            schema.append(schema_entry(name))
            added.append(name)

    value = cols.setdefault("value", {})
    value["mediaId"] = media_expr
    value["permalink"] = ""  # IG no da permalink al publicar; lo rellena la app
    cols["schema"] = schema
    node["parameters"]["columns"] = cols
    return added


def main():
    print(f"\n{'APPLY' if APPLY else 'DRY-RUN'} — mediaId en las colas\n")

    for wf_id, (nombre, node_name) in TARGETS.items():
        wf = api(f"/workflows/{wf_id}")
        print(f"{nombre} ({wf_id}) — {len(wf['nodes'])} nodos")

        node = next((n for n in wf["nodes"] if n["name"] == node_name), None)
        if not node:
            print(f"   nodo '{node_name}' NO encontrado — se salta")
            continue

        # De donde sale el media id en cada workflow: el nodo que publica.
        publicar = next(
            (n["name"] for n in wf["nodes"] if "ublicar" in n["name"] and "media_publish" in json.dumps(n.get("parameters", {}))),
            None,
        )
        if not publicar:
            publicar = "\U0001f4e4 Publicar"
        media_expr = "={{ $('" + publicar + "').first().json.id }}"

        added = patch_node(node, media_expr)
        print(f"   nodo: {node_name}")
        print(f"   media id desde: {publicar}")
        print(f"   columnas anadidas al schema: {added or '(ya estaban)'}")

        if APPLY:
            backup = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                f"wf_backup_{wf_id}_{datetime.now():%Y%m%d%H%M%S}.json",
            )
            with open(backup, "w", encoding="utf-8") as f:
                json.dump(wf, f, ensure_ascii=False, indent=2)

            # El PUT de n8n rechaza settings con claves extra.
            allowed = {
                "executionOrder", "saveManualExecutions", "callerPolicy", "errorWorkflow",
                "timezone", "saveDataErrorExecution", "saveDataSuccessExecution",
                "saveExecutionProgress", "executionTimeout",
            }
            settings = {k: v for k, v in (wf.get("settings") or {}).items() if k in allowed}
            api(
                f"/workflows/{wf_id}",
                "PUT",
                {"name": wf["name"], "nodes": wf["nodes"], "connections": wf["connections"], "settings": settings},
            )
            print(f"   PUT ok (backup: {os.path.basename(backup)})")
        print()

    if not APPLY:
        print("(dry-run — nada modificado. Anade --apply.)")
    else:
        print("Recuerda: las pestanas Cola y ColaCarruseles necesitan las columnas")
        print("mediaId y permalink en el header (corre los scripts de setup).")


if __name__ == "__main__":
    main()
