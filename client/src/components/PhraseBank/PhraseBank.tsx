import React, { useEffect, useState } from 'react'
import { Shuffle, Plus, Trash2, Pencil, ClipboardList, X, Check, Sparkles } from 'lucide-react'
import { phrasesApi } from '../../api'
import { Phrase } from '../../types'
import { useVideoStore } from '../../store/videoStore'

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
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null)
  const { setText, setConfig, setSelectedPhraseId, selectedImageTags, analyzingPhrases: analyzing, setAnalyzingPhrases: setAnalyzing } = useVideoStore()

  const load = async () => {
    const data = await phrasesApi.list()
    setPhrases(data)
  }

  const handleAnalyzeAll = async () => {
    setAnalyzing(true)
    setAnalyzeResult(null)
    try {
      const { processed, skipped, errors } = await phrasesApi.analyzeAll()
      await load()
      if (errors.length > 0) {
        setAnalyzeResult(`Error: ${errors[0]}`)
      } else {
        setAnalyzeResult(`${processed} analizadas, ${skipped} ya tenían keywords`)
        setTimeout(() => setAnalyzeResult(null), 5000)
      }
    } catch {
      setAnalyzeResult('Error al analizar')
    } finally {
      setAnalyzing(false)
    }
  }

  function scorePhrase(phrase: Phrase): number {
    if (!selectedImageTags.length || !phrase.moodKeywords?.length) return 0
    const matches = selectedImageTags.filter((t) => phrase.moodKeywords!.includes(t)).length
    return matches / phrase.moodKeywords.length
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

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Acciones principales */}
      <div className="flex gap-2">
        <button
          onClick={pickRandom}
          className="flex items-center gap-1.5 text-xs bg-carbon-700 hover:bg-carbon-600 border border-carbon-600 rounded-lg px-3 py-2 text-bone-500 transition-colors"
        >
          <Shuffle size={13} /> Aleatoria
        </button>
        <button
          onClick={() => { setShowImport(!showImport); setImportText('') }}
          className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-2 transition-colors ${
            showImport
              ? 'bg-neon-red border-neon-red text-bone-500'
              : 'bg-carbon-700 hover:bg-carbon-600 border-carbon-600 text-bone-500'
          }`}
        >
          <ClipboardList size={13} /> Importar lista
        </button>
      </div>

      {/* Panel de importaciÃ³n masiva */}
      {showImport && (
        <div className="bg-carbon-800 border border-carbon-600 rounded-xl p-3 flex flex-col gap-3">
          <p className="text-xs text-bone-700">
            Pega tu lista de frases. Se detectan automÃ¡ticamente separadas por pÃ¡rrafos,
            lÃ­neas en blanco, nÃºmeros (1. 2.) o guiones.
          </p>
          <textarea
            className="w-full bg-carbon-700 border border-carbon-600 rounded-lg p-2 text-sm text-bone-500 resize-none focus:outline-none focus:ring-1 focus:ring-neon-red"
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={"1. La disciplina es libertad.\n2. CÃ¡ete 7 veces, levÃ¡ntate 8.\n3. El dolor de hoy es la fuerza de maÃ±ana."}
          />

          {/* Preview de frases detectadas */}
          {preview.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-gold-500">
                {preview.length} frase{preview.length !== 1 ? 's' : ''} detectada{preview.length !== 1 ? 's' : ''}
              </p>
              <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                {preview.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-bone-500 bg-carbon-700 rounded px-2 py-1.5">
                    <span className="text-bone-700 shrink-0 w-4">{i + 1}.</span>
                    <span className="leading-relaxed flex-1">
                      {p.text}
                      {p.author && <span className="block text-[10px] text-gold-500 mt-0.5">– {p.author} –</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleBulkImport}
              disabled={!preview.length || importing}
              className="flex items-center gap-1.5 text-xs bg-neon-red hover:bg-gold-600 disabled:bg-carbon-600 disabled:cursor-not-allowed text-bone-500 rounded-lg px-3 py-2 transition-colors"
            >
              <Check size={13} /> {importing ? 'Importando...' : `Agregar ${preview.length} frases`}
            </button>
            <button
              onClick={() => { setShowImport(false); setImportText('') }}
              className="flex items-center gap-1.5 text-xs bg-carbon-700 hover:bg-carbon-600 border border-carbon-600 text-bone-700 rounded-lg px-3 py-2 transition-colors"
            >
              <X size={13} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Agregar / Editar frase */}
      <div className="flex flex-col gap-1.5">
        {editId && (
          <p className="text-xs font-medium text-gold-500 flex items-center gap-1">
            <Pencil size={11} /> Editando frase...
          </p>
        )}
        <div className="flex gap-2">
          <div className="flex-1 flex flex-col gap-1.5">
            <textarea
              className={`w-full bg-carbon-700 border rounded-lg p-2 text-sm text-bone-500 resize-none focus:outline-none focus:ring-1 transition-colors ${
                editId
                  ? 'border-yellow-400 focus:ring-yellow-400'
                  : 'border-carbon-600 focus:ring-neon-red'
              }`}
              rows={2}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) addPhrase() }}
              placeholder={editId ? 'Edita el texto...' : 'Nueva frase... (Ctrl+Enter para guardar)'}
            />
            <input
              type="text"
              className="w-full bg-carbon-700 border border-carbon-600 rounded-lg px-2 py-1.5 text-xs text-bone-500 placeholder-bone-700 focus:outline-none focus:ring-1 focus:ring-neon-red"
              value={newAuthor}
              onChange={(e) => setNewAuthor(e.target.value)}
              placeholder="Fuente o autor (opcional)"
            />
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={addPhrase}
              className={`flex items-center justify-center gap-1 text-bone-500 rounded-lg px-3 py-1.5 transition-colors flex-1 ${
                editId
                  ? 'bg-yellow-500 hover:bg-yellow-400'
                  : 'bg-neon-red hover:bg-gold-600'
              }`}
            >
              {editId ? <><Check size={14} /> <span className="text-xs">Guardar</span></> : <Plus size={16} />}
            </button>
            {editId && (
              <button
                onClick={cancelEdit}
                className="flex items-center justify-center gap-1 text-xs bg-carbon-600 hover:bg-carbon-600 text-bone-500 rounded-lg px-3 py-1.5 transition-colors"
              >
                <X size={12} /> Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Botón analizar frases */}
      <button
        onClick={handleAnalyzeAll}
        disabled={analyzing}
        className="flex items-center justify-between gap-2 text-xs bg-carbon-700/50 hover:bg-carbon-700 border border-carbon-600/50 rounded-lg px-3 py-2 text-bone-700 hover:text-bone-500 transition-colors disabled:opacity-50"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles size={11} className={analyzing ? 'animate-pulse text-gold-500' : ''} />
          {analyzing ? 'Analizando... (puede tardar varios minutos)' : 'Analizar frases con IA'}
        </span>
        {phrases.filter((p) => !p.moodKeywords?.length).length > 0 && !analyzing && (
          <span className="text-[10px] bg-gold-500/10 text-gold-500 px-1.5 py-0.5 rounded">
            {phrases.filter((p) => !p.moodKeywords?.length).length} sin analizar
          </span>
        )}
      </button>

      {analyzeResult && (
        <p className={`text-[11px] px-1 ${analyzeResult.startsWith('Error') ? 'text-neon-red' : 'text-gold-500'}`}>
          {analyzeResult}
        </p>
      )}

      {/* Toggle ocultar usadas */}
      {phrases.some((p) => (p.usageCount ?? 0) > 0) && (
        <button
          onClick={() => setHideUsed(!hideUsed)}
          className="text-xs text-bone-700 hover:text-bone-500 transition-colors text-left"
        >
          {hideUsed ? '+ Mostrar todas' : '○ Ocultar usadas'}
        </button>
      )}

      {selectedImageTags.length > 0 && phrases.some((p) => scorePhrase(p) > 0) && (
        <p className="text-[10px] text-gold-500/70 px-1">✦ Ordenadas por compatibilidad con la imagen</p>
      )}

      {/* Lista de frases */}
      <div className="flex flex-col gap-2">
        {(() => {
          const filtered = phrases.filter((p) => !hideUsed || (p.usageCount ?? 0) === 0)
          const hasRecs = selectedImageTags.length > 0
          const sorted = hasRecs
            ? [
                ...filtered.filter((p) => scorePhrase(p) > 0).sort((a, b) => scorePhrase(b) - scorePhrase(a)),
                ...filtered.filter((p) => scorePhrase(p) === 0),
              ]
            : filtered
          return sorted.map((phrase) => {
            const score = scorePhrase(phrase)
            const isCompatible = score > 0
            return (
              <div
                key={phrase.id}
                className={`group relative flex items-start gap-2 rounded-lg p-3 cursor-pointer transition-colors ${
                  isCompatible
                    ? 'bg-carbon-700 hover:bg-carbon-600 border border-gold-500/30'
                    : 'bg-carbon-700 hover:bg-carbon-600 border border-transparent'
                }`}
                onClick={() => selectPhrase(phrase)}
              >
                <p className="flex-1 text-sm text-bone-500 leading-relaxed pr-1">{phrase.text}</p>
                <div className="flex items-center gap-1 shrink-0">
                  {isCompatible && (
                    <span className="text-[10px] text-gold-500 font-bold">✦</span>
                  )}
                  {(phrase.usageCount ?? 0) > 0 && (
                    <span className="text-xs bg-neon-red/20 text-gold-500 rounded px-1.5 py-0.5 font-medium">
                      ×{phrase.usageCount}
                    </span>
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(phrase) }}
                      className="text-bone-700 hover:text-bone-500 p-1"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePhrase(phrase.id) }}
                      className="text-bone-700 hover:text-neon-red p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        })()}
        {phrases.length === 0 && (
          <p className="text-xs text-bone-700 text-center py-6">
            No hay frases. Agrega la primera o importa una lista.
          </p>
        )}
      </div>
    </div>
  )
}


