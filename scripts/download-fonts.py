"""
Descarga fuentes desde github.com/google/fonts y genera las variantes TTF
estáticas que usan la app y FFmpeg.

Estos archivos son la ÚNICA tipografía del sistema desde el 2026-08-18: el
navegador los carga por @font-face desde `/api/fonts` (ya no del CDN de Google)
y FFmpeg los pinta. Que preview y vídeo midan el mismo archivo es lo que hace
posible que el servidor calcule el corte de línea sin navegador.

⚠️ De la pasada de mayo salieron cuatro archivos que NO eran la variante que
decía su nombre —Oswald-Bold, PlayfairDisplay-Bold, RobotoCondensed-Bold e
IBMPlexSans-Thin eran copias del Regular—, porque `is_valid_ttf` solo mira la
firma del archivo y sin `--force` se saltaba todo lo que ya existía. Por eso
ahora TODAS las entradas llevan especificación explícita: ninguna es `None`.

⚠️ Inter tiene eje `opsz`: se instancia en **14** (el corte por defecto, el que
servía el CDN y con el que está curado el banco), no en 28.

Uso: python scripts/download-fonts.py [--force]
"""
import sys
import os
import urllib.request
import tempfile
import shutil
import struct
import socket

FONTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'fonts')
FORCE = '--force' in sys.argv
BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

# Fuente → (rutaEnElRepo, {eje: valor} | None si ya es estática)
FONTS = {
    'PlayfairDisplay-Regular':  ('playfairdisplay/PlayfairDisplay[wght].ttf', {'wght': 400}),
    'PlayfairDisplay-Bold':     ('playfairdisplay/PlayfairDisplay[wght].ttf', {'wght': 700}),
    'PlayfairDisplay-Italic':   ('playfairdisplay/PlayfairDisplay-Italic[wght].ttf', {'wght': 400}),
    'Lato-Regular':             ('lato/Lato-Regular.ttf',                     None),
    'Lato-Thin':                ('lato/Lato-Thin.ttf',                        None),
    'Lato-Italic':              ('lato/Lato-Italic.ttf',                      None),
    'Lato-Bold':                ('lato/Lato-Bold.ttf',                        None),
    'Oswald-Regular':           ('oswald/Oswald[wght].ttf',                    {'wght': 400}),
    'Oswald-Thin':              ('oswald/Oswald[wght].ttf',                    {'wght': 300}),
    'Oswald-Bold':              ('oswald/Oswald[wght].ttf',                    {'wght': 700}),
    'RobotoCondensed-Regular':  ('robotocondensed/RobotoCondensed[wght].ttf',  {'wght': 400}),
    'RobotoCondensed-Thin':     ('robotocondensed/RobotoCondensed[wght].ttf',  {'wght': 100}),
    'RobotoCondensed-Italic':   ('robotocondensed/RobotoCondensed-Italic[wght].ttf', {'wght': 400}),
    'RobotoCondensed-Bold':     ('robotocondensed/RobotoCondensed[wght].ttf',  {'wght': 700}),
    # opsz=14 es el corte por defecto de Inter: el que mostraba el preview y con
    # el que está decidido el banco de frases. El 28 es para titulares grandes.
    'Inter-Regular':            ('inter/Inter[opsz,wght].ttf',                 {'opsz': 14, 'wght': 400}),
    'Inter-Bold':               ('inter/Inter[opsz,wght].ttf',                 {'opsz': 14, 'wght': 700}),
    'Inter-Thin':               ('inter/Inter[opsz,wght].ttf',                 {'opsz': 14, 'wght': 100}),
    'Inter-Italic':             ('inter/Inter-Italic[opsz,wght].ttf',          {'opsz': 14, 'wght': 400}),
    'IBMPlexSans-Regular':      ('ibmplexsans/IBMPlexSans[wdth,wght].ttf',     {'wdth': 100, 'wght': 400}),
    'IBMPlexSans-Bold':         ('ibmplexsans/IBMPlexSans[wdth,wght].ttf',     {'wdth': 100, 'wght': 700}),
    'IBMPlexSans-Thin':         ('ibmplexsans/IBMPlexSans[wdth,wght].ttf',     {'wdth': 100, 'wght': 100}),
    'IBMPlexSans-Italic':       ('ibmplexsans/IBMPlexSans-Italic[wdth,wght].ttf', {'wdth': 100, 'wght': 400}),
    'Anton-Regular':            ('anton/Anton-Regular.ttf',                    None),
}

