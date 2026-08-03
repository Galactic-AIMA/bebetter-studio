"""
Audita el banco de frases contra el patron de DOS TIEMPOS y por TONO.

De donde sale el patron: la percepcion del nicho. La primera pasada (2026-07-28,
n=14) dijo que lo que separa a los reels que rinden es la ESTRUCTURA (tension
A<->B) y no el tipo de gancho ni citar a un autor.

⚠️ CORREGIDO EL 2026-07-29 (n=46). Dos cosas cambiaron:

1. Los tres ejemplos de "un golpe" que llevaba este prompt estaban MAL ETIQUETADOS.
   Al leer el texto completo en pantalla (no solo la primera linea) resultaron ser
   dos tiempos: "Las carreras se ganan en las curvas. EN LA RECTA, TODOS ACELERAN",
   "Quise rendirme... pero recorde el apellido que llevo", "Es mejor cambiar de
   opinion que persistir en una equivocada". Es decir: la clasificacion de las 120
   frases de ayer se hizo con una definicion enseñada con ejemplos falsos, y de ahi
   salia la asimetria que no cuadraba (banco 22% dos tiempos vs nicho 83%).
   Los ejemplos de abajo son REALES y verificados uno a uno.

2. La estructura resulto NECESARIA PERO NO SUFICIENTE (95% de los mejores, pero
   tambien 68% de los peores). Lo que de verdad separa es el TONO: con la MISMA
   estructura de dos tiempos, tono reflexivo -> mediana 588% de plays/seguidores;
   tono epico_motivador -> 18%. Treinta y tres veces menos. Por eso este script
   ahora clasifica tambien el tono: el registro de bebetter es el epico.

Capa de PAGO por defecto: es el banco de frases PROPIO y en la capa gratuita
Google entrena con los datos (regla del 2026-07-27). Es texto, cuesta centimos.

NO escribe en la base de datos: deja un JSON para revisar a mano.

Uso (desde beBetterStudio/):
    python server/scripts/auditar-frases-dostiempos.py              # todas (157)
    python server/scripts/auditar-frases-dostiempos.py --activas    # solo en rotacion
    python server/scripts/auditar-frases-dostiempos.py --limite 24
    python server/scripts/auditar-frases-dostiempos.py --tier free
"""
import json
import os
import re
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, '..', '.env')
DB = os.path.join(HERE, '..', '..', 'data', 'bebetter.db')
SALIDA = os.path.join(HERE, 'auditoria_frases.json')
MODELO = 'gemini-3.5-flash'
LOTE = 12

LIMITE = None
if '--limite' in sys.argv:
    LIMITE = int(sys.argv[sys.argv.index('--limite') + 1])
SOLO_ACTIVAS = '--activas' in sys.argv
TIER = 'pago'
if '--tier' in sys.argv:
    TIER = sys.argv[sys.argv.index('--tier') + 1]

try:
    # line_buffering: sin esto una corrida en background no muestra NADA, ni errores
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
except Exception:
    pass

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def env(clave):
    with open(ENV, encoding='utf-8') as f:
        m = re.search(rf'^{clave}\s*=\s*(\S+)', f.read(), re.M)
    return m.group(1) if m else None


KEY = env('GOOGLE_API_KEY') if TIER == 'pago' else (env('GOOGLE_API_KEY_FREE') or env('GOOGLE_API_KEY'))
if not KEY:
    sys.exit('ABORTO: falta la key de Gemini en server/.env')
print(f'tier {TIER}')

