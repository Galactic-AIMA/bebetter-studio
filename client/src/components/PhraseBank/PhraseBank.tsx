import { useEffect, useMemo, useRef, useState } from 'react'
import { Shuffle, Plus, Trash, PencilSimple, ClipboardText, Check, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { splitByTiempos } from '@shared/splitByTiempos'
import { phrasesApi } from '../../api'
import { Phrase } from '../../types'
import { useVideoStore } from '../../store/videoStore'

/** Marca las frases añadidas hace poco, para reconocer una tanda recién metida. */
const DIAS_NUEVA = 7
function esNueva(p: Phrase): boolean {
  if (!p.createdAt) return false
  const t = Date.parse(p.createdAt)
  return !Number.isNaN(t) && Date.now() - t < DIAS_NUEVA * 24 * 60 * 60 * 1000
}

/**
 * Por qué una frase se queda fuera de la rotación. Espejo de `fueraDeNorma()` del
 * servidor (`utils/norma.ts`), que es quien decide de verdad: aquí solo se pinta.
 * Sin clasificar tampoco cumple — es la dirección segura, pero hay que verlo.
 */
function motivosFueraDeNorma(p: Phrase): string[] {
  const motivos: string[] = []
  if (p.estructura !== 'dos_tiempos') motivos.push(p.estructura ? 'un golpe' : 'sin clasificar')
  if (p.persona !== 'tercera') motivos.push(p.persona ? 'segunda persona' : 'persona sin marcar')
  return motivos
}

function extractAuthor(line: string): { text: string; author?: string } {
  // 1. “(cualquier cosa - Fuente: Meditaciones)” o “(Fuente: Meditaciones)”
  const fuenteMatch = line.match(/^(.*?)\s*\(.*?[Ff]uente:\s*([^)]+)\)\s*$/)
  if (fuenteMatch) return { text: fuenteMatch[1].trim(), author: fuenteMatch[2].trim() }

  // 2. “Frase — Victor Hugo” o “Frase – Victor Hugo” (≤6 palabras, sin punto final)
  const dashMatch = line.match(/^(.*?)\s*[—–]\s*(.{2,60})\s*$/)
  if (dashMatch) {
    const candidate = dashMatch[2].trim()
    if (!candidate.includes('.') && candidate.split(' ').length <= 6)
      return { text: dashMatch[1].trim(), author: candidate }
  }

  // 3. “Frase (Victor Hugo)” — paréntesis simples sin “Fuente:”
  const parenMatch = line.match(/^(.*?)\s*\(([^)]{2,60})\)\s*$/)
  if (parenMatch && !parenMatch[2].toLowerCase().includes('fuente'))
    return { text: parenMatch[1].trim(), author: parenMatch[2].trim() }

  return { text: line.trim() }
}

function parsePastedText(raw: string): { text: string; author?: string }[] {
  const input = raw.trim()

  // Lista numerada: “1. frase” o “1) frase”
  const numbered = input.split(/\n+/).filter((l) => /^\d+[\.\)]\s+/.test(l.trim()))
  if (numbered.length > 1) {
    return numbered.map((l) => extractAuthor(l.replace(/^\d+[\.\)]\s+/, '').trim())).filter((e) => e.text)
  }

  // Párrafos separados por línea en blanco
  const byParagraph = input.split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean)
  if (byParagraph.length > 1) return byParagraph.map(extractAuthor)

  // Lista con guión o asterisco: “- frase” o “* frase”
  const byBullet = input.split(/\n+/).filter((l) => /^[-*•]\s+/.test(l.trim()))
  if (byBullet.length > 1) {
    return byBullet.map((l) => extractAuthor(l.replace(/^[-*•]\s+/, '').trim())).filter((e) => e.text)
  }

  // Una frase por línea
  const byLine = input.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (byLine.length > 1) return byLine.map(extractAuthor)

  // Texto simple — una sola frase
  return input ? [extractAuthor(input)] : []
}

