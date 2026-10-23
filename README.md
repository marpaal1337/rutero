# Montgó · domingo 25-oct-2026 · 5 amigos desde Valencia

## Comparativa (generada con OSM + EU-DEM 25 m; subida = una vía)
| Ruta | Km | Desnivel + | Alt. salida | Subida / bajada* | Carácter |
|---|---|---|---|---|---|
| **A** Directa campo de tiro Les Planes (PR-CV 355) | 3,35 (publicado 3,87) | +526 m | 212 m | 1h30 / 0h30 | Corta y empinada (media ~16 %, máx ~58 %); cresta final con trepada |
| **C** Camí de la Colònia (Dénia, ruta naranja) | 5,84 (publicado ~6) | +821 m | 52 m | 2h30 / 1h00 | Pista larga y suave y último km muy empinado (hasta ~72 %), piedra suelta |
| **B** Larga Jesús Pobre · GR-330 · Creueta de Dénia | 8,88 | +742 m | 74 m | 3h00 / 1h30 | La más larga y gradual, sin trepada fuerte; la más tranquila |

*Naismith (5 km/h + 1 h/600 m) para un grupo sin parar; con 5 personas, fotos y comida suma ~+25 %.

Archivos: `out/ruta_*.gpx` (track + waypoints), `out/perfil_A|B|C.png`, `out/perfil_comparativo.png`, `out/stats.json`.

## Visor 3D

`out/visor_3d_artifact.html` es un visor 3D autocontenido (three.js, relieve y mapa incrustados) que se abre directamente en el navegador sin servidor ni conexión. Se genera con `python scripts/fetch_tiles.py && python scripts/build_artifact.py` (requiere numpy y Pillow).

## Recomendación
- **Grupo en forma que quiere ir a lo seguro de tiempo: A.** Señalizada (PR-CV 355), la más corta y la más cercana a Valencia. Cuidado con la cresta final (manos).
- **Si queréis una excursión más larga: B**, más gradual. Evita la trepada fuerte.
- **C** solo si os gusta el último km a tope; es la de más desnivel.
- Las 3 son ida y vuelta por el mismo track (GPX de subida).

## Logística
- Valencia → Les Planes/Dénia: ~105-110 km, ~1h15 por AP-7 (salida de Valencia 7:00 para empezar sobre las 8:30).
- **Ojo: esa noche cambia la hora (cambio a horario de invierno, 03:00 → 02:00).** Puesta de sol ≈ 18:15; estar abajo antes de las 17:00.
- 2-3 L de agua por persona, calzado con suela de montaña, cortavientos, frontal por si acaso. Sin fuentes en ruta.

## Avisos importantes
- **Temporal / alerta roja 18-19 oct en la Marina Alta**: puede haber sendas dañadas o piedra suelta; revisar el estado.
- Posibles restricciones por riesgo de incendio (nivel 3 prohíbe senderos). Confirmar con el Parque: parque_montgo@gva.es · 966 427 155.
- El AEMET solo llega al sábado 24 (15/22 °C, 0-10 % lluvia). El domingo 25: mirar la previsión el sábado por la tarde.

## Limitaciones del track (honestas)
- Rutas calculadas sobre sendas de OpenStreetMap, no son grabaciones GPS. Las distancias salen ~10-13 % por debajo de las publicadas en la ruta A.
- La **circular clásica de Jesús Pobre por el Barranc de l'Hedra (6,27 km, +746 m, 3h45) no está conectada en OSM**, por eso B es la variante larga por GR-330. Para la clásica, descargar el GPX de Wikiloc 49391841 (requiere login).
- El DEM suaviza la cumbre (≈735 m frente a 752 m reales); el waypoint de cumbre usa 752 m.
- Cotejar con Wikiloc / Komoot antes de salir.

Regenerar: `python scripts/fetch_osm.py data/osm.json && python scripts/build_routes.py` (necesita matplotlib y networkx).

## Cims valencians (mapa 3D con comparador de rutas)

Web estática en `web/` (MapLibre), con **un solo mapa 3D**: la vista regional muestra las cimas y una lista con filtros (provincia, búsqueda, orden por altura o cercanía a Valencia); al elegir una, la cámara vuela hasta ella y aparece el visor 3D de sus rutas (pestañas A/B/C, color por pendiente, sol, sobrevuelo, perfil inferior con las rutas superpuestas y una tabla plegable «Comparar rutas» con la mejor de cada métrica). El enlace `#/cima/<id>` abre directamente una cima. Piloto con 7 cimas: Penyagolosa, Aitana, Puig Campana, Cabeçó d'Or, Bèrnia, Mondúver y Montgó.

Para verla en local hay que servir la **raíz del repositorio** (la web carga `scripts/shared.js`): `python -m http.server` y abrir `/web/`. `index.html` de la raíz redirige ahí (GitHub Pages). El visor antiguo solo del Montgó sigue en `out/visor_3d.html`.

Pipeline (solo biblioteca estándar; no necesita networkx ni matplotlib. Solo `ELEV_SOURCE=terrarium`, que saca las altitudes de teselas AWS Terrarium en lugar de EU-DEM, requiere además numpy y Pillow):
1. `data/cimas/peaks.json`: catálogo de cimas (coordenadas y altura verificadas en OSM).
2. `python scripts/cimas_fetch.py [id…]`: descarga de Overpass la red de sendas, las relaciones de senderismo y los puntos de interés (`data/cimas/*_osm.json`, no se versiona).
3. `python scripts/cimas_candidates.py <id>`: propone salidas candidatas por sector de orientación para elegir rutas.
4. `data/cimas/routes.json`: rutas por cima (punto de salida + cumbre, o un GPX existente).
5. `python scripts/build_cimas.py [id…]`: enruta sobre OSM (las sendas PR/GR/SL pesan más), saca altitudes de EU-DEM 25 m, calcula las métricas y escribe `web/data/*.json`. Añade el tiempo en coche desde Valencia (OSRM público) y el nombre de la salida (Nominatim). Cada ruta con una salida dudosa lleva un campo `warn` (la web la marca con «⚠ salida por revisar»).
6. `python scripts/cimas_review.py [id…]`: lista las salidas dudosas sin red: `lejos_red` (inicio a más de 150 m de una senda), `sin_parking` (ningún aparcamiento o refugio de OSM a menos de 300 m), `coche_largo` (más de 150 min desde Valencia o sin dato) y `corta`/`larga` (fuera de 3-12 km). Sale con 1 si hay `lejos_red` o `sin_parking`.

Código: `web/index.html` (estructura), `web/app.css`, `web/app.js` (mapa, lista, visor), `web/clusters.js` (clase `PeakClusters`: agrupa los marcadores de cimas cuyas etiquetas se solapan con el zoom actual y, al pulsar un grupo, acerca la cámara hasta deshacerlo) y `scripts/shared.js` (sol y color por pendiente, compartido con el visor del Montgó; `setSunLocation(lat, lon, fecha)` lo adapta a cada cima, por defecto con la fecha de hoy).

Limitaciones: las rutas son calculadas, no grabaciones GPS, y las salidas piloto son aparcamientos de OSM elegidos por sector; `cimas_review.py` marca las dudosas, pero conviene mirar a mano las marcadas antes de fiarse de ellas. «Señalizada» cuenta solo relaciones GR/PR/SL de OSM. Con cientos de cimas convendría pasar de marcadores HTML a una capa de símbolos de MapLibre (necesita glifos).
