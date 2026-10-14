/* Contenido REAL de bebetter para los cuatro mockups.
   Frases: banco activo, en norma (dos tiempos + tercera persona), tal cual están
   en la base. Fondos: imágenes del banco generadas por IA (origen 'ia').
   Métricas: snapshot de la VM del 2026-09-12 (vault, sesión 2026-09-11).
   Lo que NO es real se marca con «ejemplo» donde aparece. */

window.BB = {
  frases: [
    { id: 'f1', texto: 'Nadie levanta un peso porque le apetezca. Se levanta porque el músculo solo crece contra algo que pesa.', fondo: 'barra', usos: 0, energia: 4, pista: 'pulsante' },
    { id: 'f2', texto: 'Cuando el camino se vuelve monótono es cuando empieza a servir; el temple no se construye en los días buenos.', fondo: 'caminante', usos: 0, energia: 3, pista: 'etéreo' },
    { id: 'f3', texto: 'La vanidad convierte a cualquiera en esclavo de la opinión ajena. Casi todos caen ahí, porque parecer cuesta menos que ser.', fondo: 'marioneta', usos: 0, energia: 2, pista: 'acústico' },
    { id: 'f4', texto: 'El que cobra rápido aprende despacio. El oficio se paga con años y esa factura no se adelanta.', fondo: 'forja', usos: 0, energia: 3, pista: 'orquestal' },
    { id: 'f5', texto: 'Tres meses seguidos sin ver ningún avance. Ahí es exactamente donde se cae la gente que solo quería el premio.', fondo: 'faro', usos: 0, energia: 3, pista: 'etéreo' },
    { id: 'f6', texto: 'Lo que se hace con público es actuación. Lo que se hace a las seis de la mañana y sin testigos es el carácter de verdad.', fondo: 'reloj', usos: 0, energia: 2, pista: 'acústico' },
    { id: 'f7', texto: 'Nadie viene a rescatar a nadie de una vida que descuidó él mismo. El rescate se parece mucho a levantarse un martes cualquiera.', fondo: 'faro2', usos: 0, energia: 3, pista: 'orquestal' },
    { id: 'f8', texto: 'La mitad de lo que preocupa a un hombre no depende de él. Ahí es donde gasta casi toda su energía.', autor: 'Ryan Holiday', fondo: 'trofeo', usos: 2, energia: 2, pista: 'etéreo' },
  ],

  metricas: {
    reproducciones: '755.151',
    piezas: '124',
    pico: '127.404',
    alcanceMediano: '1.687',
    guardados: '1,56 %',
    compartidos: '0,65 %',
    snapshot: '2026-09-12',
  },

  // Copia simplificada de server/src/text/splitByTiempos.ts: el punto manda;
  // el «;» solo si no hay punto; el más cercano a la mitad; si no, bloque único.
  tiempos(texto) {
    const cortes = (sep) => {
      const r = []
      for (let i = 0; i < texto.length - 1; i++) if (texto[i] === sep && /\s/.test(texto[i + 1])) r.push(i + 1)
      return r
    }
    const cand = cortes('.').length ? cortes('.') : cortes(';')
    if (!cand.length) return [texto]
    const mitad = texto.length / 2
    const c = cand.reduce((a, b) => (Math.abs(b - mitad) < Math.abs(a - mitad) ? b : a))
    return [texto.slice(0, c).trim().replace(/;$/, ''), texto.slice(c).trim()]
  },

  img(nombre) { return 'assets/' + nombre + '.jpg' },
}
