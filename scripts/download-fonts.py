"""
Descarga fuentes variable desde github.com/google/fonts y genera
instancias TTF estáticas usando fonttools.

Uso: python scripts/download-fonts.py [--force]
"""
import sys
import os
import urllib.request
import tempfile
import shutil
import struct

FONTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'fonts')
FORCE = '--force' in sys.argv
BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl'

# Fuente → { destName: (archivoVariable, {eje: valor}) }
FONTS = {
    'Montserrat-Regular':       ('montserrat/Montserrat[wght].ttf',           {'wght': 400}),
    'Montserrat-Thin':          ('montserrat/Montserrat[wght].ttf',           {'wght': 100}),
    'Montserrat-Bold':          ('montserrat/Montserrat[wght].ttf',           {'wght': 700}),
    'Montserrat-Italic':        ('montserrat/Montserrat-Italic[wght].ttf',    {'wght': 400}),
    'PlayfairDisplay-Regular':  ('playfairdisplay/PlayfairDisplay[wght].ttf', {'wght': 400}),
    'PlayfairDisplay-Bold':     ('playfairdisplay/PlayfairDisplay[wght].ttf', {'wght': 700}),
    'PlayfairDisplay-Italic':   ('playfairdisplay/PlayfairDisplay-Italic[wght].ttf', {'wght': 400}),
    'Lato-Regular':             None,  # ya descargado con el script anterior
    'Lato-Thin':                None,
    'Lato-Italic':              None,
    'Lato-Bold':                None,
    'Oswald-Regular':           ('oswald/Oswald[wght].ttf',                   {'wght': 400}),
    'Oswald-Thin':              ('oswald/Oswald[wght].ttf',                   {'wght': 300}),
    'Oswald-Bold':              ('oswald/Oswald[wght].ttf',                   {'wght': 700}),
    'RobotoCondensed-Regular':  ('robotocondensed/RobotoCondensed[wght].ttf', {'wght': 400}),
    'RobotoCondensed-Thin':     ('robotocondensed/RobotoCondensed[wght].ttf', {'wght': 100}),
    'RobotoCondensed-Italic':   ('robotocondensed/RobotoCondensed-Italic[wght].ttf', {'wght': 400}),
    'RobotoCondensed-Bold':     ('robotocondensed/RobotoCondensed[wght].ttf', {'wght': 700}),
    'Inter-Regular':            None,  # ya existe válido
    'Inter-Bold':               None,  # ya existe válido
    'Inter-Thin':               ('inter/Inter[opsz,wght].ttf',               {'opsz': 14, 'wght': 100}),
    'Inter-Italic':             ('inter/Inter-Italic[opsz,wght].ttf',        {'opsz': 14, 'wght': 400}),
    'IBMPlexSans-Regular':      None,  # ya existe válido
    'IBMPlexSans-Bold':         None,  # ya existe válido
    'IBMPlexSans-Thin':         ('ibmplexsans/IBMPlexSans[wdth,wght].ttf',   {'wdth': 100, 'wght': 100}),
    'IBMPlexSans-Italic':       ('ibmplexsans/IBMPlexSans-Italic[wdth,wght].ttf', {'wdth': 100, 'wght': 400}),
    'Anton-Regular':            None,  # ya existe válido
}

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
    from fontTools.varLib import instancer
    from fontTools.ttLib import TTFont

    font = TTFont(var_path)
    axis_limits = {k: instancer.AxisTriple(v, v, v) for k, v in axes.items()}
    instancer.instantiateVariableFont(font, axis_limits)
    font.save(dest_path)

def main():
    os.makedirs(FONTS_DIR, exist_ok=True)
    print(f'Destino: {FONTS_DIR}\n')

    # Cache de variables ya descargados en este run
    var_cache = {}
    ok = skipped = failed = 0

    for dest_name, spec in FONTS.items():
        dest_path = os.path.join(FONTS_DIR, f'{dest_name}.ttf')

        if spec is None:
            if is_valid_ttf(dest_path):
                print(f'  -- {dest_name}.ttf (ya existe)')
                skipped += 1
            else:
                print(f'  ? {dest_name}.ttf (no definido y no existe, omitido)')
            continue

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

        # Instanciar la variante estática
        try:
            instantiate(var_path, dest_path, axes)
            size_kb = os.path.getsize(dest_path) // 1024
            axes_str = ', '.join(f'{k}={v}' for k, v in axes.items())
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
