# -*- coding: utf-8 -*-
"""
Agrega el comando /cola al workflow [Pub] bebetter (fRgHVl5PndZVDNa8).

Al enviar "/cola" al bot de Telegram, responde con la proyección de las
próximas publicaciones (los `approved` de la Cola emparejados con las próximas
franjas de cadencia). Misma lógica que server/src/utils/schedule.ts y el
endpoint GET /api/cadence/schedule de la app.

Inserta 5 nodos y reenrutas el Telegram Trigger:

    Telegram Trigger ─▶ ❓ Es /cola?
                          ├─(true)─▶ 📥 Leer cola ─▶ 📅 Leer cadencia ─▶ 🧮 Proyectar /cola ─▶ 📤 Responder /cola
                          └─(false)▶ 🧭 Es reply?   (cadena existente, intacta)

Hace backup del workflow antes de tocar nada. Por defecto es DRY-RUN (solo
imprime el plan); pasa --apply para hacer el PUT.

Uso (desde beBetterStudio/):
    python server/scripts/add-cola-command.py            # dry-run
    python server/scripts/add-cola-command.py --apply    # aplica el PUT
"""
import json, os, ssl, sys, uuid, datetime, urllib.request, urllib.error

WF_ID = 'fRgHVl5PndZVDNa8'
BASE = 'https://n8n.galacticaima.com/api/v1/workflows/' + WF_ID
KEY = open(os.path.join(os.path.dirname(__file__), '..', '..', '.n8n-key')).read().strip()

SHEET_ID = '1QwH2iT0t0h9mIhoHRnWO-pVXhNXwhV1mtyuvdV7kkgs'
COLA_GID = '1637724194'
CONFIG_GID = '491336242'

# Nombres de nodos
TRIGGER = 'Telegram Trigger'
ES_REPLY = '🧭 Es reply?'
IF_COLA = '❓ Es /cola?'
LEER_COLA = '📥 Leer cola (/cola)'
LEER_CAD = '📅 Leer cadencia (/cola)'
PROYECTAR = '🧮 Proyectar /cola'
RESPONDER = '📤 Responder /cola'

# --- Código del nodo Proyectar (mismo algoritmo que schedule.ts) ---
PROJECT_JS = r'''
const rows = $('📥 Leer cola (/cola)').all().map(i => i.json);
const cfgRows = $('📅 Leer cadencia (/cola)').all().map(i => i.json);
const cfg = {};
for (const r of cfgRows) { if (r.key) cfg[String(r.key).trim()] = String(r.value == null ? '' : r.value).trim(); }
const times = (cfg.cadence_times || '').split(',').map(s => s.trim()).filter(Boolean);
const tz = cfg.timezone || 'America/Bogota';

const approved = rows
  .filter(r => String(r.status || '').trim() === 'approved' && !String(r.publishedAt || '').trim())
  .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

const trig = $('Telegram Trigger').first().json;
const chatId = (trig.message && trig.message.chat && trig.message.chat.id) || 8739538908;

function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = {}; for (const x of dtf.formatToParts(date)) p[x.type] = x.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}
function projectSlots(n, times, tz, now) {
  const hours = times.map(t => Number(String(t).split(':')[0])).filter(h => Number.isInteger(h) && h >= 0 && h <= 23).sort((a, b) => a - b);
  if (!hours.length || !n) return [];
  const off = tzOffsetMinutes(tz, now);
  const wall = new Date(now.getTime() + off * 60000);
  const Y = wall.getUTCFullYear(), Mo = wall.getUTCMonth(), D = wall.getUTCDate(), ch = wall.getUTCHours(), cm = wall.getUTCMinutes();
  const slots = [];
  for (let day = 0; slots.length < n && day < 90; day++) {
    for (const h of hours) {
      if (day === 0 && (h < ch || (h === ch && cm > 0))) continue;
      slots.push({ dayOffset: day, hour: h, etaMs: Date.UTC(Y, Mo, D + day, h, 0, 0) - off * 60000 });
      if (slots.length >= n) break;
    }
  }
  return slots;
}
function label(s, tz) {
  if (!s) return '—';
  const t = String(s.hour).padStart(2, '0') + ':00';
  if (s.dayOffset === 0) return 'Hoy ' + t;
  if (s.dayOffset === 1) return 'Mañana ' + t;
  const ds = new Date(s.etaMs).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: tz });
  return ds + ' ' + t;
}

const slots = projectSlots(approved.length, times, tz, new Date());
let msg;
if (!approved.length) {
  msg = '✅ *Cola de aprobados*\n\nNo hay videos aprobados esperando publicación.';
} else if (!times.length) {
  msg = '⚠️ Hay ' + approved.length + ' aprobado(s) pero *no hay cadencia configurada* — no se publicarán hasta definir horas en la app.';
} else {
  const lines = approved.map((r, i) => {
    const ph = String(r.phrase || '').replace(/\s+/g, ' ').slice(0, 45);
    return (i + 1) + '. "' + ph + '" → *' + label(slots[i], tz) + '*';
  });
  msg = '📋 *Próximas publicaciones* (' + approved.length + ' en cola)\n\n' + lines.join('\n') + '\n\n_Cadencia: ' + times.join(', ') + ' · ' + tz + '_';
}
return [{ json: { chatId, msg } }];
'''.strip()


