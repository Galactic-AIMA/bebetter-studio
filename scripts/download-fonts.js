const https = require('https')
const fs = require('fs')
const path = require('path')

const FONTS_DIR = path.join(__dirname, '../data/fonts')

// IE6 user-agent forces Google Fonts to return TTF
const OLD_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'

// All font variants needed by the app
// name: filename in data/fonts/ (without .ttf)
// family: Google Fonts family name (URL-encoded)
// weight: numeric weight
// italic: true for italic variant
const fonts = [
  // Montserrat
  { name: 'Montserrat-Regular',       family: 'Montserrat',       weight: '400' },
  { name: 'Montserrat-Thin',          family: 'Montserrat',       weight: '100' },
  { name: 'Montserrat-Italic',        family: 'Montserrat',       weight: '400', italic: true },
  { name: 'Montserrat-Bold',          family: 'Montserrat',       weight: '700' },
  // Playfair Display
  { name: 'PlayfairDisplay-Regular',  family: 'Playfair+Display', weight: '400' },
  { name: 'PlayfairDisplay-Thin',     family: 'Playfair+Display', weight: '200' },
  { name: 'PlayfairDisplay-Italic',   family: 'Playfair+Display', weight: '400', italic: true },
  { name: 'PlayfairDisplay-Bold',     family: 'Playfair+Display', weight: '700' },
  // Lato
  { name: 'Lato-Regular',             family: 'Lato',             weight: '400' },
  { name: 'Lato-Thin',                family: 'Lato',             weight: '100' },
  { name: 'Lato-Italic',              family: 'Lato',             weight: '400', italic: true },
  { name: 'Lato-Bold',                family: 'Lato',             weight: '700' },
  // Oswald (no italic)
  { name: 'Oswald-Regular',           family: 'Oswald',           weight: '400' },
  { name: 'Oswald-Thin',              family: 'Oswald',           weight: '300' },
  { name: 'Oswald-Bold',              family: 'Oswald',           weight: '700' },
  // Roboto Condensed
  { name: 'RobotoCondensed-Regular',  family: 'Roboto+Condensed', weight: '400' },
  { name: 'RobotoCondensed-Thin',     family: 'Roboto+Condensed', weight: '100' },
  { name: 'RobotoCondensed-Italic',   family: 'Roboto+Condensed', weight: '400', italic: true },
  { name: 'RobotoCondensed-Bold',     family: 'Roboto+Condensed', weight: '700' },
  // Anton (solo Regular)
  { name: 'Anton-Regular',            family: 'Anton',            weight: '400' },
  // Inter
  { name: 'Inter-Regular',            family: 'Inter',            weight: '400' },
  { name: 'Inter-Thin',               family: 'Inter',            weight: '100' },
  { name: 'Inter-Italic',             family: 'Inter',            weight: '400', italic: true },
  { name: 'Inter-Bold',               family: 'Inter',            weight: '700' },
  // IBM Plex Sans
  { name: 'IBMPlexSans-Regular',      family: 'IBM+Plex+Sans',    weight: '400' },
  { name: 'IBMPlexSans-Thin',         family: 'IBM+Plex+Sans',    weight: '100' },
  { name: 'IBMPlexSans-Italic',       family: 'IBM+Plex+Sans',    weight: '400', italic: true },
  { name: 'IBMPlexSans-Bold',         family: 'IBM+Plex+Sans',    weight: '700' },
]

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': OLD_UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function downloadFont(font) {
  const dest = path.join(FONTS_DIR, `${font.name}.ttf`)
  if (fs.existsSync(dest)) {
    console.log(`  ↩ ${font.name}.ttf (ya existe, omitido)`)
    return true
  }

  const weightParam = font.italic ? `${font.weight}italic` : font.weight
  const cssUrl = `https://fonts.googleapis.com/css?family=${font.family}:${weightParam}`
  const css = (await get(cssUrl)).toString()

  const match = css.match(/src:\s*url\(([^)]+)\)/)
  if (!match) {
    console.error(`  ✗ ${font.name}: URL no encontrada en respuesta CSS`)
    return false
  }

  const data = await get(match[1])
  fs.writeFileSync(dest, data)
  console.log(`  ✓ ${font.name}.ttf (${(data.length / 1024).toFixed(0)} KB)`)
  return true
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true })
  console.log(`Descargando fuentes en ${FONTS_DIR}\n`)

  let ok = 0
  for (const font of fonts) {
    const result = await downloadFont(font).catch(e => {
      console.error(`  ✗ ${font.name}: ${e.message}`)
      return false
    })
    if (result) ok++
  }

  console.log(`\n${ok}/${fonts.length} fuentes disponibles.`)
  if (ok < fonts.length) process.exit(1)
}

main()
