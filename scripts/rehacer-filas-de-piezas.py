#!/usr/bin/env python3
"""
Devuelve a la cola de revisión piezas cuyos MP4 siguen en R2 pero cuya fila se
perdió.

    python3 scripts/rehacer-filas-de-piezas.py /home/ubuntu/mediciones/*.piezas.txt

Por qué existe: `medir-lote.sh` restaura la base al terminar —para que una
medición no empuje la rotación ni gaste frases— y eso borra las filas de
`videos`. Los ficheros quedan en R2, pero la pantalla de revisión lista desde la
BASE, así que las piezas desaparecen de la vista aunque existan.

Reconstruye lo suficiente para poder verlas y reproducirlas: `ReviewPanel` usa
`s3Url || publicUrl`, y el s3_url de R2 es público y sigue vivo.

⚠️ Lo que NO recupera, porque no está en ninguna parte: el `config_extra` (qué
imagen y qué pista se usaron), el título y los copies. Estas filas sirven para
MIRAR las piezas, no para publicarlas.
"""
import json
import re
import subprocess
import sys
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone

CONTENEDOR = "bebetter-pg"
USUARIO = "bebetter"
BASE = "bebetter"


def psql(sql: str) -> str:
    return subprocess.run(
        ["docker", "exec", "-i", CONTENEDOR, "psql", "-U", USUARIO, "-d", BASE,
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout


def normaliza(s: str) -> str:
    """Deja solo letras y números en minúscula, sin tildes.

    Hace falta porque el nombre del fichero está SANITIZADO: al generarlo se le
    quitan los dos puntos, las comas y demás. Comparar el texto crudo fallaría
    en cuanto la frase llevara puntuación, que es casi siempre.
    """
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def main(ficheros):
    # Las frases, para emparejar por el texto del nombre del fichero.
    frases = []
    for linea in psql("SELECT id, text FROM phrases;").splitlines():
        if "\t" in linea:
            fid, texto = linea.split("\t", 1)
            frases.append((fid.strip(), texto, normaliza(texto)))
    print(f"  {len(frases)} frases en la base para emparejar")

    # Qué filenames ya tienen fila: no duplicar si se corre dos veces.
    ya = {l.strip() for l in psql("SELECT filename FROM videos;").splitlines() if l.strip()}

    piezas = []
    for f in ficheros:
        with open(f, encoding="utf-8") as fh:
            for linea in fh:
                linea = linea.strip()
                if not linea or "|" not in linea:
                    continue
                nombre, url = linea.split("|", 1)
                piezas.append((nombre.strip(), url.strip(), f))
    print(f"  {len(piezas)} piezas en los ficheros")

    # created_at escalonado hacia atrás: la pantalla ordena por fecha ascendente,
    # así que se respeta el orden en que se generaron.
    t0 = datetime.now(timezone.utc) - timedelta(hours=2)

    insertadas = sin_frase = repetidas = 0
    for i, (nombre, url, origen) in enumerate(piezas):
        if nombre in ya:
            repetidas += 1
            continue

        # El nombre acaba en _XXXXXXXX.mp4, donde XXXXXXXX es el principio del id
        # original. Se reutiliza para que id y fichero sigan siendo coherentes.
        m = re.search(r"_([0-9a-f]{8})\.mp4$", nombre)
        corto = m.group(1) if m else uuid.uuid4().hex[:8]
        texto_nombre = nombre[: m.start()] if m else nombre.rsplit(".", 1)[0]
        vid = corto + "-" + str(uuid.uuid4())[9:]

        clave = normaliza(texto_nombre)
        phrase_id = None
        if len(clave) >= 12:
            for fid, _texto, norm in frases:
                if norm.startswith(clave[:min(len(clave), 45)]):
                    phrase_id = fid
                    break
        if not phrase_id:
            sin_frase += 1

        creado = (t0 + timedelta(seconds=i * 30)).isoformat()
        etiqueta = "sin-ia" if "sin-ia" in origen else "con-ia"

        psql(
            "INSERT INTO videos (id, filename, title, description, tags, local_path, "
            "public_url, s3_url, phrase_id, viral, font, effect, resolution, "
            "config_extra, created_at, estado) VALUES ("
            f"{lit(vid)}, {lit(nombre)}, {lit(texto_nombre)}, '', '[]', NULL, "
            f"{lit(url)}, {lit(url)}, {lit(phrase_id) if phrase_id else 'NULL'}, 0, "
            f"NULL, NULL, '1080x1920', {lit(json.dumps({'medicion': etiqueta}))}, "
            f"{lit(creado)}, 'pendiente_revision');"
        )
        insertadas += 1

    print(f"\n  insertadas : {insertadas}")
    print(f"  ya estaban : {repetidas}")
    if sin_frase:
        print(f"  ⚠️ sin emparejar con una frase: {sin_frase} (se ven igual, "
              f"pero sin la frase asociada)")

    total = psql("SELECT count(*) FROM videos WHERE estado = 'pendiente_revision';").strip()
    print(f"\n  en la cola de revisión ahora: {total}")


def lit(v) -> str:
    """Literal SQL con las comillas simples escapadas."""
    return "'" + str(v).replace("'", "''") + "'"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
