/**
 * Importa a la app los carruseles generados con el skill `carrusel-bebetter`
 * (Fase 1), que viven fuera de la DB en:
 *     .claude/skills/carrusel-bebetter/output/carruseles/<slug>/
 *         plan.json + slide_1.png … slide_N.png
 *
 * Copia los PNG a output/carruseles/<uuid>/ e inserta la fila en `carousels`,
 * para que aparezcan en el historial del Modo Carrusel y se puedan encolar y
 * publicar sin regenerarlos.
 *
 * Si hay PNGs que el plan.json no lista (p. ej. slides extra generadas con
 * generar_extra.py), se importan igual con el texto en blanco: el archivo manda.
 *
 * Idempotente: si ya se importó un carrusel con el mismo tema y nº de slides,
 * lo salta (a menos que pases --force).
 *
 * Uso (desde donde sea):
 *     npx tsx server/scripts/import-skill-carousel.ts            # dry-run
 *     npx tsx server/scripts/import-skill-carousel.ts --apply
 *     npx tsx server/scripts/import-skill-carousel.ts --apply --force
 */

import * as path from 'path'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.join(__dirname, '../.env') })
dotenv.config({ path: path.join(__dirname, '../../.env') })
process.chdir(path.join(__dirname, '..'))

import { randomUUID } from 'crypto'
import db from '../src/db'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const SKILL_OUT = path.join(__dirname, '../../.claude/skills/carrusel-bebetter/output/carruseles')
const APP_OUT = path.join(__dirname, '../../output/carruseles')

type Rol = 'portada' | 'desarrollo' | 'historia' | 'cta'
interface Slide {
  n: number
  rol: Rol
  texto: string
  simbolo?: string
  publicUrl?: string
}

function main() {
  if (!fs.existsSync(SKILL_OUT)) {
    console.log('No existe la carpeta del skill:', SKILL_OUT)
    return
  }

  const slugs = fs.readdirSync(SKILL_OUT).filter((d) => fs.statSync(path.join(SKILL_OUT, d)).isDirectory())
  if (!slugs.length) {
    console.log('No hay carruseles en', SKILL_OUT)
    return
  }
  console.log(`Carruseles del skill encontrados: ${slugs.join(', ')}\n`)

  for (const slug of slugs) {
    const dir = path.join(SKILL_OUT, slug)
    const planPath = path.join(dir, 'plan.json')

    // PNGs presentes en disco, ordenados por su número
    const pngs = fs
      .readdirSync(dir)
      .filter((f) => /^slide_\d+\.png$/i.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))

    if (!pngs.length) {
      console.log(`— ${slug}: sin PNGs, se salta.`)
      continue
    }

    let plan: any = {}
    if (fs.existsSync(planPath)) {
      try {
        plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'))
      } catch {
        console.log(`— ${slug}: plan.json ilegible, se importan solo las imágenes.`)
      }
    }

    const tema: string = plan.tema || slug.replace(/-/g, ' ')
    const tipo: string = plan.tipo === 'serie' ? 'serie' : 'narrativo'
    const aspect: string = plan.aspect_ratio === '1:1' ? '1:1' : '4:5'
    const planSlides: any[] = Array.isArray(plan.slides) ? plan.slides : []

    // Duplicado: mismo tema y mismo nº de slides
    const dupe = db
      .prepare(`SELECT id, slides_json FROM carousels WHERE tema = ?`)
      .all(tema) as any[]
    const yaEsta = dupe.some((r) => {
      try {
        return JSON.parse(r.slides_json || '[]').length === pngs.length
      } catch {
        return false
      }
    })
    if (yaEsta && !FORCE) {
      console.log(`— ${slug}: ya importado (tema "${tema}", ${pngs.length} slides). Usa --force para duplicar.`)
      continue
    }

    const id = randomUUID()
    const slides: Slide[] = pngs.map((file, i) => {
      const n = Number(file.match(/\d+/)![0])
      const fromPlan = planSlides.find((s) => Number(s.n) === n)
      const rol: Rol = (['portada', 'desarrollo', 'historia', 'cta'].includes(fromPlan?.rol)
        ? fromPlan.rol
        : i === 0
        ? 'portada'
        : i === pngs.length - 1
        ? 'cta'
        : 'desarrollo') as Rol
      return {
        n,
        rol,
        texto: String(fromPlan?.texto ?? '').trim(),
        simbolo: '',
        publicUrl: `/output/carruseles/${id}/slide_${n}.png`,
      }
    })

    const extras = slides.filter((s) => !s.texto).map((s) => s.n)

    console.log(`— ${slug} → "${tema}" (${tipo}, ${aspect}) · ${slides.length} slides`)
    slides.forEach((s) =>
      console.log(`    #${s.n} [${s.rol}] ${s.texto ? s.texto.slice(0, 62) : '(sin texto en plan.json)'}`)
    )
    if (extras.length) console.log(`    ⚠ Slides sin texto en el plan: #${extras.join(', #')}`)

    if (!APPLY) continue

    // Copia los PNG al output de la app
    const destDir = path.join(APP_OUT, id)
    fs.mkdirSync(destDir, { recursive: true })
    for (const file of pngs) fs.copyFileSync(path.join(dir, file), path.join(destDir, file))

    db.prepare(
      `INSERT INTO carousels (id, tema, tipo, aspect, slides_json, fuente_json, status, created_at)
       VALUES (@id, @tema, @tipo, @aspect, @slides_json, NULL, 'done', @created_at)`
    ).run({
      id,
      tema,
      tipo,
      aspect,
      slides_json: JSON.stringify(slides),
      // Fecha del archivo más antiguo, para que ordene por cuándo se generó de verdad
      created_at: new Date(fs.statSync(path.join(dir, pngs[0])).mtime).toISOString(),
    })

    console.log(`    ✓ Importado como ${id} (${pngs.length} archivos copiados)\n`)
  }

  if (!APPLY) console.log('\nDRY-RUN. Corre con --apply para importar.')
}

main()
