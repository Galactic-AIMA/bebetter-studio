import Database from 'better-sqlite3'

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
