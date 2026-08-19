"""
Detecta qué cortes del banco son el MISMO TEMA, por huella acústica (2026-08-18).

Por qué hace falta. La forma barata y exacta de saberlo era el `audio_asset_id` que
Instagram pone en el payload del reel, pero `gallery-dl` no pasa su muro de login
desde esta máquina, así que no llega. Sin ese id, dos reels que usan la misma
canción producen dos mp3 distintos — y la regla de "no repetir pista" del matcher
compara por nombre de archivo, así que sonarían seguidos creyendo que son cortes
diferentes.

Cómo. El ffmpeg de esta máquina viene con `--enable-chromaprint`, o sea que la
huella se saca en local y gratis. Una huella de Chromaprint es una secuencia de
enteros de 32 bits, uno cada ~0,24 s (medido: 22 bloques para un corte de 5,34 s),
donde cada bit describe una banda del
espectro. Dos cortes del mismo tema comparten la secuencia aunque empiecen en
segundos distintos, así que se desliza una sobre la otra y se busca el
solapamiento con menos bits distintos.

    python scripts/huellas-audio.py [umbral]

No modifica nada: solo informa. Decidir qué se fusiona es de David.
"""
import subprocess, sys, os, glob, itertools, struct

# Distancia de Hamming normalizada (0 = idénticos, 0,5 = ruido sin relación) por
# debajo de la cual se consideran el mismo tema. 0,25 es el umbral habitual de
# Chromaprint; se puede pasar otro por argumento para ver cómo se mueve el reparto.
UMBRAL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.25
# Cuántos bloques deben solaparse como mínimo para que la comparación signifique
# algo. 12 bloques ≈ 2,9 s: por debajo de eso cualquier par se parece por azar. No
# puede subirse mucho más — los cortes del nicho duran 5-8 s, o sea 20-33 bloques,
# y pedir un solape largo dejaría fuera justo a los más habituales.
MIN_SOLAPE = 12

AUDIO = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'audio')


def huella(path):
    """Huella cruda de Chromaprint como lista de enteros de 32 bits.

    `-fp_format raw` escupe BINARIO (int32 nativos), no texto separado por comas:
    hay que desempaquetarlo, no parsearlo.
    """
    out = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-f', 'chromaprint',
         '-fp_format', 'raw', '-'],
        capture_output=True)
    crudo = out.stdout
    n = len(crudo) // 4
    return list(struct.unpack(f'<{n}i', crudo[:n * 4])) if n else []


def distancia(a, b):
    """Menor distancia de Hamming normalizada deslizando una huella sobre la otra."""
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
    print(f'{len(ficheros)} cortes en el banco. Umbral {UMBRAL}\n')

    huellas = {}
    for f in ficheros:
        h = huella(f)
        if len(h) >= MIN_SOLAPE:
            huellas[os.path.basename(f)] = h
        else:
            print(f'  (sin huella utilizable: {os.path.basename(f)})')

    nombres = list(huellas)
    # Unión de conjuntos: si A≈B y B≈C, los tres son el mismo tema.
    padre = {n: n for n in nombres}

    def raiz(x):
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x

    pares = []
    for a, b in itertools.combinations(nombres, 2):
        d = distancia(huellas[a], huellas[b])
        if d < UMBRAL:
            pares.append((d, a, b))
            padre[raiz(a)] = raiz(b)

    grupos = {}
    for n in nombres:
        grupos.setdefault(raiz(n), []).append(n)
    repetidos = [g for g in grupos.values() if len(g) > 1]

    if not repetidos:
        print('Ningún tema repetido por encima del umbral.')
    for g in sorted(repetidos, key=len, reverse=True):
        print(f'\nMISMO TEMA ({len(g)} cortes):')
        for n in sorted(g):
            print(f'    {n}')
    print(f'\n{len(nombres)} cortes → {len(grupos)} temas distintos '
          f'({len(nombres) - len(grupos)} duplicados)')

    if pares:
        print('\nPares más parecidos (distancia · a · b):')
        for d, a, b in sorted(pares)[:10]:
            print(f'  {d:.3f}  {a}  ~  {b}')


main()