export default function PhraseBank() {
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [newText, setNewText] = useState('')
  const [newAuthor, setNewAuthor] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<{ text: string; author?: string }[]>([])
  const [importing, setImporting] = useState(false)
  const [hideUsed, setHideUsed] = useState(false)
  const [soloFueraDeNorma, setSoloFueraDeNorma] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)
  const { setText, setConfig, setSelectedPhraseId, selectedPhraseId, compatiblePhraseIds } = useVideoStore()

  const load = async () => {
    const data = await phrasesApi.list()
    setPhrases(data)
  }

  const [embedding, setEmbedding] = useState(false)

  const handleEmbedAll = async () => {
    setEmbedding(true)
    setAnalyzeResult(null)
    try {
      const { processed, total, errors } = await phrasesApi.embedAll()
      if (errors.length > 0) {
        setAnalyzeResult(`Error: ${errors[0]}`)
      } else {
        setAnalyzeResult(`Embeddings: ${processed}/${total} frases vectorizadas`)
        setTimeout(() => setAnalyzeResult(null), 5000)
      }
    } catch {
      setAnalyzeResult('Error al generar embeddings')
    } finally {
      setEmbedding(false)
    }
  }

  function scorePhrase(phrase: Phrase): number {
    if (compatiblePhraseIds.length === 0) return 0
    const idx = compatiblePhraseIds.indexOf(phrase.id)
    return idx === -1 ? 0 : (compatiblePhraseIds.length - idx) / compatiblePhraseIds.length
  }

  useEffect(() => { load() }, [])

  // Parsear en tiempo real mientras el usuario pega/escribe
  useEffect(() => {
    setPreview(importText.trim() ? parsePastedText(importText) : [])
  }, [importText])

  const selectPhrase = (phrase: Phrase) => {
    setText({ content: phrase.text })
    setSelectedPhraseId(phrase.id)
    setConfig({ source: phrase.author ?? '' })
  }

  const pickRandom = async () => {
    if (hideUsed) {
      const pool = phrases.filter((p) => (p.usageCount ?? 0) === 0)
      if (!pool.length) return
      selectPhrase(pool[Math.floor(Math.random() * pool.length)])
    } else {
      const phrase = await phrasesApi.random()
      selectPhrase(phrase)
    }
  }

  const addPhrase = async () => {
    if (!newText.trim()) return
    if (editId) {
      await phrasesApi.update(editId, { text: newText, author: newAuthor || undefined })
      setEditId(null)
    } else {
      await phrasesApi.create({ text: newText, author: newAuthor || undefined })
    }
    setNewText('')
    setNewAuthor('')
    load()
  }

  const deletePhrase = async (id: string) => {
    await phrasesApi.remove(id)
    load()
  }

  const startEdit = (phrase: Phrase) => {
    setEditId(phrase.id)
    setNewText(phrase.text)
    setNewAuthor(phrase.author ?? '')
  }

  const handleBulkImport = async () => {
    if (!preview.length) return
    setImporting(true)
    try {
      await phrasesApi.bulkCreate(preview)
      setImportText('')
      setShowImport(false)
      load()
    } finally {
      setImporting(false)
    }
  }

  const cancelEdit = () => { setEditId(null); setNewText(''); setNewAuthor('') }

  // Lo que se ve, en el orden en que se ve. Responde a «¿cuál produzco ahora?»:
  //  - con una imagen activa manda la afinidad (lo que encaja con lo que estás
  //    montando ahora mismo);
  //  - sin ella, suben las que nunca has producido y, dentro de cada grupo, las
  //    más nuevas primero. Por eso ya no hay arrastre manual: con 137 frases el
  //    orden lo decide el uso, y el que se arrastraba no se veía.
  const visibles = useMemo(() => {
    const filtered = phrases
      .filter((p) => !hideUsed || (p.usageCount ?? 0) === 0)
      .filter((p) => !soloFueraDeNorma || motivosFueraDeNorma(p).length > 0)
    const porUso = (a: Phrase, b: Phrase) => {
      const ua = a.usageCount ?? 0
      const ub = b.usageCount ?? 0
      if (ua !== ub) return ua - ub
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    }
    if (compatiblePhraseIds.length === 0) return [...filtered].sort(porUso)
    return [
      ...filtered.filter((p) => scorePhrase(p) > 0).sort((a, b) => scorePhrase(b) - scorePhrase(a)),
      ...filtered.filter((p) => scorePhrase(p) === 0).sort(porUso),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrases, hideUsed, soloFueraDeNorma, compatiblePhraseIds])

  // j / k recorren el banco (DESIGN.md §7). El componente sigue montado aunque
  // esté oculto, así que solo escucha si la lista se ve de verdad.
  const listaRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'j' && e.key !== 'k') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!listaRef.current?.offsetParent || visibles.length === 0) return
      e.preventDefault()
      const idx = visibles.findIndex((p) => p.id === selectedPhraseId)
      const next = e.key === 'j'
        ? Math.min(visibles.length - 1, idx + 1)
        : Math.max(0, idx === -1 ? 0 : idx - 1)
      selectPhrase(visibles[next])
      // El foco va con la selección: si no, el anillo se quedaba en la fila clicada.
      const fila = listaRef.current.querySelector<HTMLElement>(`[data-id="${visibles[next].id}"]`)
      fila?.focus({ preventScroll: true })
      fila?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibles, selectedPhraseId])

  const fuera = phrases.filter((p) => motivosFueraDeNorma(p).length > 0).length
  const usadas = phrases.some((p) => (p.usageCount ?? 0) > 0)

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-linea px-5 pb-4 pt-4 lg:pt-3">
        {phrases.length > 0 && (
          <p className="text-ui text-hueso-2">
            <span className="font-mono">{phrases.length - fuera}</span> en rotación
            {fuera > 0 && <> · <span className="font-mono">{fuera}</span> fuera de norma</>}
          </p>
        )}

        {/* Filtros. «Fuera de norma» existe desde el 2026-08-18 y decide qué se
            publica, así que tiene que verse: sin él, el pool baja de 118 a 61 y la
            app no lo dice en ninguna parte. */}
        {(usadas || fuera > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {usadas && (
              <button className="chip" aria-pressed={hideUsed} onClick={() => setHideUsed(!hideUsed)}>
                Sin usar
              </button>
            )}
            {fuera > 0 && (
              <button
                className="chip"
                aria-pressed={soloFueraDeNorma}
                onClick={() => setSoloFueraDeNorma(!soloFueraDeNorma)}
                title="Un golpe o segunda persona: fuera de la rotación hasta reconvertirlas"
              >
                Fuera de norma <span className="font-mono text-meta text-hueso-3">{fuera}</span>
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={pickRandom} className="btn-sec">
            <Shuffle size={16} /> Otra frase
          </button>
          <button
            onClick={() => { setShowImport(!showImport); setImportText('') }}
            aria-pressed={showImport}
            className="btn-sec"
          >
            <ClipboardText size={16} /> Importar lista
          </button>
          <button
            onClick={handleEmbedAll}
            disabled={embedding}
            className="btn-fantasma ml-auto"
            title="Vectoriza las frases para ordenarlas por afinidad con la imagen"
          >
            <Sparkle size={16} className={embedding ? 'text-oro' : ''} />
            {embedding ? 'Vectorizando…' : 'Embeddings'}
          </button>
        </div>

        {analyzeResult && (
          <p role="status" className={`flex items-center gap-1.5 text-ui ${analyzeResult.startsWith('Error') ? 'text-lacre' : 'text-hueso-2'}`}>
            {analyzeResult.startsWith('Error') ? <WarningCircle size={16} /> : <Check size={16} />}
            {analyzeResult}
          </p>
        )}

        {/* Importación masiva */}
        {showImport && (
          <div className="flex flex-col gap-3 rounded-panel border border-linea-2 bg-s2 p-3">
            <p className="text-ui text-hueso-2">
              Pega tu lista. Se separa sola por párrafos, líneas, números (1. 2.) o guiones.
            </p>
            <textarea
              className="campo resize-none"
              rows={6}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'1. Quien se domina no necesita que lo dominen.\n2. El que espera el momento perfecto se queda esperando.'}
            />
            {preview.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="rotulo">
                  {preview.length} frase{preview.length !== 1 ? 's' : ''} detectada{preview.length !== 1 ? 's' : ''}
                </p>
                <ol className="flex max-h-40 flex-col overflow-y-auto">
                  {preview.map((p, i) => (
                    <li key={i} className="flex gap-2 border-b border-linea py-1.5 text-ui text-hueso last:border-0">
                      <span className="w-5 shrink-0 font-mono text-meta text-hueso-3">{i + 1}</span>
                      <span className="flex-1">
                        {p.text}
                        {p.author && <span className="block font-mono text-meta text-hueso-3">{p.author}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleBulkImport} disabled={!preview.length || importing} className="btn-sec">
                <Check size={16} /> {importing ? 'Agregando…' : `Agregar ${preview.length} frase${preview.length !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => { setShowImport(false); setImportText('') }} className="btn-fantasma px-2">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Nueva frase / edición */}
        <div className="flex flex-col gap-1.5">
          {editId && <p className="rotulo text-oro">Editando frase</p>}
          <textarea
            className="campo resize-none"
            rows={2}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) addPhrase()
              if (e.key === 'Escape' && editId) cancelEdit()
            }}
            placeholder={editId ? 'Edita el texto' : 'Nueva frase. Marca el giro con //'}
            aria-label={editId ? 'Texto de la frase' : 'Nueva frase'}
          />
          <div className="flex gap-2">
            <input
              type="text"
              className="campo text-ui"
              value={newAuthor}
              onChange={(e) => setNewAuthor(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addPhrase() }}
              placeholder="Fuente o autor (opcional)"
              aria-label="Fuente o autor"
            />
            <button onClick={addPhrase} disabled={!newText.trim()} className="btn-sec shrink-0" title="Ctrl + Enter">
              {editId ? <><Check size={16} /> Guardar</> : <><Plus size={16} /> Añadir</>}
            </button>
            {editId && (
              <button onClick={cancelEdit} className="btn-fantasma shrink-0 px-1">Cancelar</button>
            )}
          </div>
        </div>
      </div>

      {compatiblePhraseIds.length > 0 && (
        <p className="flex items-center gap-1.5 border-b border-linea px-5 py-2 font-mono text-meta text-hueso-3">
          <Sparkle size={14} className="text-oro" /> Ordenadas por afinidad con la imagen
        </p>
      )}

      {phrases.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-10">
          <p className="pt-[.16em] font-display text-display uppercase text-hueso">Sin frases</p>
          <p className="text-body text-hueso-2">El banco está vacío. Agrega la primera arriba o pega una lista entera.</p>
          <button onClick={() => setShowImport(true)} className="btn-sec">
            <ClipboardText size={16} /> Importar lista
          </button>
        </div>
      ) : (
        <ul ref={listaRef} role="listbox" aria-label="Banco de frases" className="flex flex-col">
          {visibles.map((phrase) => {
            const [a, b] = splitByTiempos(phrase.text)
            const usos = phrase.usageCount ?? 0
            const motivos = motivosFueraDeNorma(phrase)
            const seleccionada = phrase.id === selectedPhraseId
            return (
              <li
                key={phrase.id}
                data-id={phrase.id}
                role="option"
                aria-selected={seleccionada}
                tabIndex={0}
                onClick={() => selectPhrase(phrase)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPhrase(phrase) } }}
                className={`group relative cursor-pointer border-b border-linea px-5 py-3.5 transition-colors duration-rapido ease-mesa hover:bg-s2 focus-visible:-outline-offset-2 ${
                  seleccionada ? 'bg-s2' : ''
                }`}
              >
                <p className="pr-14 text-body text-hueso [text-wrap:pretty]">
                  {a}
                  {b && (
                    <>
                      <span aria-hidden="true" className="mx-1.5 font-mono text-meta font-medium text-lacre">//</span>
                      <span className="text-hueso-2">{b}</span>
                    </>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-meta text-hueso-3">
                  <span>{usos === 0 ? 'sin usar' : `${usos} uso${usos !== 1 ? 's' : ''}`}</span>
                  {phrase.author && <span className="truncate">{phrase.author}</span>}
                  {esNueva(phrase) && <span className="text-hueso-2" title="Añadida en los últimos 7 días">nueva</span>}
                  {scorePhrase(phrase) > 0 && <span className="text-hueso-2">afín</span>}
                  {motivos.length > 0 && (
                    <span
                      className="text-lacre"
                      title={`Fuera de norma (${motivos.join(' + ')}): no entra en la rotación ni la propone el lote`}
                    >
                      fuera: {motivos.join(', ')}
                    </span>
                  )}
                  {seleccionada && <span className="text-oro">en pantalla</span>}
                </div>
                <div className="absolute right-3 top-2.5 flex opacity-0 transition-opacity duration-rapido ease-mesa focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(phrase) }}
                    className="btn-fantasma grid h-10 w-10 place-items-center lg:h-auto lg:w-auto lg:p-1.5"
                    aria-label="Editar frase"
                  >
                    <PencilSimple size={16} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deletePhrase(phrase.id) }}
                    className="btn-fantasma grid h-10 w-10 place-items-center hover:text-lacre lg:h-auto lg:w-auto lg:p-1.5"
                    aria-label="Borrar frase"
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
