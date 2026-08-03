# Tanda 3 — 12 frases en TERCERA PERSONA + 11 a archivar por duplicadas

**Primera tanda escrita bajo el cambio de registro del 2026-08-02** (tercera persona hasta nuevo
aviso). Ventaja: los originales **ya estaban en tercera persona**, así que solo hubo que darles
estructura en dos tiempos, sin tocarles la voz.

**Verificado:** 12/12 se parten en dos bloques con el corte en el giro · **0 con segunda persona**
(comprobado con regex, no a ojo) · 85–115 caracteres.

**Criterios:** lenguaje llano (regla de claridad del 2026-08-02: ninguna palabra que no dirías en voz
alta) · doce aperturas distintas · sin el molde `Si X, es porque Y` (saturado) · concreto sobre
abstracto.

## Las 12 reescrituras

| # | Reescritura (3.ª persona) | Sustituye a |
|---|---|---|
| 1 | **El que pide permiso ya eligió obedecer. El nivel no lo marca la mayoría: lo marca el que trabaja cuando nadie mira.** | «Un guerrero no busca permiso…» · «Un hombre de valor no busca la aprobación de la masa…» · «Renuncia a la validación externa…» |
| 2 | **Nadie construye nada en los días emocionantes. Se construye en los cientos de días en los que no pasa nada.** | «El guerrero construye su realidad a través de la repetición aburrida…» · «Acepta el aburrimiento de la rutina…» · «El hombre superior no busca gratificación inmediata…» |
| 3 | **El miedo llega igual para todos. La diferencia está en quién abre el paracaídas y quién se deja caer.** | «Un guerrero es el paracaídas…» · «El hombre superior es el paracaídas…» |
| 4 | **La suerte reparte las cartas una vez. El resto de la partida la juega quien se preparó.** | «El maestro no busca suerte; busca el control de su realidad» |
| 5 | **El que espera el momento importante hace lo de hoy a medias. No hay ensayo: esto ya es la función.** | «Ejecuta tu labor diaria con la severidad de tu última acción mortal» · «El hombre superior realiza cada acción como si fuera la última» · «Abraza tu muerte…» |
| 6 | **El que se enfada por lo que hacen los demás termina obedeciéndolos. Manda de verdad el que no reacciona.** | «El hombre invencible jamás se altera por los sucesos ajenos a su albedrío» · «El esclavo de sus circunstancias…» |
| 7 | **La reputación tarda años en levantarse. Se cae en una tarde y ya nunca vuelve entera.** | «El prestigio es la piedra angular del poder; defiéndelo con tu vida» |
| 8 | **La mitad de lo que preocupa a un hombre no depende de él. Ahí es donde gasta casi toda su energía.** | «Aférrate solo a lo que controlas…» · «Construye tu ciudadela interior…» |
| 9 | **El que cobra rápido aprende despacio. El oficio se paga con años y esa factura no se adelanta.** | «Valora el aprendizaje sobre el dinero hasta dominar tu oficio» · «Resiste la inmediatez…» |
| 10 | **Nadie se hace fuerte evitando el peso. El carácter se forma justo donde uno preferiría parar.** | «Lo difícil es el filtro que elimina a los mediocres…» · «Lo que no perjudica a tu carácter…» |
| 11 | **El que habla de más regala información. El que calla deja que los demás se descubran solos.** | «Di siempre menos de lo necesario para mantener el control total» |
| 12 | **El dolor sin sentido rompe a cualquiera. El mismo dolor con un motivo detrás se vuelve soportable.** | «El sufrimiento es el gas que llena toda el alma humana» · «El sufrimiento deja de ser tormento…» |

> [!note] Sustitución sobre la marcha
> La versión inicial de la #7 era *«A un hombre se le puede quitar todo menos una cosa. Y esa no se la
> quitan: la entrega él.»* — pero **dice lo mismo que una de las 12 aplicadas esta misma mañana**
> (*«Te pueden quitar el trabajo, la casa y hasta el nombre…»*). Se cambió por la idea de reputación,
> que no estaba cubierta. **Meter dos frases que dicen lo mismo es exactamente lo que llenó el banco
> de duplicados.**

## Las 11 a archivar (no se reescriben: ya están dichas)

Cubiertas por las reescrituras de arriba o por frases que **ya cumplen la norma**:

| A archivar | Porque ya existe |
|---|---|
| «Un guerrero es el paracaídas…» · «El hombre superior es el paracaídas…» | → #3 |
| «Un guerrero no busca permiso…» · «Un hombre de valor no busca la aprobación…» | → #1 |
| «Deja de discutir cómo es un hombre bueno; sé uno» · «No discutas más sobre cómo debe ser un hombre bueno…» | ya en norma: *«El que discute si es buena persona está buscando público. El que lo es, ni se entera.»* |
| «La única posesión que nadie puede arrebatarte…» · «Tu única posesión inquebrantable…» · «La última libertad humana… circunstancias inevitables» | ya en norma (tanda 2): *«Te pueden quitar el trabajo, la casa y hasta el nombre…»* |
| «Forja tu carácter en el aburrimiento de la repetición diaria» · «El maestro no busca recompensas inmediatas…» | → #2 |

## ⚠️ Un método que se probó y NO funciona

Se intentó detectar duplicados por **similitud de embeddings** contra las frases ya en norma. Dio
**59 de 59 por encima de 0,80**, que no es un hallazgo sino la prueba de que no discrimina.

**Causa:** los embeddings del banco **no representan el significado de la frase, sino sus metáforas
visuales** (`buildPhraseDocument` vectoriza `metaforasVisuales`, no el texto). Por eso *«Elimina el
azúcar de tu sangre»* empareja a **0,920** con *«la divinidad te entrena como a un atleta»*: no dicen
lo mismo, **evocan la misma imagen**. Sirven para elegir imagen de fondo — su función real — no para
detectar mensajes repetidos.

**Los duplicados de la tabla de arriba se detectaron leyendo, no con el vector.**

> **Nada de esto se ha escrito en la base de datos.** Revisar, descartar lo que no suene, y las
> aprobadas entran al banco.
