import React, { useEffect, useState } from 'react'
import { Shuffle, Plus, Trash2, Pencil, ClipboardList, X, Check } from 'lucide-react'
import { phrasesApi } from '../../api'
import { Phrase } from '../../types'
import { useVideoStore } from '../../store/videoStore'

// Detecta automáticamente el separador y extrae frases individuales del texto pegado.
// Soporta: párrafos separados por línea en blanco, listas numeradas (1. 2. 3.),
// listas con guión/asterisco, o una frase por línea.
function parsePastedText(raw: string): string[] {
  const text = raw.trim()

  // Lista numerada: "1. frase" o "1) frase"
  const numbered = text.split(/\n+/).filter((l) => /^\d+[\.\)]\s+/.test(l.trim()))
  if (numbered.length > 1) {
    return numbered.map((l) => l.replace(/^\d+[\.\)]\s+/, '').trim()).filter(Boolean)
  }

  // Párrafos separados por línea en blanco
  const byParagraph = text.split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean)
  if (byParagraph.length > 1) return byParagraph

  // Lista con guión o asterisco: "- frase" o "* frase"
  const byBullet = text.split(/\n+/).filter((l) => /^[-*•]\s+/.test(l.trim()))
  if (byBullet.length > 1) {
    return byBullet.map((l) => l.replace(/^[-*•]\s+/, '').trim()).filter(Boolean)
  }

  // Una frase por línea
  const byLine = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (byLine.length > 1) return byLine

  // Texto simple — una sola frase
  return text ? [text] : []
}

export default function PhraseBank() {
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [newText, setNewText] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [hideUsed, setHideUsed] = useState(false)
  const { setText, setSelectedPhraseId } = useVideoStore()

  const load = async () => {
    const data = await phrasesApi.list()
    setPhrases(data)
  }

  useEffect(() => { load() }, [])

  // Parsear en tiempo real mientras el usuario pega/escribe
  useEffect(() => {
    setPreview(importText.trim() ? parsePastedText(importText) : [])
  }, [importText])

  const selectPhrase = (phrase: Phrase) => {
    setText({ content: phrase.text })
    setSelectedPhraseId(phrase.id)
  }

  const pickRandom = async () => {
    const phrase = await phrasesApi.random()
    selectPhrase(phrase)
  }

  const addPhrase = async () => {
    if (!newText.trim()) return
    if (editId) {
      await phrasesApi.update(editId, { text: newText })
      setEditId(null)
    } else {
      await phrasesApi.create({ text: newText })
    }
    setNewText('')
    load()
  }

  const deletePhrase = async (id: string) => {
    await phrasesApi.remove(id)
    load()
  }

  const startEdit = (phrase: Phrase) => {
    setEditId(phrase.id)
    setNewText(phrase.text)
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

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Acciones principales */}
      <div className="flex gap-2">
        <button
          onClick={pickRandom}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 transition-colors"
        >
          <Shuffle size={13} /> Aleatoria
        </button>
        <button
          onClick={() => { setShowImport(!showImport); setImportText('') }}
          className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-2 transition-colors ${
            showImport
              ? 'bg-brand-500 border-brand-500 text-white'
              : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300'
          }`}
        >
          <ClipboardList size={13} /> Importar lista
        </button>
      </div>

      {/* Panel de importación masiva */}
      {showImport && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 flex flex-col gap-3">
          <p className="text-xs text-gray-400">
            Pega tu lista de frases. Se detectan automáticamente separadas por párrafos,
            líneas en blanco, números (1. 2.) o guiones.
          </p>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={"1. La disciplina es libertad.\n2. Cáete 7 veces, levántate 8.\n3. El dolor de hoy es la fuerza de mañana."}
          />

          {/* Preview de frases detectadas */}
          {preview.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-green-400">
                {preview.length} frase{preview.length !== 1 ? 's' : ''} detectada{preview.length !== 1 ? 's' : ''}
              </p>
              <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
                {preview.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-300 bg-gray-800 rounded px-2 py-1.5">
                    <span className="text-gray-600 shrink-0 w-4">{i + 1}.</span>
                    <span className="leading-relaxed">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleBulkImport}
              disabled={!preview.length || importing}
              className="flex items-center gap-1.5 text-xs bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 transition-colors"
            >
              <Check size={13} /> {importing ? 'Importando...' : `Agregar ${preview.length} frases`}
            </button>
            <button
              onClick={() => { setShowImport(false); setImportText('') }}
              className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded-lg px-3 py-2 transition-colors"
            >
              <X size={13} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Agregar / Editar frase */}
      <div className="flex flex-col gap-1.5">
        {editId && (
          <p className="text-xs font-medium text-yellow-400 flex items-center gap-1">
            <Pencil size={11} /> Editando frase...
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            className={`flex-1 bg-gray-800 border rounded-lg p-2 text-sm text-white resize-none focus:outline-none focus:ring-1 transition-colors ${
              editId
                ? 'border-yellow-400 focus:ring-yellow-400'
                : 'border-gray-700 focus:ring-brand-500'
            }`}
            rows={2}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) addPhrase() }}
            placeholder={editId ? 'Edita el texto...' : 'Nueva frase... (Ctrl+Enter para guardar)'}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={addPhrase}
              className={`flex items-center justify-center gap-1 text-white rounded-lg px-3 py-1.5 transition-colors flex-1 ${
                editId
                  ? 'bg-yellow-500 hover:bg-yellow-400'
                  : 'bg-brand-500 hover:bg-brand-600'
              }`}
            >
              {editId ? <><Check size={14} /> <span className="text-xs">Guardar</span></> : <Plus size={16} />}
            </button>
            {editId && (
              <button
                onClick={() => { setEditId(null); setNewText('') }}
                className="flex items-center justify-center gap-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg px-3 py-1.5 transition-colors"
              >
                <X size={12} /> Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Toggle ocultar usadas */}
      {phrases.some((p) => (p.usageCount ?? 0) > 0) && (
        <button
          onClick={() => setHideUsed(!hideUsed)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors text-left"
        >
          {hideUsed ? '+ Mostrar todas' : '○ Ocultar usadas'}
        </button>
      )}

      {/* Lista de frases */}
      <div className="flex flex-col gap-2">
        {phrases
          .filter((p) => !hideUsed || (p.usageCount ?? 0) === 0)
          .map((phrase) => (
          <div
            key={phrase.id}
            className="group relative flex items-start gap-2 bg-gray-800 hover:bg-gray-750 rounded-lg p-3 cursor-pointer"
            onClick={() => selectPhrase(phrase)}
          >
            <p className="flex-1 text-sm text-gray-200 leading-relaxed pr-1">{phrase.text}</p>
            <div className="flex items-center gap-1 shrink-0">
              {(phrase.usageCount ?? 0) > 0 && (
                <span className="text-xs bg-brand-500/20 text-brand-400 rounded px-1.5 py-0.5 font-medium">
                  ×{phrase.usageCount}
                </span>
              )}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(phrase) }}
                  className="text-gray-400 hover:text-white p-1"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePhrase(phrase.id) }}
                  className="text-gray-400 hover:text-red-400 p-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {phrases.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-6">
            No hay frases. Agrega la primera o importa una lista.
          </p>
        )}
      </div>
    </div>
  )
}
