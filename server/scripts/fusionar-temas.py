"""
Fusiona los cortes que son el MISMO TEMA, por huella acústica (2026-08-18).

Varios reels del nicho usan la misma canción: medido sobre la primera cosecha, 68
cortes eran solo 41 temas. Si no se fusionan pasan dos cosas malas —

  1. La regla de "no repetir pista" del matcher compara por NOMBRE DE ARCHIVO, así
     que dos reels seguidos sonarían igual creyendo que son cortes distintos.
  2. Cada tema tendría sus frases de origen repartidas en varios archivos, cuando
     lo que se quiere es justo lo contrario: un tema con cinco frases empareja mejor
     que cinco temas con una.

Qué hace. Elige un corte canónico por grupo y REAPUNTA las procedencias de los
demás hacia él. No borra filas de `audio_tracks`: los nombres de archivo aparecen en
`videos.config_extra` y borrarlos dejaría el historial sin resolver. Los duplicados
se quedan sin procedencia, o sea fuera del pool, que es el efecto que se busca.

    python scripts/fusionar-temas.py            # solo enseña el plan
    python scripts/fusionar-temas.py --aplicar  # lo ejecuta
"""
import subprocess, sys, os, glob, itertools, struct, sqlite3

UMBRAL = 0.25
MIN_SOLAPE = 12
AQUI = os.path.dirname(__file__)
AUDIO = os.path.join(AQUI, '..', '..', 'data', 'audio')
DB = os.path.join(AQUI, '..', '..', 'data', 'bebetter.db')
APLICAR = '--aplicar' in sys.argv


def huella(path):
    out = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-f', 'chromaprint', '-fp_format', 'raw', '-'],
        capture_output=True).stdout
    n = len(out) // 4
    return list(struct.unpack(f'<{n}i', out[:n * 4])) if n else []


def duracion(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path], capture_output=True)
    try:
        return float(out.stdout.decode().strip())
    except ValueError:
        return 0.0


def distancia(a, b):
    mejor = 1.0
    for desfase in range(-(len(b) - MIN_SOLAPE), len(a) - MIN_SOLAPE + 1):
        ia, ib = max(0, desfase), max(0, -desfase)
        n = min(len(a) - ia, len(b) - ib)
        if n < MIN_SOLAPE:
            continue
        bits = sum(bin((a[ia + k] ^ b[ib + k]) & 0xFFFFFFFF).count('1') for k in range(n))
        mejor = min(mejor, bits / (n * 32))
    return mejor


def main():
    ficheros = sorted(glob.glob(os.path.join(AUDIO, '*.mp3')))
    huellas = {}
    for f in ficheros:
        h = huella(f)
        if len(h) >= MIN_SOLAPE:
            huellas[os.path.basename(f)] = h

    nombres = list(huellas)
    padre = {n: n for n in nombres}

    def raiz(x):
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x

    for a, b in itertools.combinations(nombres, 2):
        if distancia(huellas[a], huellas[b]) < UMBRAL:
            padre[raiz(a)] = raiz(b)

    grupos = {}
    for n in nombres:
        grupos.setdefault(raiz(n), []).append(n)

    con = sqlite3.connect(DB)
    fuentes = {}
    for f, u in con.execute('SELECT filename, source_url FROM audio_sources'):
        fuentes.setdefault(f, []).append(u)

    movimientos = []
    for g in grupos.values():
        if len(g) < 2:
            continue
        # Canónico = el corte MÁS LARGO del grupo. Da más material para que el reel
        # no tenga que dar la vuelta al bucle, y si el grupo mezcla una pista vieja
        # con reels nuevos, gana la que más audio tenga, no la más antigua.
        canonico = max(g, key=lambda n: (duracion(os.path.join(AUDIO, n)), n))
        for n in g:
            if n != canonico:
                for u in fuentes.get(n, []):
                    movimientos.append((u, n, canonico))
        print(f'\nTEMA → {canonico}  ({duracion(os.path.join(AUDIO, canonico)):.1f}s, '
              f'{len(fuentes.get(canonico, []))} reels propios)')
        for n in sorted(x for x in g if x != canonico):
            print(f'    absorbe {n}  ({len(fuentes.get(n, []))} reels)')

    print(f'\n{len(nombres)} cortes → {len(grupos)} temas · {len(movimientos)} procedencias a reapuntar')

    if not APLICAR:
        print('\n(plan solamente — relanza con --aplicar para ejecutarlo)')
        return

    for url, _, canonico in movimientos:
        con.execute('UPDATE audio_sources SET filename = ? WHERE source_url = ?', (canonico, url))

    # Deja constancia de ADÓNDE se fue cada duplicado. Sin esto, un corte fusionado
    # es indistinguible de uno que nunca se cosechó, y el panel acaba dando una
    # explicación falsa. Se marca todo el grupo menos el canónico, aunque no tuviera
    # procedencias que mover: el archivo sigue siendo un duplicado.
    for g in grupos.values():
        if len(g) < 2:
            continue
        canonico = max(g, key=lambda n: (duracion(os.path.join(AUDIO, n)), n))
        for n in g:
            if n != canonico:
                con.execute('UPDATE audio_tracks SET merged_into = ? WHERE filename = ?',
                            (canonico, n))
    con.commit()
    huerfanos = con.execute("""
        SELECT t.filename FROM audio_tracks t
        LEFT JOIN audio_sources s ON s.filename = t.filename
        WHERE s.filename IS NULL AND t.filename LIKE 'reel-%'""").fetchall()
    print(f'\nAplicado. {len(movimientos)} procedencias reapuntadas.')
    print(f'{len(huerfanos)} cortes cosechados quedan sin procedencia (fuera del pool).')
    print('Sus mp3 se conservan: borrarlos es una decisión aparte.')


main()