def api(method, data=None):
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    hdr = {'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json'}
    body = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(BASE, data=body, method=method, headers=hdr)
    return json.load(urllib.request.urlopen(req, context=ctx))


def clone(nodes, name):
    for n in nodes:
        if n['name'] == name:
            c = json.loads(json.dumps(n))
            c.pop('webhookId', None)
            c['id'] = str(uuid.uuid4())
            return c
    raise SystemExit('No encontré el nodo a clonar: ' + name)


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # consola de Windows (cp1252) + emojis
    except Exception:
        pass
    apply = '--apply' in sys.argv
    wf = api('GET')
    original = json.loads(json.dumps(wf))  # copia intacta para el backup
    nodes = wf['nodes']
    conns = wf['connections']
    names = {n['name'] for n in nodes}

    if IF_COLA in names:
        raise SystemExit('El nodo "%s" ya existe — el comando /cola parece ya instalado. Aborto.' % IF_COLA)
    for req in (TRIGGER, ES_REPLY):
        if req not in names:
            raise SystemExit('No existe el nodo requerido: ' + req)

    print('Nodos actuales:', len(nodes))

    # --- Nodos nuevos ---
    if_node = {
        'id': str(uuid.uuid4()), 'name': IF_COLA, 'type': 'n8n-nodes-base.if',
        'typeVersion': 2, 'position': [180, 1240],
        'parameters': {'conditions': {'options': {'caseSensitive': False, 'typeValidation': 'loose', 'version': 2},
            'combinator': 'and', 'conditions': [{'id': 'is-cola',
                'leftValue': "={{ (($json.message || {}).text || '').trim().toLowerCase() }}",
                'rightValue': '/cola', 'operator': {'type': 'string', 'operation': 'startsWith'}}]}, 'options': {}},
    }
    leer_cola = clone(nodes, '🔑 Leer token IG')
    leer_cola['name'] = LEER_COLA; leer_cola['position'] = [420, 1360]
    leer_cola['parameters'] = {'documentId': {'__rl': True, 'value': SHEET_ID, 'mode': 'id'},
        'sheetName': {'__rl': True, 'value': COLA_GID, 'mode': 'id'}, 'options': {}}
    leer_cad = clone(nodes, '🔑 Leer token IG')
    leer_cad['name'] = LEER_CAD; leer_cad['position'] = [660, 1360]
    leer_cad['parameters'] = {'documentId': {'__rl': True, 'value': SHEET_ID, 'mode': 'id'},
        'sheetName': {'__rl': True, 'value': CONFIG_GID, 'mode': 'id'}, 'options': {}}
    proyectar = {'id': str(uuid.uuid4()), 'name': PROYECTAR, 'type': 'n8n-nodes-base.code',
        'typeVersion': 2, 'position': [900, 1360], 'parameters': {'jsCode': PROJECT_JS}}
    responder = clone(nodes, 'Enviar copy Telegram (David)')
    responder['name'] = RESPONDER; responder['position'] = [1140, 1360]
    responder['parameters'] = {'chatId': '={{ $json.chatId }}', 'text': '={{ $json.msg }}',
        'additionalFields': {'appendAttribution': False, 'parse_mode': 'Markdown'}}

    nodes.extend([if_node, leer_cola, leer_cad, proyectar, responder])

    # --- Reenrutado ---
    conns[TRIGGER] = {'main': [[{'node': IF_COLA, 'type': 'main', 'index': 0}]]}
    conns[IF_COLA] = {'main': [
        [{'node': LEER_COLA, 'type': 'main', 'index': 0}],   # out0 = true  (/cola)
        [{'node': ES_REPLY, 'type': 'main', 'index': 0}],    # out1 = false (cadena existente)
    ]}
    conns[LEER_COLA] = {'main': [[{'node': LEER_CAD, 'type': 'main', 'index': 0}]]}
    conns[LEER_CAD] = {'main': [[{'node': PROYECTAR, 'type': 'main', 'index': 0}]]}
    conns[PROYECTAR] = {'main': [[{'node': RESPONDER, 'type': 'main', 'index': 0}]]}

    print('Plan: Telegram Trigger -> %s ; true -> %s -> %s -> %s -> %s ; false -> %s'
          % (IF_COLA, LEER_COLA, LEER_CAD, PROYECTAR, RESPONDER, ES_REPLY))
    print('Nodos tras el cambio:', len(nodes))

    if not apply:
        print('\nDRY-RUN. Revisa el plan y corre con --apply para hacer el PUT.')
        return

    # Backup antes del PUT
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    bkp = os.path.join(os.path.dirname(__file__), 'wf_pub_backup_%s.json' % stamp)
    json.dump(original, open(bkp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('Backup (workflow original):', bkp)

    allowed = {'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
               'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'}
    settings = {k: v for k, v in wf.get('settings', {}).items() if k in allowed}
    payload = {'name': wf['name'], 'nodes': nodes, 'connections': conns, 'settings': settings}
    try:
        res = api('PUT', payload)
        print('PUT OK -> updatedAt', res.get('updatedAt'), '| active', res.get('active'), '| nodos', len(res.get('nodes', [])))
        print('Prueba: envía "/cola" al bot en Telegram.')
    except urllib.error.HTTPError as e:
        print('PUT FALLO', e.code, e.read().decode()[:800]); sys.exit(1)


if __name__ == '__main__':
    main()
