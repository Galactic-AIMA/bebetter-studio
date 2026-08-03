# 20 frases reescritas en dos tiempos — para revisión de David

**Origen del patrón:** percepción del nicho (2026-07-28) + los 3 virales propios + validación
sobre 53 publicaciones (dos tiempos: reach mediano 2.055 / skip 45,2% · un golpe: 1.806 / 47,2%).

**Reescritas a mano, no por Gemini.** Sus propuestas tenían tres defectos: el 70% empezaba igual
(«Buscas…», «Quieres…», «Crees que…»), perdía tildes, y alguna cambiaba la idea del original.

**Criterios aplicados:**
- Mecanismos **variados** a propósito. El molde «Si [X], es porque [Y]» ya está sobreexplotado en
  el banco (8 de las 27 que ya estaban en dos tiempos) y suena a texto generado.
- **Concreto sobre abstracto.** El mejor reel del nicho no dice «la libertad»: dice perro, collar,
  lobo, hambre.
- Voz bebetter: frases cortas, tutear, cero emojis, cero exclamaciones, cierre = verdad incómoda.
- Máximo 2 líneas: el texto va quemado en el vídeo y se lee de un vistazo.

> **Nada de esto se ha escrito en la base de datos.** Revisar, descartar lo que no suene, y las
> aprobadas entran al banco para publicarlas **intercaladas** con las actuales.

| # | Original (reach real) | Reescritura | Mecanismo |
|---|---|---|---|
| 1 | «La angustia es el síntoma de querer controlar lo que no depende de ti» (206) | **Revisas el clima antes de un viaje que no controlas. Nunca revisas la cabeza con la que vas a viajar.** | contraste de atención |
| 2 | «Corta los hilos de la emoción antes de que tu sombra tome el mando» (202) | **La emoción llega sin pedir permiso. Quedarte a vivir en ella ya es decisión tuya.** | involuntario ↔ voluntario |
| 3 | «El maestro abraza el dolor de la práctica hasta convertirlo en poder absoluto» (281) | **El acero no se templa con agua tibia. Tu carácter tampoco.** | analogía + cierre seco |
| 4 | «Deja de implorar rescate; tu única salvación es tu ciudadela interior» (319) | **Llevas años esperando que alguien abra la puerta. La cerradura está de tu lado.** | inversión de expectativa |
| 5 | «Acepta tu destino sin quejas; el sufrimiento forja un sentido» (474) | **El viento no cambia porque te quejes. O cambias las velas, o te quedas quieto.** | analogía |
| 6 | «El hombre superior no debate sobre la bondad; la demuestra» (693) | **El que discute si es buena persona está buscando público. El que lo es, ni se entera.** | contraste de sujetos |
| 7 | «El hombre que domina su atención es el único que posee su libertad» (982) | **Puedes ir a donde quieras y seguir siendo un esclavo. Tu carcelero decide dónde miras.** | paradoja |
| 8 | «Si el camino se vuelve oscuro, es porque tú eres la única luz» (1.038) | **Pides una luz que te saque de ahí. Nadie sale iluminado: se sale a tientas.** | expectativa ↔ realidad |
| 9 | «El obstáculo que bloquea tu camino es materia prima para tu victoria» (1.143) | **El fuego se come la madera y por eso crece. Deja de apartar la tuya.** | analogía que se voltea |
| 10 | «Gobierna tu mente antes de gobernar tu destino» (1.192) | **Quieres ordenar tu vida y llevas tres días sin tender la cama. Lo de afuera es la factura de lo de adentro.** | concreto → abstracto |
| 11 | «El enemigo más poderoso de un hombre es su propia lujuria» (1.943) | **Crees que dominas el deseo porque lo satisfaces. El perro también cree que pasea al dueño.** | analogía irónica |
| 12 | «Si cedes ante la tentación, el placer efímero se vuelve arrepentimiento» (1.917) | **Cinco minutos de placer se pagan con cinco años de cuenta pendiente. Nadie te avisa del interés.** | contraste temporal |
| 13 | «Asume la responsabilidad de tu destino; nadie carga la cruz por ti» (2.088) | **Nadie va a cargar tu cruz. Y mientras esperas, la estás arrastrando igual.** | giro sobre la espera |
| 14 | «Valora el rigor del aprendizaje por encima del prestigio» (2.152) | **El oro se saca de la mina, no del escaparate. Tú quieres el brillo sin bajar.** | analogía + acusación |
| 15 | «Si entregas tu mente a las distracciones, renuncias a tu libertad» (2.312) | **Nadie te quitó la libertad. La entregaste en cuotas de quince segundos.** | inversión + concreción |
| 16 | «El camino de mil pasos se recorre uno a la vez» (2.083) | **Quieres saltar al final del camino. El camino no se salta: se cobra.** | expectativa ↔ precio |
| 17 | «La humildad es saber que tienes que ganarte cada gramo de respeto» (2.980) | **El respeto no se pide, se cobra. Y tú todavía no has facturado nada.** | metáfora económica |
| 18 | «Lo que ves en redes es una edición, no una vida» (3.783) | **Comparas tu día entero con el mejor segundo de un desconocido. Y encima crees que vas perdiendo.** | contraste asimétrico |
| 19 | «Tu prisa es el combustible de tu fracaso» (4.902) | **Tienes prisa por la meta y desprecias el camino. Llegar así solo adelanta la caída.** | causa ↔ consecuencia |
| 20 | «El éxito de tres días es una ilusión; el camino real toma décadas» (4.541) | **El método de tres días lo vende alguien que lleva diez años en esto. Ese es el dato que no te dan.** | contradicción revelada |

## Cómo probarlas (para que el resultado signifique algo)

- **Intercalar** con las frases actuales, no publicar las 20 seguidas: si no, la deriva temporal
  contamina el resultado igual que pasó con la cobertura de receta el 27-jul.
- **Medir skip rate y watch time a 48 h**, no alcance. Línea base de julio: **skip 47,2% / 45,2%**
  según estructura, watch 3,5-5,4 s.
- Marcarlas con `category = 'test-dos-tiempos'` para poder aislarlas después, igual que se hizo
  con `test-registro-propio`.
