/**
 * Descarga fuentes TTF desde Google Fonts (ZIP) y GitHub como fallback.
 * Uso: node scripts/download-fonts.js [--force]
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')

const FONTS_DIR = path.resolve(__dirname, '../data/fonts')
const FORCE = process.argv.includes('--force')

// Familia → variantes necesarias { destName: nombreDentroDelZip }
const FAMILIES = {
  Montserrat: {
    googleFamily: 'Montserrat',
    variants: {
      'Montserrat-Regular': 'static/Montserrat-Regular.ttf',
      'Montserrat-Thin':    'static/Montserrat-Thin.ttf',
      'Montserrat-Italic':  'static/Montserrat-Italic.ttf',
      'Montserrat-Bold':    'static/Montserrat-Bold.ttf',
    },
  },
  PlayfairDisplay: {
    googleFamily: 'Playfair Display',
    variants: {
      'PlayfairDisplay-Regular': 'static/PlayfairDisplay-Regular.ttf',
      'PlayfairDisplay-Italic':  'static/PlayfairDisplay-Italic.ttf',
      'PlayfairDisplay-Bold':    'static/PlayfairDisplay-Bold.ttf',
    },
  },
  Lato: {
    googleFamily: 'Lato',
    variants: {
      'Lato-Regular': 'Lato-Regular.ttf',
      'Lato-Thin':    'Lato-Thin.ttf',
      'Lato-Italic':  'Lato-Italic.ttf',
      'Lato-Bold':    'Lato-Bold.ttf',
    },
  },
  Oswald: {
    googleFamily: 'Oswald',
    variants: {
      'Oswald-Regular': 'static/Oswald-Regular.ttf',
      'Oswald-Thin':    'static/Oswald-Light.ttf',
      'Oswald-Bold':    'static/Oswald-Bold.ttf',
    },
  },
  RobotoCondensed: {
    googleFamily: 'Roboto Condensed',
    variants: {
      'RobotoCondensed-Regular': 'static/RobotoCondensed-Regular.ttf',
      'RobotoCondensed-Thin':    'static/RobotoCondensed-Thin.ttf',
      'RobotoCondensed-Italic':  'static/RobotoCondensed-Italic.ttf',
      'RobotoCondensed-Bold':    'static/RobotoCondensed-Bold.ttf',
    },
  },
  Inter: {
    googleFamily: 'Inter',
    variants: {
      'Inter-Regular': 'static/Inter-Regular.ttf',
      'Inter-Thin':    'static/Inter-Thin.ttf',
      'Inter-Italic':  'static/Inter-Italic.ttf',
      'Inter-Bold':    'static/Inter-Bold.ttf',
    },
  },
  IBMPlexSans: {
    googleFamily: 'IBM Plex Sans',
    variants: {
      'IBMPlexSans-Regular': 'IBMPlexSans-Regular.ttf',
      'IBMPlexSans-Thin':    'IBMPlexSans-Thin.ttf',
      'IBMPlexSans-Italic':  'IBMPlexSans-Italic.ttf',
      'IBMPlexSans-Bold':    'IBMPlexSans-Bold.ttf',
    },
  },
  Anton: {
    googleFamily: 'Anton',
    variants: {
      'Anton-Regular': 'Anton-Regular.ttf',
    },
  },
}

function isValidTTF(buf) {
  if (buf.length < 4) return false
  const sig = buf.readUInt32BE(0)
  return sig === 0x00010000 || sig === 0x4F54544F
}

function downloadZip(family) {
  const encodedFamily = encodeURIComponent(family)
  const url = `https://fonts.google.com/download?family=${encodedFamily}`
  const tmpZip = path.join(os.tmpdir(), `gfont_${Date.now()}.zip`)
  const tmpDir = path.join(os.tmpdir(), `gfont_${Date.now()}`)

  execSync(
    `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${tmpZip}' -UseBasicParsing"`,
    { stdio: 'pipe' }
  )

  execSync(
    `powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`,
    { stdio: 'pipe' }
  )

  return { tmpZip, tmpDir }
}

function findFileInDir(dir, relativePath) {
  // Busca el archivo respetando la ruta relativa, o en cualquier subdirectorio si no se encuentra
  const direct = path.join(dir, relativePath)
  if (fs.existsSync(direct)) return direct

  // Buscar por nombre de archivo en todo el árbol
  const filename = path.basename(relativePath)
  const found = findByName(dir, filename)
  return found
}

function findByName(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const r = findByName(full, name)
      if (r) return r
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

function cleanup(...paths) {
  for (const p of paths) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
  }
}

async function processFamily(familyKey, def) {
  const needed = Object.entries(def.variants).filter(([destName]) => {
    const dest = path.join(FONTS_DIR, `${destName}.ttf`)
    if (!FORCE && fs.existsSync(dest) && isValidTTF(fs.readFileSync(dest))) {
      console.log(`  ↩ ${destName}.ttf (ya existe y es válido)`)
      return false
    }
    return true
  })

  if (needed.length === 0) return 0

  console.log(`  Descargando ZIP de Google Fonts: ${def.googleFamily}...`)
  let tmpZip, tmpDir
  try {
    ({ tmpZip, tmpDir } = downloadZip(def.googleFamily))
  } catch (e) {
    console.error(`  ✗ No se pudo descargar ZIP de ${def.googleFamily}: ${e.message}`)
    return 0
  }

  let ok = 0
  for (const [destName, zipRelPath] of needed) {
    const dest = path.join(FONTS_DIR, `${destName}.ttf`)
    const src = findFileInDir(tmpDir, zipRelPath)
    if (!src) {
      console.error(`  ✗ ${destName}: no encontrado en ZIP (buscando: ${zipRelPath})`)
      continue
    }
    const data = fs.readFileSync(src)
    if (!isValidTTF(data)) {
      console.error(`  ✗ ${destName}: archivo en ZIP no es TTF válido`)
      continue
    }
    fs.copyFileSync(src, dest)
    console.log(`  ✓ ${destName}.ttf (${(data.length / 1024).toFixed(0)} KB)`)
    ok++
  }

  cleanup(tmpZip, tmpDir)
  return ok
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true })
  console.log(`Descargando fuentes en ${FONTS_DIR}\n`)

  let totalOk = 0
  let totalNeeded = 0

  for (const [key, def] of Object.entries(FAMILIES)) {
    console.log(`[${key}]`)
    const count = await processFamily(key, def).catch(e => {
      console.error(`  ✗ Error procesando ${key}: ${e.message}`)
      return 0
    })
    totalOk += count
    totalNeeded += Object.keys(def.variants).length
    console.log()
  }

  // Verificación final
  let valid = 0
  for (const def of Object.values(FAMILIES)) {
    for (const destName of Object.keys(def.variants)) {
      const f = path.join(FONTS_DIR, `${destName}.ttf`)
      if (fs.existsSync(f) && isValidTTF(fs.readFileSync(f))) valid++
    }
  }

  console.log(`${valid}/${totalNeeded} fuentes válidas en ${FONTS_DIR}`)
  if (valid < totalNeeded) process.exit(1)
}

main()
