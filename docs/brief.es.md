# ¿Pueden los datos públicos por hora de los monitores verificar los reportes de emisiones que hacen las propias empresas?

*Un resumen del método de Plume Witness para grupos de defensa y comentarios públicos ante la TCEQ y la EPA. Canal de Navegación de Houston, 2024-2025. Cada cifra se copió de los informes del proyecto, citados entre corchetes. «IC» quiere decir intervalo de confianza.*

## En tres frases

1. En 60 de 77 emisiones reportadas por las empresas (78%; IC 95% 68-86%), un monitor estatal a menos de 15 km, con datos ese día, estaba viento abajo de la instalación cerca del inicio reportado.
2. Pero solo 5 de 77 emisiones (6%; IC 95% 3-14%) tuvieron un pico cerca del inicio reportado, mientras que en días comunes, en los mismos monitores y horas, hubo picos en 26 de 410 ventanas (6%; IC 95% 4-9%).
3. En los 9 umbrales probados, los intervalos del 95% se traslapan: para estas emisiones, los monitores estatales por hora, con estos umbrales, no distinguen un día de emisión de un día común a las mismas horas, ni pueden confirmar o contradecir el reporte de una empresa. [[detector.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md)]

## La pregunta

En Texas, cada instalación reporta a la TCEQ sus propias emisiones no planeadas («eventos de emisiones»). Solo se exige un reporte cuando el evento llega a una cantidad reportable o la supera: un aviso inicial dentro de 24 horas y un reporte final dentro de dos semanas (30 TAC 101.201). Hoy, grupos de defensa como TEJAS revisan a mano estos reportes. Nos preguntamos si los datos públicos por hora del propio estado pueden hacer parte de esa revisión: cuando una empresa dice que emitió benceno o 1,3-butadieno, ¿lo captó un monitor estatal cercano?

## El método, en palabras sencillas

