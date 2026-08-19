import Database from 'better-sqlite3'
import { Pool } from 'pg'

/**
 * La capa que separa el CÓDIGO de la app del MOTOR de base de datos (2026-08-19).
 *
 * Existe para partir en dos el riesgo de la migración a Postgres. Ese cambio mezcla
 * dos cosas peligrosas —pasar 131 llamadas de síncronas a `await`, y cambiar de
 * motor— y hacerlas a la vez significa que, si algo se rompe, no se sabe cuál de las
 * dos fue.
 *
 *   PASO 1 (esto)  la interfaz se vuelve ASÍNCRONA con SQLite todavía detrás. Las
 *                  131 llamadas se convierten una a una y la app sigue funcionando y
 *                  siendo verificable en cada paso. El compilador hace de lista de
 *                  tareas: una llamada sin `await` deja de tipar.
 *   PASO 2         se cambia el motor por Postgres. Para entonces el cambio ya es
 *                  pequeño y vive SOLO aquí dentro.
 *
 * La forma imita a `better-sqlite3` a propósito (`prepare().get/all/run`): así el
 * diff del paso 1 es casi todo añadir `await`, y no reescribir consultas.
 */

export interface RunResult {
  changes: number
  /** Solo lo usa `logService` con su tabla AUTOINCREMENT. En Postgres irá por RETURNING. */
  lastInsertRowid?: number | bigint
}

export interface Statement {
  get<T = any>(...params: any[]): Promise<T | undefined>
  all<T = any>(...params: any[]): Promise<T[]>
  run(...params: any[]): Promise<RunResult>
}

export interface DbClient {
  prepare(sql: string): Statement
  exec(sql: string): Promise<void>
  /**
   * Ejecuta `fn` dentro de una transacción: o pasa todo o no pasa nada.
   *
   * No se puede reusar `better-sqlite3.transaction()` porque exige una función
   * SÍNCRONA, y aquí todo el cuerpo es `await`. Se hace a mano con BEGIN/COMMIT,
   * que además es lo que ya habrá que hacer con Postgres.
   *
   * ⚠️ No anida: una transacción dentro de otra reventaría con "cannot start a
   * transaction within a transaction". Hoy ningún sitio lo hace.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** Cierra el motor. Lo usan los scripts de migración y las pruebas. */
  close(): Promise<void>
}

/**
 * Cliente sobre `better-sqlite3`.
 *
 * Las promesas aquí son sinceramente falsas —SQLite responde en el acto— pero es
 * justo lo que se quiere del paso 1: el contrato ya es el definitivo y el
 * comportamiento no cambia todavía, así que cualquier fallo que aparezca al
 * convertir las llamadas es del refactor y no del motor nuevo.
 */
export function clienteSqlite(sqlite: Database.Database): DbClient {
  // Las sentencias se cachean como ya hacía `better-sqlite3` por dentro: varias
  // rutas preparan la misma consulta en cada petición.
  const cache = new Map<string, Database.Statement>()
  const preparar = (sql: string): Database.Statement => {
    let st = cache.get(sql)
    if (!st) {
      st = sqlite.prepare(sql)
      cache.set(sql, st)
    }
    return st
  }

  return {
    prepare(sql: string): Statement {
      return {
        async get<T>(...params: any[]) {
          return preparar(sql).get(...params) as T | undefined
        },
        async all<T>(...params: any[]) {
          return preparar(sql).all(...params) as T[]
        },
        async run(...params: any[]) {
          const r = preparar(sql).run(...params)
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
        },
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql)
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      sqlite.exec('BEGIN')
      try {
        const r = await fn()
        sqlite.exec('COMMIT')
        return r
      } catch (e) {
        // El ROLLBACK va en su propio try: si la transacción ya se deshizo sola
        // (por ejemplo, tras un error de SQLite), fallaría y taparía el error real.
        try { sqlite.exec('ROLLBACK') } catch { /* ya estaba deshecha */ }
        throw e
      }
    },
    async close() {
      cache.clear()
      sqlite.close()
    },
  }
}


// ── Postgres ─────────────────────────────────────────────────────────────────

