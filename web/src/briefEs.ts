// Spanish for the two sections of docs/brief.md a reader needs first: the answer and what it does not show.
// The rest of the brief stays English. test/brief.test.ts checks that every number here is the number the English
// section states, so an edit to brief.md that changes a figure fails the test until this file follows.
// kn: first-pass Spanish, like the rest of the UI; not yet reviewed by a community reader.

export const BRIEF_ES = {
  title: 'Lo esencial, en español',
  sections: [
    {
      en: 'In three sentences',
      title: 'En tres frases',
      ordered: true,
      items: [
        'En 52 de 72 emisiones reportadas por las compañías (72%; IC 95% 61-81%), un monitor estatal a menos de 15 km, con datos ese día, estaba viento abajo de la instalación cerca de la hora de inicio reportada.',
        'Pero solo 3 de 72 emisiones (4%; IC 95% 1-12%) tuvieron un pico cerca del inicio reportado, mientras que en días comunes, en los mismos monitores y horas, hubo picos en 19 de 386 ventanas (5%; IC 95% 3-8%).',
        'Con los 9 umbrales de alerta probados, los intervalos de 95% se traslapan. Para estas emisiones, los monitores estatales por hora, con estos umbrales, no pueden distinguir un día de emisión de un día común a las mismas horas, y no pueden confirmar ni contradecir el reporte de una compañía.',
      ],
    },
    {
      en: 'What it does not show',
      title: 'Lo que no muestra',
      ordered: false,
      items: [
        'No muestra que alguna emisión haya sido mayor o menor de lo reportado, ni que alguna instalación haya causado alguna lectura.',
        'No muestra que los monitores fallen: un monitor viento abajo puede no captar una nube de contaminación estrecha o que pasa en lo alto.',
        'No mide una tasa de falsas alarmas; nadie sabe la causa real de cada alerta.',
        'No cubre las emisiones que las compañías no presentaron, las 18 instalaciones que no se ubicaron en EPA ECHO, ni las 5 a más de 15 km.',
      ],
    },
  ],
} as const

/** Every number in a text, in order ("95% CI 61-81%" gives 95, 61, 81). */
export const numbersIn = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? []