def forzar_ipv4():
    """Resolver solo a IPv4.

    raw.githubusercontent.com devuelve PRIMERO cuatro direcciones IPv6, y en esta
    red las cuatro se comen el timeout de TCP: medido el 2026-08-18, 21,04+21,02+
    21,05+21,04 = 84,15 s por descarga antes de caer a IPv4, que conecta en 0,02 s.
    Doce descargas = 17 minutos de reloj, todo en esperas.

    curl no lo sufre porque hace Happy Eyeballs (IPv4 e IPv6 en paralelo);
    `socket.create_connection` prueba las direcciones una a una, en orden.

    Si algun dia la red solo tuviera IPv6, se devuelve la lista original.
    """
    original = socket.getaddrinfo

    def solo_ipv4(*args, **kwargs):
        todas = original(*args, **kwargs)
        return [i for i in todas if i[0] == socket.AF_INET] or todas

    socket.getaddrinfo = solo_ipv4


def is_valid_ttf(path):
    try:
        with open(path, 'rb') as f:
            sig = struct.unpack('>I', f.read(4))[0]
        return sig in (0x00010000, 0x4F54544F)
    except:
        return False

def download(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as r, open(dest, 'wb') as f:
        shutil.copyfileobj(r, f)

def instantiate(var_path, dest_path, axes):
    """Fija los ejes y guarda la instancia estatica.

    ⚠️ `instantiateVariableFont` NO modifica la fuente que recibe: devuelve una
    nueva (inplace=False por defecto). La version de mayo guardaba `font`, es
    decir el ARCHIVO VARIABLE SIN TOCAR, que al pintarse sin variaciones sale
    en su instancia por defecto. De ahi que Oswald-Bold, PlayfairDisplay-Bold y
    RobotoCondensed-Bold midieran exactamente igual que su Regular durante tres
    meses. Hay que quedarse con el valor devuelto.

    `updateFontNames` deja el name table coherente con la instancia, para que el
    archivo no vuelva a mentir sobre lo que contiene.
    """
    from fontTools.varLib import instancer
    from fontTools.ttLib import TTFont

    font = TTFont(var_path)
    static = instancer.instantiateVariableFont(font, dict(axes), updateFontNames=True)
    static.save(dest_path)

def main():
    forzar_ipv4()
    os.makedirs(FONTS_DIR, exist_ok=True)
    print(f'Destino: {FONTS_DIR}\n')

    # Cache de variables ya descargados en este run
    var_cache = {}
    ok = skipped = failed = 0

    for dest_name, spec in FONTS.items():
        dest_path = os.path.join(FONTS_DIR, f'{dest_name}.ttf')

        if not FORCE and is_valid_ttf(dest_path):
            print(f'  -- {dest_name}.ttf (ya existe y es valido)')
            skipped += 1
            continue

        var_rel, axes = spec
        var_url = f'{BASE}/{var_rel}'

        # Descargar variable font si no está en caché
        if var_url not in var_cache:
            var_tmp = tempfile.mktemp(suffix='.ttf')
            try:
                print(f'  > Descargando {var_rel.split("/")[-1]}...')
                download(var_url, var_tmp)
                var_cache[var_url] = var_tmp
            except Exception as e:
                print(f'  X No se pudo descargar {var_rel}: {e}')
                failed += 1
                continue

        var_path = var_cache[var_url]

        # Instanciar la variante estática (o copiar, si la fuente ya es estática)
        try:
            if axes is None:
                shutil.copyfile(var_path, dest_path)
            else:
                instantiate(var_path, dest_path, axes)
            size_kb = os.path.getsize(dest_path) // 1024
            axes_str = ', '.join(f'{k}={v}' for k, v in axes.items()) if axes else 'estatica'
            print(f'  OK {dest_name}.ttf ({size_kb} KB) [{axes_str}]')
            ok += 1
        except Exception as e:
            print(f'  X {dest_name} (error al instanciar): {e}')
            failed += 1

    # Limpiar temporales
    for tmp in var_cache.values():
        try: os.unlink(tmp)
        except: pass

    print(f'\nResultado: {ok} generadas, {skipped} omitidas, {failed} fallidas')
    if failed > 0:
        sys.exit(1)

if __name__ == '__main__':
    main()
