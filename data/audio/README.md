# Pistas de audio de fondo — beBetterStudio

Coloca aquí las pistas de música de fondo que FFmpeg incrustará en los videos.

## Especificaciones
- **Formato:** MP3 (o M4A/WAV). MP3 recomendado.
- **Cantidad inicial (MVP):** 3-4 pistas.
- **Licencia:** royalty-free / sin atribución. Ver fuentes abajo.
- **Nombre de archivo:** descriptivo y sin caracteres raros, ej. `cinematic-hopeful.mp3`, `dark-tense.mp3`.
- **Duración:** no importa. FFmpeg hace loop si es más corta que el video y trim si es más larga; aplica fade in/out y normaliza volumen (`loudnorm`).

## Por qué royalty-free (no música con copyright)
Cuenta profesional + publicación por API + audio incrustado = Meta Rights Manager
le hace fingerprinting a cada subida. Música con copyright → audio silenciado,
contenido removido o distribución reducida (justo lo contrario del alcance que
buscamos). Detalle completo en el vault: `myBrain/beBetterStudio`.

## Fuentes recomendadas (mood motivacional-oscuro / cinematográfico)
| Fuente | Costo | Nota |
|--------|-------|------|
| Meta Sound Collection (facebook.com/sound-collection) | Gratis | La más segura para audio incrustado en IG/FB (catálogo propio de Meta). Sin atribución. |
| Pixabay Music (pixabay.com/music) | Gratis | Sin atribución. Buscar: "cinematic motivational", "dark ambient", "emotional inspiring". |
| Uppbeat (uppbeat.io) | Free + Pro | Curado, con tags de mood por pista (útil para la futura fase A de matching). |
| Epidemic Sound / Artlist | ~$10-15/mes | Mejor calidad para el nicho. Cada pista trae mood/genre. |

## Estado
- [ ] Colocar 3-4 pistas iniciales aquí
- Fase B (MVP): selector de pista en el BatchGenerator (misma pista para todo el lote)
- Fase A (futuro): matching semántico frase↔pista por embeddings (pospuesto)
