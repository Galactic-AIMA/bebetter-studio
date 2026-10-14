/**
 * Prueba de la traducción de placeholders SQLite → Postgres (2026-08-19).
 *
 * Es la única pieza con lógica de verdad del cliente, y su modo de fallo es el peor
 * posible: no revienta, DESPLAZA un parámetro y guarda el dato en la columna de al
 * lado. Por eso se prueba aparte y con los casos raros que hay en el código real.
 */
import { traducirSql } from '../src/dbClient'

let fallos = 0
function caso(nombre: string, sql: string, esperado: string, nombresEsperados: string[]) {
  const { texto, nombres } = traducirSql(sql)
  const okTexto = texto === esperado
  const okNombres = JSON.stringify(nombres) === JSON.stringify(nombresEsperados)
  if (!okTexto || !okNombres) {
    fallos++
    console.log(`FALLO  ${nombre}`)
    if (!okTexto) console.log(`   esperado: ${esperado}\n   obtenido: ${texto}`)
    if (!okNombres) console.log(`   nombres esperados: ${JSON.stringify(nombresEsperados)}  obtenidos: ${JSON.stringify(nombres)}`)
  } else {
    console.log(`ok     ${nombre}`)
  }
}

caso('posicional simple',
  'SELECT * FROM t WHERE a = ? AND b = ?',
  'SELECT * FROM t WHERE a = $1 AND b = $2', ['', ''])

caso('con nombre',
  'INSERT INTO t (a, b) VALUES (@uno, @dos)',
  'INSERT INTO t (a, b) VALUES ($1, $2)', ['uno', 'dos'])

// El caso que de verdad importa: un ON CONFLICT DO UPDATE repite los nombres.
caso('nombre repetido reusa su $n',
  'INSERT INTO t (a, b) VALUES (@x, @y) ON CONFLICT (a) DO UPDATE SET b = @y, a = @x',
  'INSERT INTO t (a, b) VALUES ($1, $2) ON CONFLICT (a) DO UPDATE SET b = $2, a = $1', ['x', 'y'])

// Un literal con signos de interrogación NO debe contar como placeholder.
caso('interrogante dentro de cadena',
  "SELECT * FROM t WHERE tags != '[]' AND nota = '¿y?' AND a = ?",
  "SELECT * FROM t WHERE tags != '[]' AND nota = '¿y?' AND a = $1", [''])

caso('arroba dentro de cadena',
  "SELECT * FROM t WHERE handle = '@bebetter.path' AND a = ?",
  "SELECT * FROM t WHERE handle = '@bebetter.path' AND a = $1", [''])

caso('comilla escapada dentro de cadena',
  "SELECT * FROM t WHERE s = 'no ''?'' aqui' AND a = ?",
  "SELECT * FROM t WHERE s = 'no ''?'' aqui' AND a = $1", [''])

caso('json path con $ no se toca',
  "SELECT json_extract(x, '$.imageId') FROM t WHERE a = ?",
  "SELECT json_extract(x, '$.imageId') FROM t WHERE a = $1", [''])

caso('sin placeholders',
  'SELECT COUNT(*) FROM phrases',
  'SELECT COUNT(*) FROM phrases', [])

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
