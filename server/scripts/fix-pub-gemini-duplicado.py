"""
Fix en [Pub] bebetter (fRgHVl5PndZVDNa8): los nodos Gemini se ejecutan SIEMPRE,
tambien cuando los copies ya vienen hechos.

QUE PASA
--------
'🎬 Gemini YouTube (nativo)' cuelga directamente del webhook, y
'📱 Gemini Instagram (nativo)' de la notificacion de YouTube. Se ejecutan en
TODA publicacion.

Pero sus consumidores los descartan cuando el paquete ya trae copies:

    Parse YT Meta   -> if (_b.preApproved && _b.ytMeta)    { usa el de la app }
    Format WhatsApp -> if (_b.preApproved && _b.captionIG) { usa el de la app }

Y el carril programado SIEMPRE los trae: '[Sched] bebetter' llama a este
workflow con preApproved:true + captionIG + ytMeta leidos del Google Sheet, que
son los que genero la app en POST /videos/:id/queue (por Vertex, con cargo a los
creditos del ensayo).

  => En cada publicacion programada se pagan DOS llamadas a Gemini cuya salida
     se tira. Con 3 reels/dia son ~180 llamadas tiradas al mes.

EL FIX
------
Un IF delante de cada nodo Gemini que lo saltee cuando el copy ya viene:

    Webhook ──> [IF ¿falta ytMeta?] ──true──> Gemini YouTube ──> Parse YT Meta
                                    └─false────────────────────────^

La condicion NO es solo `preApproved`: es `preApproved && trae el copy`. Si por
lo que sea llegara un paquete preAprobado SIN ytMeta, se sigue pasando por
Gemini — que es justo lo que hace hoy y lo que evita que el reel salga con el
titulo de reserva.

Idempotente: si los IF ya estan, no hace nada.

Uso (desde beBetterStudio/):
    python server/scripts/fix-pub-gemini-duplicado.py            # dry-run
    python server/scripts/fix-pub-gemini-duplicado.py --apply    # PUT a n8n
"""
import datetime
import json
import uuid
import os
import ssl
import sys
import urllib.error
import urllib.request

WF_ID = 'fRgHVl5PndZVDNa8'
BASE = 'https://n8n.galacticaima.com/api/v1/workflows/' + WF_ID
KEY = open(os.path.join(os.path.dirname(__file__), '..', '..', '.n8n-key')).read().strip()
APPLY = '--apply' in sys.argv

IF_YT = 'IF ya trae ytMeta'
IF_IG = 'IF ya trae captionIG'

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
hdr = {'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json'}


def buscar(wf, fragmento):
    """Nodo cuyo nombre contiene el fragmento. Los nombres reales llevan emoji y
    espacios de sobra, asi que no se pueden escribir a mano sin equivocarse."""
    hits = [n for n in wf['nodes'] if fragmento in n['name']]
    if len(hits) != 1:
        sys.exit(f'ABORTO: {len(hits)} nodos contienen "{fragmento}"')
    return hits[0]


def predecesores(wf, nombre):
    out = []
    for src, salidas in wf['connections'].items():
        for ramas in salidas.get('main', []):
            for c in (ramas or []):
                if c['node'] == nombre:
                    out.append(src)
    return out


def nodo_if(nombre, expresion, pos, typeversion):
    """IF booleano con la misma forma que el 'IF preApproved' que ya existe: se le
    copia la typeVersion en vez de fijar una, para no estrenar una version de nodo
    distinta a la que este n8n ya ejecuta."""
    return {
        'parameters': {
            'conditions': {
                'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 2},
                'combinator': 'and',
                'conditions': [{
                    'id': nombre.replace(' ', '-').lower(),
                    'leftValue': expresion,
                    'rightValue': True,
                    'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True},
                }],
            },
            'options': {},
        },
        'type': 'n8n-nodes-base.if',
        'typeVersion': typeversion,
        'position': pos,
        'id': str(uuid.uuid4()),
        'name': nombre,
    }


# 1) Traer workflow
wf = json.load(urllib.request.urlopen(urllib.request.Request(BASE, headers=hdr), context=ctx))
print(f"Workflow: {wf['name']} | active={wf['active']} | nodos={len(wf['nodes'])}")

