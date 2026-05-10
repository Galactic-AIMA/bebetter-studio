const https = require('https')
const fs = require('fs')
const path = require('path')

const FONTS_DIR = path.join(__dirname, '../data/fonts')

const fonts = [
  { name: 'Montserrat-Bold',      family: 'Montserrat',        weight: '700' },
  { name: 'Montserrat-Regular',   family: 'Montserrat',        weight: '400' },
  { name: 'Playfair-Bold',        family: 'Playfair+Display',  weight: '700' },
  { name: 'Lato-Regular',         family: 'Lato',              weight: '400' },
  { name: 'Oswald-Bold',          family: 'Oswald',            weight: '700' },
  { name: 'RobotoCondensed-Bold', family: 'Roboto+Condensed',  weight: '700' },
]

// IE6 user-agent forces Google Fonts to return TTF (instead of WOFF2)
const OLD_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location, headers).then(resolve).catch(reject)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function downloadFont(font) {
  const cssUrl = `https://fonts.googleapis.com/css?family=${font.family}:${font.weight}`
  const css = (await get(cssUrl, { 'User-Agent': OLD_UA })).toString()

  const match = css.match(/src:\s*url\(([^)]+)\)/)
  if (!match) {
    console.error(`✗ ${font.name}: no se encontró URL TTF en la respuesta CSS`)
    return false
  }

  const fontUrl = match[1]
  const dest = path.join(FONTS_DIR, `${font.name}.ttf`)
  const data = await get(fontUrl, { 'User-Agent': OLD_UA })
  fs.writeFileSync(dest, data)
  console.log(`✓ ${font.name}.ttf (${(data.length / 1024).toFixed(0)} KB)`)
  return true
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true })
  console.log(`Descargando fuentes en ${FONTS_DIR}\n`)

  const results = await Promise.allSettled(fonts.map(downloadFont))
  const ok = results.filter(r => r.status === 'fulfilled' && r.value).length
  console.log(`\n${ok}/${fonts.length} fuentes descargadas.`)

  if (ok < fonts.length) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
