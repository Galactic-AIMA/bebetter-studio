# Tanda 2 — 12 frases del molde «definición» reescritas en dos tiempos

**Contexto:** dos tiempos es **norma de marca** desde el 2026-08-02. Tras la reclasificación manual
del banco quedan **71 frases fuera de norma**; estas 12 son la primera tanda.

**Por qué estas 12:** todas siguen el molde **«El X es Y»**, que es *estructuralmente* incapaz de dos
tiempos — una definición se cierra sola y no deja nada que girar. No se arreglan puliéndolas. Y
**ninguna se ha publicado nunca** (`usage_count = 0`), así que reemplazarlas no rompe
`publications.phrase_id` ni contamina el few-shot por reach real.

**Reescritas a mano, no por Gemini** — mismo motivo que la tanda 1, más uno nuevo: el clasificador
de Gemini resultó **no ser reproducible** (a la misma frase duplicada en el banco le dio veredictos
opuestos).

**Criterios aplicados:**
- **Doce aperturas distintas, a propósito.** El defecto que hundió las propuestas de Gemini en julio
  fue que el 70% abría igual («Buscas…», «Quieres…», «Crees que…»).
- **Sin el molde «Si [X], es porque [Y]»**: ya está saturado en el banco y David confirmó el
  2026-08-02 que no se escriban más frases nuevas con esa forma.
- **Concreto sobre abstracto.** «Cuatro horas al día», «las seis de la mañana», «las tres de la
  madrugada» — no «la disciplina», «el honor».
- **Segunda persona con acusación**, que es lo que comparten los virales propios («Tú quieres el
  brillo sin bajar», «Comparas tu día entero con el mejor segundo de un desconocido»).
- Voz bebetter: frases cortas, tutear, cero emojis, cero exclamaciones, cierre = verdad incómoda.
- Cada una **parte limpio por el punto** ⇒ `splitByTiempos` la divide bien en la pieza.

> **Nada de esto se ha escrito en la base de datos.** Revisar, descartar lo que no suene, y las
> aprobadas entran al banco.

| # | id | Original | Reescritura | Mecanismo |
|---|---|---|---|---|
| 1 | 22 | «La disciplina es el puente entre las metas y los logros» | **Entre lo que quieres y lo que tienes hay unos mil días aburridos. La motivación te va a durar tres.** | cuantificar lo abstracto |
| 2 | 12 | «El estancamiento es el filtro natural que expulsa a los impacientes del camino» | **Llevas tres meses sin ver ningún avance. Ahí es donde se va la gente que solo quería el premio.** | niega creencia + revela |
| 3 | 50 | «El dolor es el recordatorio de que sigues en la batalla» | **Tomas el dolor como una señal para parar. Es la prueba de que todavía estás peleando.** | reencuadre del síntoma |
| 4 | 71 | «La dopamina barata pudre tu mente mientras tu cuerpo permanece inactivo» | **Pasas cuatro horas al día recibiendo premios que no ganaste. Luego te extraña no tener ganas de nada.** | causa ↔ efecto que no ves |
| 5 | 72 | «El control sobre tu mente es el único poder real» | **Puedes mandar sobre cien personas y obedecer a cualquier pensamiento que te cruce. Solo una de esas dos cosas se llama poder.** | paradoja de escala |
| 6 | 80 | «La última libertad humana es elegir tu actitud ante el destino» (Frankl) | **Te pueden quitar el trabajo, la casa y hasta el nombre. Cómo reaccionas no te lo quita nadie: eso solo lo regalas tú.** | enumeración + giro seco |
| 7 | 89 | «La masculinidad se construye repitiendo acciones difíciles sin esperar los aplausos de nadie» | **Lo que haces cuando hay público es actuación. Lo que haces a las seis de la mañana sin testigos es lo que eres.** | contraste con testigo / sin testigo |
| 8 | 90 | «El verdadero líder infunde calma en el caos a través de su propio control» | **Nadie sigue al que grita más fuerte. Se sigue al único que no ha levantado la voz.** | inversión de expectativa |
| 9 | 108 | «La disciplina es la única moneda que compra el respeto que te debes a ti mismo» | **El respeto de los demás se puede fingir. El tuyo se paga cada mañana, y tú sabes cuántas mañanas llevas sin pagarlo.** | fingible ↔ no fingible |
| 10 | 113 | «Tu trabajo carecerá de alma si lo ejecutas movido únicamente por ambición económica» (Greene) | **Se nota cuando alguien trabaja solo por dinero. No lo ves en su cuenta, lo ves en lo que entrega.** | dónde se ve de verdad |
| 11 | 128 | «Un hombre de honor prefiere el respeto propio a la aclamación» | **El aplauso se acaba esa misma tarde. Lo que piensas de ti cuando estás solo no se acaba nunca.** | efímero ↔ permanente |
| 12 | 35 | «Toda adversidad u obstáculo exterior es simple materia prima para ejercer tu virtud» (M. Aurelio) | **Llamas problema a todo lo que no esperabas. Es lo único que de verdad te ha enseñado algo.** | renombrar la cosa |

