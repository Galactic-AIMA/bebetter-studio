import path from 'path'
import { config } from '../config'
import { generateImage, downloadImage, KieAspect } from './kieService'
import { SlideRole, CarouselFuente } from './geminiService'

// Generación de slides de carrusel con KIE (Nano Banana Pro).
// Porta la biblia visual estilo-bebetter.md (v2, calibrada con el brand reference
// oficial) a un builder de prompts en TS. Cada slide es una imagen COMPLETA con el
// texto ya integrado (a diferencia de los fondos de reel de aiImages.ts, que no
// llevan texto). La coherencia entre slides se logra pasando la PORTADA como
// image_input (referencia) al generar las demás.

export interface SlideInput {
  n: number
  rol: SlideRole
  texto: string
  simbolo?: string // escena/objeto visual concreto de esta slide (para variar entre slides)
}

// Escapa comillas dobles para que no rompan el `reading exactly: "..."` del prompt.
function q(text: string): string {
  return text.replace(/"/g, "'").trim()
}

// Escena visual de la slide. Usa el símbolo propuesto por el guion; si falta,
// cae a una escena simbólica neutra según el rol (evita una escena vacía).
function simbolo(slide: SlideInput): string {
  const s = (slide.simbolo ?? '').trim()
  if (s) return q(s)
  if (slide.rol === 'portada') return 'a raw stone monolith emerging from fog'
  if (slide.rol === 'cta') return 'a single ember glowing in deep darkness'
  return 'a lone symbolic object in a vast dark space'
}

// Construye el prompt de una slide siguiendo estilo-bebetter.md.
// hasRef = true cuando se pasa la portada como referencia (todas menos la portada):
// en ese caso hay que pedir explícitamente UN solo handle (si no, el modelo duplica
// el propio y el de la referencia — lección de la prueba "La Paciencia").
// fuente: atribución + badge de serie; se rinde SOLO en portada y CTA.
export function buildSlidePrompt(slide: SlideInput, hasRef: boolean, fuente?: CarouselFuente): string {
  const texto = q(slide.texto)

  // Tratamiento tipográfico según el rol de la slide.
  let typography: string
  if (slide.rol === 'portada') {
    typography = `Large bold CONDENSED ALL-CAPS headline typography (Anton style), bone-white (#E8E4DC), tight leading, maximum impact, reading exactly: "${texto}".`
  } else if (slide.rol === 'cta') {
    typography = `Clean condensed headline (Anton style) in bone-white (#E8E4DC), calm and stark, reading exactly: "${texto}". The most minimal and darkest slide of the set.`
  } else if (slide.rol === 'historia') {
    typography = `Clean sans-serif body text (IBM Plex Sans style) in bone-white (#E8E4DC), generous line spacing, narrative and perfectly legible, reading exactly: "${texto}".`
  } else {
    typography = `A short bold CONDENSED ALL-CAPS headline (Anton style) and clean sans-serif body text (IBM Plex Sans style), bone-white (#E8E4DC), generous line spacing, perfectly legible, reading exactly: "${texto}".`
  }

  // Marca de serie + atribución (solo portada y CTA, para no saturar).
  const marks: string[] = []
  const showFuente = slide.rol === 'portada' || slide.rol === 'cta'
  const credito = q([fuente?.autor, fuente?.obra].filter(Boolean).join(' · '))
  if (showFuente && slide.rol === 'portada' && fuente?.referencia) {
    marks.push(
      `At the TOP of the frame, a small rectangular label filled with deep muted blood-red (#8B1A1A) containing short condensed uppercase bone-white text reading exactly: "${q(fuente.referencia)}". Keep it small and discreet, clearly separated from the headline.`
    )
  }
  if (showFuente && credito) {
    marks.push(
      `At the BOTTOM-LEFT, one small discreet attribution line in faded warm gold, small clean sans-serif, reading exactly: "${credito}".`
    )
  }

  // Si hay atribución abajo-izquierda, el handle va abajo-derecha (no chocan).
  const handleSpot = marks.length && showFuente && credito ? 'in the BOTTOM-RIGHT corner' : 'in a bottom corner'
  const oneHandle = hasRef
    ? `Small discreet "@bebetter.path" handle ${handleSpot} — only ONE handle, do not repeat it.`
    : `Small discreet "@bebetter.path" handle ${handleSpot}.`

  // Escena: usa el símbolo concreto de la slide (distinto entre slides). Si viene
  // referencia (la portada), pedir explícitamente OTRA escena manteniendo solo el
  // estilo → evita que el modelo copie el sujeto de la portada (bug de #1==#2).
  const scene = simbolo(slide)
  const sceneLine = hasRef
    ? `Keep the SAME visual style as the reference image (same charcoal palette, film grain, lighting mood and typography), but depict a DIFFERENT scene — do NOT reuse the reference's subject. New scene: ${scene}. Minimalist, one focal concept, lots of negative space.`
    : `A single symbolic scene: ${scene}. Minimalist, one focal concept, lots of negative space.`

  // El modelo copiaba del image_input elementos de texto que este prompt no pide
  // (badge de serie, atribución) y además alucinaba su contenido (redibujó
  // "Ley N°2" como "Ley N°3"). Solo se hereda el ESTILO, nunca las etiquetas.
  const noLeak =
    hasRef && !marks.length
      ? 'Use the reference image ONLY for style. Do NOT copy any label, badge, tag, banner or attribution text from it. This slide must contain NO red label and NO extra text of any kind.'
      : ''

  return [
    'Cinematic vertical 4:5 social media carousel slide, raw stoic aesthetic, dark and moody.',
    'Deep charcoal-black background (#0A0A0A), subtle fog, heavy film grain, volumetric low light, deep shadows.',
    sceneLine,
    typography,
    ...marks,
    'Accent: a deep muted desaturated blood-red (#8B1A1A) on the key word only; subtle warm faded-gold light and highlights as a secondary accent. No blue, no neon.',
    oneHandle,
    noLeak,
    'The text must be spelled exactly as given, with correct accents, no repeated or broken letters. No emojis, no exclamation marks, no clutter.',
  ]
    .filter(Boolean)
    .join(' ')
}

const CAROUSEL_ASPECT: KieAspect = '4:5'

// Directorio en disco de un carrusel (bajo output/, servido como estático en /output).
export function carouselDir(carouselId: string): string {
  return path.join(config.paths.output, 'carruseles', carouselId)
}

export function slideFilename(n: number): string {
  return `slide_${n}.png`
}

// URL pública (servida por express.static en /output) de una slide en disco.
export function slidePublicUrl(carouselId: string, n: number): string {
  return `/output/carruseles/${encodeURIComponent(carouselId)}/${slideFilename(n)}`
}

export interface GeneratedSlide {
  n: number
  localPath: string
  publicUrl: string // URL local (para el UI)
  kieUrl: string // URL del resultado en KIE (sirve de referencia para las siguientes)
}

// Genera UNA slide con KIE y la descarga a disco.
// refKieUrl: URL de KIE de la portada, para coherencia visual (undefined en la portada).
export async function generateSlideImage(
  carouselId: string,
  slide: SlideInput,
  refKieUrl?: string,
  fuente?: CarouselFuente
): Promise<GeneratedSlide> {
  const prompt = buildSlidePrompt(slide, !!refKieUrl, fuente)
  const kieUrl = await generateImage({
    prompt,
    aspectRatio: CAROUSEL_ASPECT,
    resolution: '2K',
    outputFormat: 'png',
    imageInput: refKieUrl,
  })

  const localPath = path.join(carouselDir(carouselId), slideFilename(slide.n))
  await downloadImage(kieUrl, localPath)

  return {
    n: slide.n,
    localPath,
    publicUrl: slidePublicUrl(carouselId, slide.n),
    kieUrl,
  }
}