- **Emisiones.** Buscamos todos los registros de eventos de emisiones de STEERS en el condado de Harris que empezaron en 2024 o 2025 (335 filas; 317 de ellas tenían una página de detalle que pudimos guardar) y nos quedamos con los que reportaron libras de benceno o 1,3-butadieno, de instalaciones ubicadas en EPA ECHO a menos de 15 km de uno de los 12 monitores AutoGC del Canal: 77 emisiones (otras 18 no se pudieron ubicar en un sitio de EPA ECHO). Las lecturas son datos AutoGC por hora y el viento de cada sitio, que la TCEQ marca como provisionales. [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **Pico.** Una hora a 10 veces o más la mediana de 7 días del propio monitor y a 10 ppb o más (el umbral actual).
- **Viento abajo.** Solo geometría: la instalación queda a menos de 22.5 grados de la dirección viento arriba y a menos de 15 km del monitor, en alguna hora desde 1 hora antes hasta 6 horas después del inicio reportado. No modela cómo se mueve la nube de contaminación.
- **Control.** La misma ventana, 7, 14 o 21 días antes o después, el mismo día de la semana, en días sin emisión reportada: 410 ventanas de días comunes.
- **Barrido.** Repetimos la prueba con 9 ajustes del umbral, hasta 3 veces la mediana y 1 ppb.

## Resultados

- **Día de inicio.** A cualquier hora del día de inicio, 18 de 77 (23%; IC 95% 15-34%) tuvieron un pico, a menudo a horas de la emisión. [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **Bajar el umbral no ayuda.** El ajuste más sensible, 3x / 1 ppb, marca 45 de 77 emisiones y 252 de 410 ventanas de control, con 13.5 alertas por semana entre los 12 monitores (el actual: 4.5 por semana). En los 9 ajustes, la tasa en días de emisión menos la tasa de control va de -9 a +0 puntos porcentuales.
- **Muchas emisiones son pequeñas.** 27 de 77 emisiones reportaron menos de 10 lb del compuesto medido; de las 22 de ellas que tenían viento abajo un monitor con datos, ninguna tuvo un pico cerca del inicio.
- **Con viento débil, la dirección es incierta.** 149 de 465 alertas con el umbral actual que tenían lectura de viento (32%; IC 95% 28-36%) ocurrieron con viento de menos de 3 mph en la hora de la detección, cuando la dirección viento arriba no es confiable. La verificación del registro también cuenta como calma la hora anterior si tuvo menos de 3 mph, así que se abstiene en más casos: 172 de 468 picos. [[detector.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md)]
- **De principio a fin, la verificación automática coincidió con 1 de 77** reportes (1%; IC 95% 0-7%). [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **En la otra dirección.** En 2024-2025 el umbral se activó 468 veces en 378 días. Tras una búsqueda completa, 168 de 468 picos no tuvieron un reporte que coincida en el corredor viento arriba; en 283 la herramienta no dio respuesta («búsqueda incompleta»; 2 de ellos no tenían datos de viento). «Sin reporte que coincida» no es una conclusión sobre ninguna instalación: solo se exige reportar por encima de una cantidad reportable, y el tráfico, los barcos, los tanques de almacenamiento y las emisiones permitidas también suben las lecturas. Estos picos se cuentan, nunca se nombran. [[backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md)]
- **Revisión a mano de «sin reporte que coincida».** De 10 de esos picos elegidos al azar (de los 172 picos sin reporte de un análisis de 8 monitores) y revisados a mano, en 8 se mantuvo la falta de reporte y 2 no se pudieron resolver con datos públicos; reportes que probablemente se nos pasaron o picos dudosos: 0 de 10 (intervalo de Wilson del 95%: 0-28%), o 2 de 10 (6-51%) si las dos noches sin resolver se cuentan como errores. Una revisión automática de los 170 picos sin reporte de ese análisis de 8 monitores encontró, en 5 de 170 (2.9%, IC 95% 1.3-6.7%), un reporte en curso justo fuera del corredor que menciona el compuesto; el análisis de 12 monitores no tiene una revisión propia. [[audit-no-report.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/audit-no-report.md)]

## Quién vive cerca de estos monitores

Unas 25,554 personas viven en los 10 sectores censales a menos de 3 km del monitor Houston Milby Park: el 82.3% es hispano o latino, el 65.6% habla español en casa y el 25.8% tiene menos de 18 años. (ACS 2024 de 5 años; sectores completos; sin propagar márgenes de error; las áreas de monitores vecinos se traslapan.) [[people.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/people.md)]

## Lo que significa

Para estos 12 monitores AutoGC del Canal de Navegación, en 2024-2025, para benceno y 1,3-butadieno, los datos estatales por hora, con estos umbrales, no separan los días de emisiones reportadas por las empresas de los días comunes. No pueden confirmar el reporte de una empresa, y una hora tranquila no es motivo para dudar de uno. Esto no se extiende a otros monitores, compuestos, años ni regiones.

## Lo que no muestra

- No muestra que alguna emisión haya sido mayor o menor de lo reportado, ni que alguna instalación haya causado alguna lectura.
- No muestra que los monitores fallen: un monitor viento abajo puede no captar una nube de contaminación estrecha o que pasa en lo alto.
- No mide una tasa de falsas alarmas; nadie sabe la causa real de cada alerta.
- No cubre las emisiones que las empresas no presentaron, ni las 18 emisiones cuya instalación no se pudo ubicar en EPA ECHO.

## Qué cerraría la brecha

Opciones que señalan las mediciones, para que las consideren la TCEQ, la EPA y los grupos de defensa; no son exigencias de este proyecto.

- **Monitoreo más cerca de las fuentes.** La mayoría de las emisiones tuvo un monitor viento abajo, pero las pequeñas no dejaron rastro a una escala de una hora y 15 km. Esto apunta a monitorear en el perímetro de las instalaciones o de forma continua cerca de las fuentes.
- **Publicación más rápida de los reportes.** Una verificación del registro solo puede decir que falta un reporte después del plazo: 24 horas para el aviso inicial y dos semanas para el reporte final. Hasta entonces, el registro público no puede responder a un residente que pregunta por una emisión que ocurre ahora.
- **STEERS en un formato descargable.** Reconstruimos el registro con búsquedas web semana por semana, y 18 emisiones de benceno o 1,3-butadieno no se pudieron ubicar en un sitio de EPA ECHO. Una tabla de STEERS descargable, con el identificador de cada instalación, quitaría ambos pasos, también para los voluntarios de TEJAS que verifican y traducen cada reporte a mano.

## Límites

- **Solo el día de inicio, en la prueba retrospectiva.** La prueba retrospectiva del detector revisa solo el día de inicio de la emisión, así que una emisión que empieza después de las 18:00 CST, más o menos, pierde parte de su ventana. La verificación del registro en un pico repetido es más amplia: un reporte coincide si estaba en curso desde 6 horas antes hasta 2 horas después de la hora del pico, una ventana que puede pasar de la medianoche, y también se buscan los reportes que empezaron en los 30 días anteriores.
- **Puntos de partida.** La ventana empieza a la hora de inicio que reportó la empresa, y el punto de cada instalación en EPA ECHO puede no estar donde sale la emisión.
- **Fuente del viento.** Cuatro monitores (Galena Park, HRM-16 Deer Park, Clinton, HRM-3 Haden Road) no tienen viento de estación meteorológica y usan el viento resultante de su propio analizador AutoGC, que coincide a menos de 22.5 grados con el de estación en el 87-91% de las horas con ambos datos y marca unas 0.3-0.4 mph menos; un monitor sin ninguno de los dos en un día usa el del sitio más cercano (18 de 468 picos).
- **Números pequeños.** Dos tasas cuentan como distintas solo cuando sus intervalos de Wilson del 95% no se traslapan, una prueba conservadora a propósito. La revisión a mano la hizo una sola persona, sin una segunda lectura a ciegas.
- **Datos provisionales.** La TCEQ puede corregir los datos AutoGC, así que volver a correr el análisis puede dar otro resultado; si un cambio en el programa que lee los reportes agrega emisiones, cambian todos los denominadores.

## Reproducibilidad

- **Código y datos:** [github.com/kgorle1111/plume-witness](https://github.com/kgorle1111/plume-witness) (MIT). Sitio interactivo: [kgorle1111.github.io/plume-witness](https://kgorle1111.github.io/plume-witness/).
- **Para volver a correrlo:** `uv sync`, y luego `uv run python -m pipeline.backtest`, `uv run python -m pipeline.detector_eval`, `uv run python -m pipeline.people`.
- **Procedencia:** cada archivo público original (AutoGC y viento de la TCEQ, STEERS de la TCEQ, EPA ECHO, ACS del Censo de EE. UU.) se guarda con su URL de origen, hora de descarga y SHA-256 en `data/raw/backtest/provenance.json` y `data/raw/census/provenance.json`.
- **Fuentes:** [docs/detector.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/detector.md), [docs/backtest.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/backtest.md), [docs/people.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/people.md), [docs/audit-no-report.md](https://github.com/kgorle1111/plume-witness/blob/main/docs/audit-no-report.md); texto de la norma: [30 TAC 101.201](https://www.law.cornell.edu/regulations/texas/30-Tex-Admin-Code-SS-101-201).