## ⚠️ Corrección de David (2026-08-02): seis cierres eran confusos

Marcó como difíciles de entender: **meseta** (jerga de gimnasio; en español es antes un accidente
geográfico), **recibo** y **material** (metáforas que hay que descifrar), y **se entrega** / **en su
obra** / **se queda** (tan vagos que el golpe no aterriza en nada).

**El defecto era sistemático: la abstracción caía justo en el segundo bloque**, que es donde tiene
que golpear. Iba en contra del criterio «concreto sobre abstracto» de esta misma lista.

> [!important] Regla añadida
> **Ninguna palabra que no dirías en voz alta, y el segundo bloque tiene que caer en algo físico o
> cotidiano.** Un reel se lee en dos segundos: si una palabra obliga a descifrar, el giro ya se perdió.
> «Tres meses sin ver avance» funciona; «la meseta» no. «La prueba de que sigues peleando» funciona;
> «el recibo de que estás dentro» no.

**Dos más, de la misma familia** (las detectó el asistente al revisar, David confirmó que había que
rehacerlas): *«Nadie **cruza eso** con motivación»* — el verbo venía del puente del original, que ya
no estaba en la frase, así que quedaba sin su imagen — y *«tú sabes **cuántas** has dejado sin
pagar»*, donde «cuántas» obligaba a volver atrás a buscar «mañanas». Al quitar «cruza», la primera
tuvo que rematar con un número: **mil días contra tres** dice lo mismo sin pedir que imagines nada.

**Total: 8 de las 12 se corrigieron por claridad, ninguna por estructura.** La estructura estaba bien
desde el principio; lo que fallaba era el vocabulario. Son dos controles distintos y hay que pasar
los dos.

## Aperturas usadas (control anti-repetición)

Entre · Llevas · Tomas · Pasas · Puedes · Te pueden · Lo que haces · Nadie · El respeto ·
Se nota · El aplauso · Llamas — **doce distintas, ninguna repetida.**

## ⚠️ Hallazgo al preparar la tanda: el banco habla en tercera persona

De las 30 definiciones sin publicar, **11 empiezan por «El hombre superior», «Un guerrero» o
«El maestro»**. Es un arquetipo en tercera persona, y la norma de voz de bebetter dice **tutear
siempre**. El problema no es solo estructural: esas frases **hablan de un personaje, no contigo**.

Las 12 reescrituras pasan todas a segunda persona o a sujeto impersonal cercano. Ojo, porque esto
roza una **tensión que sigue sin resolver** en [[Identidad Visual bebetter]]: §1 Voz dice «tutear
siempre», pero §3.3 dice «no interpelar por defecto con tu/te» a partir del nicho (medianas 34% vs
282%). En los datos **propios** los virales sí interpelan, así que ese dato del nicho probablemente
no se traslada — pero conviene decidirlo, no dejarlo en el aire.
