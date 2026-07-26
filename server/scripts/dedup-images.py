# -*- coding: utf-8 -*-
"""
Deduplica el banco de imágenes por CONTENIDO VISUAL (hash perceptual dHash).

Motivo: gallery-dl y la Pinterest API bajaban la misma imagen; a veces byte a byte
idéntica (la pilla un MD5) y a veces en distinta resolución/compresión (MISMO
contenido visual, DISTINTO byte → un MD5 no la ve, pero se ve repetida en el banco).
Este script usa dHash perceptual (hamming <= UMBRAL) para agrupar las visualmente
iguales.

De cada grupo CONSERVA el `pinterest_*` (la fuente que se mantiene tras quitar
gallery-dl) y NUNCA borra un pinterest_. Solo mueve a backup los archivos que NO
son pinterest_ (gallery-dl / otros) y borra su fila en la DB, transfiriéndole al
keeper el embedding/análisis si el sobrante era el único vectorizado.

Uso (desde beBetterStudio/, con el server DETENIDO):
    python server/scripts/dedup-images.py            # dry-run
    python server/scripts/dedup-images.py --apply    # backup + mueve dups + limpia DB

Requiere Pillow (PIL). Umbral por defecto 3 (subir = más agresivo).
"""
import os, sys, sqlite3, shutil, datetime
from PIL import Image

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, '..', '..', 'data', 'bebetter.db')
THRESHOLD = 3  # distancia de hamming máxima para considerarlas la misma imagen
EXTS = {'.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.avif'}


def load_env(key, default=None):
    envp = os.path.join(HERE, '..', '.env')
    if os.path.exists(envp):
        for line in open(envp, encoding='utf-8'):
            line = line.strip()
            if line.startswith(key + '='):
                return line.split('=', 1)[1].strip()
    return default


IMAGES = load_env('IMAGES_PATH') or os.path.join(HERE, '..', '..', 'data', 'images')


def dhash(path, size=8):
    img = Image.open(path).convert('L').resize((size + 1, size))
    px = list(img.getdata())
    bits = 0
    for r in range(size):
        for c in range(size):
            bits = (bits << 1) | (1 if px[r * (size + 1) + c] > px[r * (size + 1) + c + 1] else 0)
    return bits


def hamming(a, b):
    return bin(a ^ b).count('1')


def pick_keeper(group):
    # Nunca borramos un pinterest_: si hay uno, es el keeper.
    for f in group:
        if f.startswith('pinterest_'):
            return f
    return sorted(group)[0]


def main():
    apply = '--apply' in sys.argv
    files = [f for f in os.listdir(IMAGES) if os.path.splitext(f)[1].lower() in EXTS]

    dh = {}
    for f in files:
        try:
            dh[f] = dhash(os.path.join(IMAGES, f))
        except Exception as e:
            print('  (no pude leer)', f, e)

    names = list(dh)
    used = set()
    groups = []
    for i, a in enumerate(names):
        if a in used:
            continue
        grp = [a]
        for b in names[i + 1:]:
            if b in used:
                continue
            if hamming(dh[a], dh[b]) <= THRESHOLD:
                grp.append(b)
                used.add(b)
        if len(grp) > 1:
            used.add(a)
            groups.append(grp)

    # Plan: en cada grupo, keeper (pinterest_ si existe) y losers = SOLO no-pinterest.
    plan = []
    for g in groups:
        keeper = pick_keeper(g)
        if keeper.startswith('pinterest_'):
            losers = [f for f in g if not f.startswith('pinterest_')]
        else:
            losers = [f for f in g if f != keeper]
        if losers:
            plan.append((keeper, losers))

    total = sum(len(l) for _, l in plan)
    print(f'Archivos: {len(files)} | grupos visualmente duplicados: {len(groups)} | '
          f'sobrantes a limpiar: {total}')
    if not plan:
        print('Nada que deduplicar.')
        return

    if not apply:
        for keeper, losers in plan[:15]:
            print(f'  keep {keeper[:34]}  ×del {", ".join(x[:30] for x in losers)}')
        if len(plan) > 15:
            print(f'  … y {len(plan) - 15} grupos más')
        print('\nDRY-RUN. Corré con --apply (server DETENIDO) para backup + limpiar.')
        return

    stamp = datetime.datetime.now().strftime('%Y%m%dT%H%M%S')

    # Backup consistente de la DB (API de backup de sqlite, segura con WAL).
    src = sqlite3.connect(DB)
    bak_db = os.path.join(os.path.dirname(DB), f'bebetter.db.bak-{stamp}')
    dst = sqlite3.connect(bak_db)
    with dst:
        src.backup(dst)
    dst.close()
    print('Backup DB:', bak_db)

    backup_dir = os.path.join(IMAGES, f'_dup_backup_{stamp}')
    os.makedirs(backup_dir, exist_ok=True)

    cur = src.cursor()
    moved = 0
    for keeper, losers in plan:
        group = [keeper] + losers
        qmarks = ','.join('?' * len(group))
        rows = {r[0]: r for r in cur.execute(
            f'SELECT filename, tags, analysis_json, embedding, analyzed_at, usage_count, origen '
            f'FROM images WHERE filename IN ({qmarks})', group)}
        max_usage = max([rows[f][5] for f in rows if rows[f][5] is not None] or [0])
        keeper_row = rows.get(keeper)
        # ¿el keeper no está vectorizado pero un loser sí? → transferirle el análisis.
        source = None
        if keeper_row and keeper_row[3] is not None:
            source = keeper_row
        else:
            for f in losers:
                if rows.get(f) and rows[f][3] is not None:
                    source = rows[f]
                    break
        if source:
            cur.execute(
                'INSERT INTO images (filename, tags, analysis_json, embedding, analyzed_at, usage_count, origen) '
                'VALUES (?,?,?,?,?,?,?) '
                'ON CONFLICT(filename) DO UPDATE SET tags=excluded.tags, analysis_json=excluded.analysis_json, '
                'embedding=excluded.embedding, analyzed_at=excluded.analyzed_at, usage_count=excluded.usage_count, '
                'origen=COALESCE(excluded.origen, origen)',
                (keeper, source[1], source[2], source[3], source[4], max_usage, source[6]))

        for loser in losers:
            shutil.move(os.path.join(IMAGES, loser), os.path.join(backup_dir, loser))
            cur.execute('DELETE FROM images WHERE filename = ?', (loser,))
            moved += 1

    src.commit()
    n_after = cur.execute('SELECT COUNT(*) FROM images').fetchone()[0]
    src.close()
    on_disk = len([f for f in os.listdir(IMAGES) if os.path.splitext(f)[1].lower() in EXTS])
    print(f'Movidos a backup: {moved} ({backup_dir})')
    print(f'Imágenes en banco ahora: {on_disk} | filas en DB: {n_after}')


if __name__ == '__main__':
    main()
