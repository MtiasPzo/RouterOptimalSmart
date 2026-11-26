# RouterOptimalSmart

Prototipo web de Funciones y Matrices para estimar la señal Wi-Fi en una vivienda de varios pisos. Permite comparar las posiciones que tú elijas y ver cómo influyen la distancia, los muros, las losas y la banda en cada punto de interés.

## Abrir la aplicación

Instala Node.js 20 o posterior. Abre una terminal en esta carpeta y ejecuta los dos comandos. En PowerShell, si tu sistema bloquea el script de npm, usa `npm.cmd` en lugar de `npm`.

```sh
npm ci
npm start
```

Abre [http://127.0.0.1:8000](http://127.0.0.1:8000) en el navegador. La instalación descarga la dependencia que procesa el DWG. Una vez instalada, la aplicación puede funcionar sin Internet. El archivo que eliges se lee dentro del navegador.

Para abrir la web en el **celular**, conecta ambos dispositivos a la misma red local y arranca con `npm start -- --lan`. En Windows, ejecuta `ipconfig`, busca la dirección IPv4 del adaptador conectado y abre `http://DIRECCIÓN_IPV4:8000` en el celular. Si Windows pide permiso de firewall, habilita Node.js para la red privada. El modo normal escucha solo en este computador. Las posiciones se guardan durante la sesión de la página y se reinician al recargar.

## Recorrido de uso

Cada campo tiene un botón **?**. Pasa el mouse por encima, llega con el teclado usando Tab o toca el botón en el celular para ver qué significa y cómo completarlo.

1. Pulsa **+** junto a las pestañas para agregar otro piso tantas veces como necesites. El botón **×** elimina el piso visible y renumera los superiores; si tiene contenido, pide confirmación. El control *Número de pisos* permite reducir los pisos activos sin borrar sus datos; al volver a agregarlos, se recuperan. Confirma o cambia la separación vertical común entre pisos. Cada pestaña tiene su propio plano y sus propios elementos.
2. **Para dibujar**, selecciona *Dibujar* y aplica el ancho y el fondo del piso en metros. Elige *Dibujar muro*, selecciona material y grosor en el panel del plano y arrastra desde el inicio hasta el final: la línea se previsualiza y el muro se guarda al soltar. Puedes activar o desactivar por separado el ajuste horizontal y vertical; solo corrige trazos cercanos a esos ejes. En el celular, el panel aparece debajo del plano para dejar libre la cuadrícula. Con *Seleccionar* puedes tocar un muro y ajustar sus pérdidas y coordenadas exactas en ese mismo panel. La lista de elementos también permite editar o borrar muros y puntos. Para marcar un punto de interés, toca su ubicación y renómbralo en el editor. También puedes ingresar coordenadas mediante el editor con el teclado.
   Para definir una vivienda que no sea rectangular, pulsa *Trazar contorno*, marca sus esquinas y toca la primera o pulsa *Cerrar contorno*. El panel permite elegir material, grosor y pérdidas de los lados exteriores, deshacer esquinas y quitar o reemplazar el contorno. Los elementos deben quedar dentro de él. En las plantas cóncavas, los cruces con lados exteriores también se consideran en la pérdida de señal.
3. **Para importar**, selecciona el piso de destino y pulsa *Importar plano*. Abre un DWG o una imagen PNG, JPG, WebP o BMP. Si hay varias vistas en el archivo, elige *Recortar vista* y toca dos esquinas de la planta que corresponde a ese piso. Marca los extremos de una distancia conocida, escríbela en metros y confirma la escala. Traza manualmente los muros y puntos que quieras incluir. Repite para el segundo piso. Para los cálculos entre plantas, usa recortes del mismo origen físico y orientados en la misma dirección.
4. Selecciona *Colocar router* o *Mover router* y toca un lugar disponible. Puedes introducir la posición exacta con el botón del editor. Cambia de piso para ubicarlo allí. El mapa muestra la banda y el piso visibles. La tabla incluye los puntos de todos los pisos y permite desplegar el cálculo por punto.
5. Guarda cada posición elegida con un nombre. La matriz muestra el resultado de todos los puntos para cada posición y señala cuál tiene el mejor mínimo en la banda activa. Presiona *Usar* sobre una posición guardada para volver a ella.
6. Cambia entre **2,4 GHz** y **5 GHz**. En *Ajustes avanzados de señal* puedes cambiar los valores de ejemplo de la banda seleccionada.

## Prueba del DWG y ejemplo importado

Se comprobó el archivo adjunto `plano_casa_9x14_2p_verplanos.com.dwg`, de 1.239.360 bytes. La firma es **AC1021, AutoCAD Release 2007**. La primera prueba extrajo la miniatura DIB de 448 × 448 píxeles y permitió identificar las dos plantas, el corte A-A’ y la fachada. Después, LibreDWG compilado a WebAssembly por MLightCAD (`@mlightcad/libredwg-web` 0.9.3) leyó la geometría y convirtió la hoja a una vista SVG.

Se recuperaron **5.596 entidades**: 3.347 líneas, 1.245 polilíneas 3D, 388 polilíneas ligeras, 190 arcos, 132 textos, 97 círculos, 71 sombreados, 66 cotas, 58 referencias de bloque y 2 ventanas gráficas. La vista 2D deja ver las plantas, el corte y la fachada, con líneas, cotas, textos, puertas, mobiliario y partes de los sombreados. El inventario describe las entidades del archivo. El dibujo que muestra el conversor puede variar en textos, colores, rellenos y entidades de soporte respecto de un visor CAD. Se ajustaron algunos colores para un fondo oscuro. Las unidades de inserción vienen sin especificar (`INSUNITS = 0`).

- **DWG directo.** La web convierte el archivo en un proceso del navegador y dibuja la vista como fondo. Para usar ambas plantas del original, abre el mismo DWG en cada piso y recorta la planta correspondiente. La planta baja aparece arriba a la izquierda y la alta, arriba a la derecha.
- **Imágenes incluidas.** [Planta baja](assets/planta-baja.png) y [planta alta](assets/planta-alta.png) son PNG de 544 × 962 píxeles, recortados a partir de la conversión vectorial del archivo adjunto. La opción *Plano de la entrega · dos pisos* carga ambas imágenes. También puedes subirlas como archivos mediante *Importar plano*. En ambos casos confirma la escala antes de marcar elementos. Para una demostración didáctica puedes marcar el ancho entre los bordes exteriores alineados y usar el ancho nominal de **9 m** del nombre del archivo como supuesto explícito. Para un caso real usa una cota legible con unidad confirmada o una distancia comprobada.
- **Visualizar y modelar.** Abrir un fondo permite ver el dibujo. Para que los obstáculos entren al cálculo, el usuario debe marcar los muros relevantes e ingresar su material y grosor. Las imágenes incluyen líneas auxiliares, mobiliario y cotas que sirven de referencia visual.

Para reproducir el inventario y exportar la vista 2D, ejecuta el comando siguiente después de instalar las dependencias, con el nombre o la ruta real del DWG. La salida SVG se puede abrir en un visor local. Para obtener una imagen por piso, rasteriza la vista y recorta cada planta como PNG, o exporta las plantas directamente como imágenes desde un visor CAD.

```sh
node tools/inspect-dwg.mjs "ruta/al/plano.dwg" "plano-exportado.svg"
```

Fuentes del formato y la conversión. [Versiones DWG de Autodesk](https://forums.autodesk.com/autodesk/attachments/autodesk/152/49579/1/AutoCAD%20Versions.pdf) · [LibreDWG](https://www.gnu.org/software/libredwg/) · [MLightCAD LibreDWG Web](https://github.com/mlightcad/libredwg-web).

## Fórmulas y supuestos

| Cálculo | Uso en la aplicación |
|---|---|
| `escala = distancia conocida / distancia en píxeles` | La escala queda en m/píxel. El ancho y el fondo de la imagen en píxeles se multiplican por ella para obtener sus dimensiones en metros. |
| `d₂ᴅ = √(Δx² + Δy²)` y `d₃ᴅ = √(Δx² + Δy² + Δz²)` | Δx y Δy son las componentes horizontales del vector del router al punto, en metros. X crece a la derecha, Y hacia abajo. La coordenada Z aumenta hacia arriba. Δz es cero en el mismo piso y ±la altura entre pisos en el otro. La tabla muestra d en metros. |
| `θ = atan2(Δy, Δx)` | Describe la dirección respecto de +X, con ángulos positivos en sentido horario al mirar el plano. Se convierte de radianes a grados. Cuando ambas diferencias son cero, la dirección horizontal queda indefinida. El supuesto de antena omnidireccional deja θ fuera del cálculo de potencia. |
| `L_FSPL = 20 log₁₀(4π f d₀ / c)` | Pérdida de referencia en espacio libre en dB. `f` es 2,4 × 10⁹ o 5 × 10⁹ Hz, `d₀ = 1 m` y `c = 299 792 458 m/s`. El resultado inicial es 40,05 dB a 2,4 GHz y 46,43 dB a 5 GHz. |
| `S_b(d₀) = P_EIRP,b + G_receptor,b − L_FSPL` | Potencia estimada a 1 m para la banda b, en dBm. `P_EIRP,b` es la potencia isotrópica radiada equivalente, en dBm. `G_receptor,b` es la ganancia de recepción, en dBi. Ambos parámetros son editables. |
| `S_b(d) = S_b(d₀) − 10 n_b log₁₀(max(d,d₀)/d₀) − ΣL_muro,b − N_losas L_losa,b` | El exponente `n_b` es adimensional. El cociente de distancias también. Limitar la distancia del logaritmo a 1 m evita un cálculo inválido en el origen. `N_losas` es la diferencia absoluta entre números de piso. Cada término restado es una pérdida en dB. La frecuencia queda incorporada en la referencia. |
| `L_muro,b = L_por 10 cm,b × grosor / 0,10 m` | Cada muro y banda tienen una pérdida editable por 10 cm. El grosor se ingresa en centímetros y se convierte a metros. La proporcionalidad es una simplificación del prototipo. |
| `mejor posición = argmaxᵢ minⱼ Mᵢⱼ` | `Mᵢⱼ` es la señal estimada en el punto j para la posición i, en dBm. Se comparan los mínimos de las filas y se informa un empate si coincide el mínimo. |

La intersección usa los parámetros de los dos segmentos. Se cuenta el muro cuando ambos parámetros caen dentro de sus segmentos y el cruce es transversal. Los contactos exactos en extremos y segmentos colineales se excluyen. Entre pisos, el trayecto se divide en tramos correspondientes al piso de salida, los intermedios y el de llegada; cada tramo se evalúa con los muros de ese piso. Se suma una pérdida de losa por cada nivel atravesado. Es una aproximación que supone router y puntos a la misma altura relativa dentro de cada piso y una separación vertical uniforme.

| Parámetro inicial de ejemplo | 2,4 GHz | 5 GHz |
|---|---:|---:|
| Potencia EIRP (dBm) | 20 | 20 |
| Ganancia del receptor (dBi) | 0 | 0 |
| Exponente de distancia | 2 | 2 |
| Pérdida de losa (dB) | 12 | 18 |
| Madera (dB por 10 cm) | 2 | 3 |
| Tabique liviano (dB por 10 cm) | 3 | 5 |
| Ladrillo (dB por 10 cm) | 6 | 9 |
| Hormigón (dB por 10 cm) | 10 | 15 |
| Otro (dB por 10 cm) | 4 | 6 |

La altura inicial de ejemplo es **2,7 m**. Las dimensiones de los ejemplos esquemáticos son **9 × 14 m**. Ninguno de los parámetros iniciales proviene de mediciones de una vivienda. El mapa calcula una matriz de muestras, una por celda, con el mismo modelo de la tabla. Debajo de **−90 dBm** deja de colorear la señal como umbral visual de demostración; los resultados numéricos conservan todo su rango y pueden ser menores.

El modelo usa trayectos rectos y solo considera los obstáculos marcados. Omite rebotes, interferencias, ruido, orientación real de antenas y trayectos alternativos por escaleras o puertas. Los resultados sirven para comparar las opciones ingresadas bajo los mismos supuestos. Los dBm estimados no predicen velocidad, latencia o estabilidad.

La pérdida de espacio libre sigue la [Recomendación UIT-R P.525-5](https://www.itu.int/rec/R-REC-P.525-5-202411-I/es). Distancia, ángulo y pérdida logarítmica continúan lo descrito en las tablas ABPro entregadas por el equipo. La aplicación incorpora la referencia por banda, la detección geométrica de obstáculos y el criterio de maximizar el mínimo.

## Guion de demostración

1. **Situación, 15 segundos.** “Comparamos ubicaciones elegidas por nosotros para una casa con señal desigual. Los datos que veremos son supuestos del modelo.”
2. **Plano, 30 segundos.** Carga *Ejemplo · dos pisos*. Muestra las plantas y elige 2,4 GHz. Edita un muro y señala los puntos donde interesa tener señal. En otra pasada puedes mostrar *Ejemplo · un piso*, o abrir el DWG, recortar una planta y marcar una distancia de escala.
3. **Cálculo, 35 segundos.** Coloca A en piso 1, X = 2 m e Y = 2 m. Abre el detalle de *Dormitorio norte*. Explica cómo el vector y la altura dan una distancia 3D y cómo el logaritmo, los muros atravesados y la losa reducen la potencia. Guarda la posición como A.
4. **Comparación, 35 segundos.** Coloca B en piso 2, X = 6 m e Y = 8 m. Guárdala como B. Señala que cada fila de la matriz representa una posición candidata y cada columna un punto. Con los supuestos iniciales, a 2,4 GHz el mínimo de A es −72,03 dBm y el de B es −74,61 dBm. Gana A porque −72,03 es mayor. Cambia a 5 GHz y observa cómo cambian los valores.
5. **Cierre, 15 segundos.** “Si cambiamos la posición, la banda o las pérdidas, se recalcula cada celda. Para estudiar la precisión harían falta mediciones reales en los mismos puntos y frecuencias.”

## Pruebas

```sh
npm test
```

La suite prueba distancias 2D y 3D, ángulo, referencia y pérdida por banda, cruce y contacto entre segmentos, grosor, losa entre pisos, comparación por el peor punto y validación de la escala.

La prueba de integración usa Chromium mediante Playwright. Para repetirla fuera de este entorno instala Playwright temporalmente, descarga Chromium y pasa la ruta al DWG adjunto. Arranca su propio servidor local en el puerto 8014.

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.test.mjs "ruta/al/plano.dwg"
```

# RouterOptimalSmart