SISTEMA = """Analizas frases de una marca de contenido motivacional/estoico (bebetter) para Instagram.

=== ESTRUCTURA ===

"DOS TIEMPOS": la frase plantea una TENSION entre dos ideas que el lector debe sostener y
resolver (contraste, paradoja, analogia que se voltea, condicion con giro, acusacion con
vuelta). Obliga a procesar, y por eso retiene en los primeros segundos.

Ejemplos REALES de dos tiempos (verificados, rindieron 7.900%-10.700% sobre seguidores):
- "El perro come todos los dias pero lleva collar. El lobo a veces pasa hambre pero no responde ante nadie."
- "Quienes crecieron sin ver la paz y quienes crecieron sin ver la guerra tienen diferentes ideas sobre la justicia."
- "Si los musculos necesitan roturas y estres para crecer, que te hace pensar que la mente funciona distinto."
- "Las carreras se ganan en las curvas. En la recta, todos aceleran."   <- dos tiempos AUNQUE parezca lema

"UN GOLPE": afirmacion o sentencia que se entiende y se agota de inmediato. Puede ser bonita,
contundente o tener imagen poetica, pero no hay tension que resolver.

Ejemplos REALES de un golpe (verificados, rindieron 10%-14%):
- "Tu entorno tambien importa. Elige bien con quien te juntas."
- "La educacion es el arma mas poderosa que puedes usar para cambiar el mundo."
- "Nunca subestimes el poder de la gente estupida cuando se reune en grandes grupos."
- "Los grandes hombres son como las aguilas: construyen sus nidos en las alturas."  <- analogia que NO se voltea

CRITERIOS QUE IMPORTAN (se han equivocado antes):
- Tener DOS ORACIONES no la convierte en dos tiempos, y una sola oracion SI puede serlo.
  Lo unico que decide es si hay dos polos en tension que el lector deba resolver.
- Una analogia solo cuenta si se VOLTEA o se rompe contra el lector. Una comparacion
  decorativa ("los hombres son como aguilas") es un golpe.
- Ser una cita de un autor no influye en nada: clasifica la construccion, no la autoria.
- No seas complaciente. Si dudas, es un golpe.

=== TONO ===

Clasifica el registro de la frase:
- "reflexivo_calmado": observa, constata, deja pensando. Sin arengar.
- "epico_motivador": arenga, exalta, promete grandeza, habla de guerreros/leones/imperios/destino.
- "duro_confrontativo": acusa o señala al lector de frente, sin adornos.
- "melancolico": pesar, perdida, resignacion.
- "didactico": explica o instruye.

Dato para calibrar, NO para complacer: en el nicho el tono epico_motivador aparece casi solo
entre los reels que peor rinden. Clasifica lo que la frase ES, no lo que convendria."""

ESQUEMA = {
    'type': 'object',
    'properties': {
        'frases': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'id': {'type': 'string'},
                    'estructura': {'type': 'string', 'enum': ['dos_tiempos', 'un_golpe']},
                    'mecanismo': {'type': 'string', 'enum': ['contraste', 'paradoja', 'analogia_rota',
                                                             'condicional_con_giro', 'acusacion_con_vuelta', 'ninguno']},
                    'tono': {'type': 'string', 'enum': ['reflexivo_calmado', 'epico_motivador',
                                                        'duro_confrontativo', 'melancolico', 'didactico']},
                    'reconvertible': {'type': 'boolean', 'description': 'Si es un_golpe: la idea de fondo aguantaria una version en dos tiempos'},
                    'motivo': {'type': 'string', 'description': 'Una frase. Si es dos_tiempos, cual es la tension A<->B.'},
                },
                'required': ['id', 'estructura', 'mecanismo', 'tono', 'reconvertible', 'motivo'],
            },
        },
    },
    'required': ['frases'],
}


def gemini(frases):
    listado = '\n'.join(f'[{i}] {t}' for i, t in frases)
    cuerpo = {
        'systemInstruction': {'parts': [{'text': SISTEMA}]},
        'contents': [{'parts': [{'text': 'Clasifica estas frases. Devuelve el id tal cual:\n\n' + listado}]}],
        'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': ESQUEMA,
                             'temperature': 0.3},
    }
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent?key={KEY}',
        data=json.dumps(cuerpo).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, context=ctx, timeout=180) as r:
        d = json.loads(r.read())
    return json.loads(d['candidates'][0]['content']['parts'][0]['text'])['frases']


con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row
cols = [c['name'] for c in con.execute('pragma table_info(phrases)')]
tiene_archived = 'archived' in cols
q = 'select id, text, author, category, usage_count'
q += ', archived' if tiene_archived else ', 0 as archived'
q += ' from phrases'
if SOLO_ACTIVAS and tiene_archived:
    q += ' where archived = 0'