/**
 * Traduce los placeholders de SQLite a los de Postgres.
 *
 *   `?`      posicional  →  $1, $2, $3…
 *   `@nombre` con nombre →  $n, según el orden en que aparece
 *
 * Es la única pieza con lógica de verdad de todo el cliente, y por eso está
 * separada y probada: un error aquí no falla al arrancar, desplaza un parámetro y
 * guarda el dato en la columna de al lado.
 *
 * Se salta lo que hay dentro de literales de cadena: `WHERE tags != '[]'` no lleva
 * placeholders, pero un `'?'` dentro de un texto sí se confundiría con uno.
 */
export function traducirSql(sql: string): { texto: string; nombres: string[] } {
  const nombres: string[] = []
  let salida = ''
  let i = 0
  let enCadena: string | null = null

  while (i < sql.length) {
    const c = sql[i]

    if (enCadena) {
      salida += c
      // '' dentro de una cadena es una comilla escapada, no el cierre.
      if (c === enCadena) {
        if (sql[i + 1] === enCadena) { salida += sql[i + 1]; i += 2; continue }
        enCadena = null
      }
      i++
      continue
    }

    if (c === "'" || c === '"') { enCadena = c; salida += c; i++; continue }

    if (c === '?') {
      nombres.push('')            // posicional: el orden es su nombre
      salida += `$${nombres.length}`
      i++
      continue
    }

    if (c === '@') {
      const m = /^@([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(i))
      if (m) {
        // Un mismo nombre puede repetirse en la consulta (por ejemplo en un
        // ON CONFLICT DO UPDATE) y debe reusar SU MISMO $n, no consumir otro.
        const ya = nombres.indexOf(m[1])
        if (ya >= 0) {
          salida += `$${ya + 1}`
        } else {
          nombres.push(m[1])
          salida += `$${nombres.length}`
        }
        i += m[0].length
        continue
      }
    }

    salida += c
    i++
  }

  return { texto: salida, nombres }
}

/** Aplana los parámetros al orden que espera Postgres. */
function valores(nombres: string[], params: any[]): any[] {
  const conNombre = nombres.some((n) => n !== '')
  if (!conNombre) {
    // Posicionales: pueden venir sueltos (`.run(a, b)`) o en un array.
    return params.length === 1 && Array.isArray(params[0]) ? params[0] : params
  }
  const obj = params[0] ?? {}
  return nombres.map((n) => {
    const v = obj[n]
    // `undefined` viaja como NULL: `pg` lo rechazaría, y en SQLite un campo que no
    // se pasa ya se guardaba como NULL.
    return v === undefined ? null : v
  })
}

/**
 * Cliente sobre Postgres.
 *
 * Usa UNA conexión del pool por consulta, salvo dentro de `transaction`, que toma
 * una y la retiene: BEGIN y COMMIT tienen que ir por el mismo socket o la
 * transacción no existe. Sin eso funcionaría en las pruebas —el pool suele dar la
 * misma— y fallaría bajo carga.
 */
export function clientePostgres(pool: Pool): DbClient {
  const cache = new Map<string, { texto: string; nombres: string[] }>()
  const traducir = (sql: string) => {
    let t = cache.get(sql)
    if (!t) { t = traducirSql(sql); cache.set(sql, t) }
    return t
  }

  // Conexión retenida mientras hay una transacción en curso.
  let enTx: any = null

  const ejecutar = async (sql: string, params: any[]) => {
    const { texto, nombres } = traducir(sql)
    const vals = valores(nombres, params)
    if (enTx) return enTx.query(texto, vals)
    return pool.query(texto, vals)
  }

  return {
    prepare(sql: string): Statement {
      return {
        async get<T>(...params: any[]) {
          const r = await ejecutar(sql, params)
          return r.rows[0] as T | undefined
        },
        async all<T>(...params: any[]) {
          const r = await ejecutar(sql, params)
          return r.rows as T[]
        },
        async run(...params: any[]) {
          const r = await ejecutar(sql, params)
          return { changes: r.rowCount ?? 0 }
        },
      }
    },
    async exec(sql: string) {
      if (enTx) { await enTx.query(sql); return }
      await pool.query(sql)
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (enTx) throw new Error('Transacción anidada: no está soportado')
      const cli = await pool.connect()
      enTx = cli
      try {
        await cli.query('BEGIN')
        const r = await fn()
        await cli.query('COMMIT')
        return r
      } catch (e) {
        try { await cli.query('ROLLBACK') } catch { /* ya estaba deshecha */ }
        throw e
      } finally {
        enTx = null
        cli.release()
      }
    },
    async close() {
      cache.clear()
      await pool.end()
    },
  }
}