if any(n['name'] in (IF_YT, IF_IG) for n in wf['nodes']):
    print('YA ESTABA: los IF ya existen. Nada que hacer.')
    sys.exit(0)

webhook = buscar(wf, 'Webhook Trigger')
gem_yt = buscar(wf, 'Gemini YouTube')
parse_yt = buscar(wf, 'Parse YT Meta')
gem_ig = buscar(wf, 'Gemini Instagram')
fmt_wa = buscar(wf, 'Format WhatsApp')

pre_ig = predecesores(wf, gem_ig['name'])
if len(pre_ig) != 1:
    sys.exit(f'ABORTO: {gem_ig["name"]} tiene {len(pre_ig)} predecesores: {pre_ig}')
antes_ig = pre_ig[0]

print(f"  webhook      : {webhook['name']}")
print(f"  gemini YT    : {gem_yt['name']}  ->  {parse_yt['name']}")
print(f"  gemini IG    : {gem_ig['name']}  ->  {fmt_wa['name']}   (viene de {antes_ig})")

# 2) Backup ANTES de mutar nada
stamp = datetime.datetime.now().strftime('%Y%m%dT%H%M%S')
bkp = os.path.join(os.path.dirname(__file__), f'wf_backup_geminidup_{WF_ID}_{stamp}.json')
json.dump(wf, open(bkp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('Backup:', bkp)

# 3) Construir los IF. `$json.body` en el que cuelga del webhook; desde el otro
#    hay que ir a buscar el webhook por nombre, igual que hacen los nodos de code.
wnom = webhook['name']
exp_yt = "={{ !($json.body.preApproved === true && !!$json.body.ytMeta) }}"
exp_ig = ("={{ !($('" + wnom + "').item.json.body.preApproved === true"
          " && !!$('" + wnom + "').item.json.body.captionIG) }}")

tv = buscar(wf, 'IF preApproved')['typeVersion']
print(f"  typeVersion del IF existente: {tv}")

pos_yt = [gem_yt['position'][0] - 180, gem_yt['position'][1]]
pos_ig = [gem_ig['position'][0] - 180, gem_ig['position'][1]]
wf['nodes'].append(nodo_if(IF_YT, exp_yt, pos_yt, tv))
wf['nodes'].append(nodo_if(IF_IG, exp_ig, pos_ig, tv))

# 4) Recablear. main[0] = rama TRUE (falta el copy -> Gemini), main[1] = FALSE.
def ir_a(nombre):
    return [{'node': nombre, 'type': 'main', 'index': 0}]

wf['connections'][wnom]['main'][0] = ir_a(IF_YT)
wf['connections'][IF_YT] = {'main': [ir_a(gem_yt['name']), ir_a(parse_yt['name'])]}

wf['connections'][antes_ig]['main'][0] = ir_a(IF_IG)
wf['connections'][IF_IG] = {'main': [ir_a(gem_ig['name']), ir_a(fmt_wa['name'])]}

print(f"\nFIX  {wnom} -> [{IF_YT}] -> (true) {gem_yt['name']} / (false) {parse_yt['name']}")
print(f"FIX  {antes_ig} -> [{IF_IG}] -> (true) {gem_ig['name']} / (false) {fmt_wa['name']}")

if not APPLY:
    print('\nDRY-RUN: no se toco n8n. Repite con --apply para hacer el PUT.')
    sys.exit(0)

# 5) PUT (settings filtrado: la API rechaza claves extra)
allowed = {'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
           'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'}
settings = {k: v for k, v in wf.get('settings', {}).items() if k in allowed}
payload = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'], 'settings': settings}
req = urllib.request.Request(BASE, data=json.dumps(payload).encode('utf-8'), method='PUT', headers=hdr)
try:
    res = json.load(urllib.request.urlopen(req, context=ctx))
    print('PUT OK -> updatedAt', res.get('updatedAt'), '| active', res.get('active'))
except urllib.error.HTTPError as e:
    print('PUT FALLO', e.code, e.read().decode()[:600]); sys.exit(1)