q += ' order by rowid'
filas = con.execute(q).fetchall()
if LIMITE:
    filas = filas[:LIMITE]
mapa = {str(r['id']): r for r in filas}
print(f'{len(filas)} frases a auditar, en lotes de {LOTE} -> {(len(filas)+LOTE-1)//LOTE} llamadas\n')

todo = []
pares = [(str(r['id']), r['text']) for r in filas]


def guardar():
    for t in todo:
        r = mapa.get(t['id'])
        t['texto'] = r['text'] if r else ''
        t['autor'] = (r['author'] if r else '') or 'PROPIA'
        t['usos'] = r['usage_count'] if r else 0
        t['archivada'] = bool(r['archived']) if r else False
        t['categoria'] = (r['category'] if r else None)
    json.dump(todo, open(SALIDA, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


for i in range(0, len(pares), LOTE):
    lote = pares[i:i + LOTE]
    n = i // LOTE + 1
    for intento in range(3):
        try:
            todo += gemini(lote)
            guardar()          # incremental: un fallo tardio no tira la sesion
            print(f'  lote {n}/{(len(pares)+LOTE-1)//LOTE} ok ({len(todo)} acumuladas)')
            break
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode('utf-8', 'replace')
            if e.code == 429 and 'PerDay' in cuerpo:
                print(f'  lote {n}: HTTP 429 CUOTA DIARIA AGOTADA ({TIER}). Reintentar no sirve.')
                guardar(); sys.exit(2)
            print(f'  lote {n}: HTTP {e.code}, reintento {intento+1}')
            time.sleep(12)
        except Exception as e:
            print(f'  lote {n}: {type(e).__name__} {str(e)[:120]}')
            time.sleep(5)
    time.sleep(3)

guardar()

# ── resumen ──────────────────────────────────────────────────────────────────
dos = [t for t in todo if t['estructura'] == 'dos_tiempos']
uno = [t for t in todo if t['estructura'] == 'un_golpe']
print(f'\n{len(todo)} clasificadas -> {SALIDA}')
print(f'  DOS TIEMPOS: {len(dos)} ({len(dos)*100//max(len(todo),1)}%)')
print(f'  UN GOLPE:    {len(uno)} — reconvertibles {sum(1 for t in uno if t["reconvertible"])}')
print('  mecanismos:', dict(Counter(t['mecanismo'] for t in dos)))

print('\n=== TONO (el hallazgo del 2026-07-29: el epico hunde) ===')
for tono, c in Counter(t['tono'] for t in todo).most_common():
    d = sum(1 for t in todo if t['tono'] == tono and t['estructura'] == 'dos_tiempos')
    print(f'  {tono:20} {c:4} ({c*100//max(len(todo),1)}%)  de ellas dos_tiempos: {d}')

print('\n=== EL CRUCE QUE IMPORTA: estructura x tono ===')
for e in ('dos_tiempos', 'un_golpe'):
    for tono in ('reflexivo_calmado', 'epico_motivador', 'duro_confrontativo'):
        c = sum(1 for t in todo if t['estructura'] == e and t['tono'] == tono)
        if c:
            print(f'  {e:12} + {tono:20} {c:4}')

for etiqueta, grupo in (('PROPIAS', [t for t in todo if t['autor'] == 'PROPIA']),
                        ('CON AUTOR', [t for t in todo if t['autor'] != 'PROPIA']),
                        ('test-dos-tiempos', [t for t in todo if t.get('categoria') == 'test-dos-tiempos']),
                        ('archivadas', [t for t in todo if t.get('archivada')])):
    if grupo:
        d = sum(1 for t in grupo if t['estructura'] == 'dos_tiempos')
        ep = sum(1 for t in grupo if t['tono'] == 'epico_motivador')
        print(f'  {etiqueta:18} n={len(grupo):4}  dos_tiempos {d*100//len(grupo)}%  epico {ep*100//len(grupo)}%')
