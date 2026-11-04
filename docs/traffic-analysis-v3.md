# Traffic Analysis v3: corte vertical y revisión

Estado: formato nuevo funcional para capturas nuevas; lector v2 conservado. Este corte no cierra el rendimiento de rangos enormes ni constituye una validación de producción en Windows. No cambia el identificador de la aplicación, las rutas de Tauri ni las versiones de release.

## Fuente canónica y fidelidad

`traffic_store_v3.rs` escribe una fuente canónica independiente de los hechos:

- Esquema ordenado y origen compartidos; secuencia original y override para IDs no convencionales.
- BLOB de tokens posicionales con versión 1, varints y referencias a valores repetidos. Las referencias léxicas están limitadas a 4096 valores seleccionados de hasta 128 bytes; otros tokens permanecen inline. El diccionario se comparte con los hechos cuando la grafía coincide.
- Registro excepcional con línea de origen cuando hay discrepancia de cantidad de tokens o comillas sin cerrar. No guarda además otro vector completo de esa línea.
- Metadatos de formato SQLite v3, codec, interpretación y proyección. Cambiar la interpretación requiere conservar un lector de la versión anterior.

No hay JSON persistido por request normal ni columna `search` con otra copia de sus valores. `rawFields`, `normalized` y JSON se reconstruyen al pedir el detalle. Los campos desconocidos, tokens extra, sentinelas, comillas, escapes y cambios de `#Fields` se conservan. Los diagnósticos de malformación referencian la línea canónica excepcional; las líneas sin esquema sólo tienen diagnóstico.

La fidelidad exigida es semántica y de grafía de cada token. No se conservan separadores entre tokens, comentarios, grafía del encabezado, BOM ni terminadores originales del archivo. La UI identifica la línea reconstruida. Un bug silencioso de tokenización no siempre podrá corregirse sin el archivo externo: conservar RAW para todos los registros ofrecería esa garantía adicional, a cambio de almacenamiento.

La alternativa RAW + schema sigue siendo más sencilla para retokenizar históricos. No se ha demostrado que tokens gane frente a RAW comprimido: el benchmark mide el payload de tokens y el tamaño total v3, no una implementación completa y comprimida de esa alternativa. Se elige tokens para evitar retokenizar las filas normales y compartir valores, conservando una representación excepcional ante ambigüedad.

## Proyección y consultas

Los hechos guardan tiempo, bytes, flags e IDs de dimensiones escalares. Sólo categorías e incidencias usan membresías multivaluadas con claves enteras. Los contadores globales mantienen nombres por valor distinto para resolver Tops mediante sus índices; esta redundancia derivada no repite el documento por request. Un timestamp no indexable conserva un hint textual excepcional para que la página compacta no pierda su representación previa.

En v3, el recorrido habitual de un rango agrupa IDs en una pasada, calcula resumen/únicos/timeline y recorre únicamente las membresías multivaluadas correspondientes. Los nombres se resuelven por lote después de agrupar. El plan observado usa `records_time` y busca las membresías por `record_id`, sin expandir diez dimensiones textuales por request.

Los agregados completos se reutilizan entre páginas de rankings y métricas. Los presupuestos estimados son 16 MiB para rankings, 4 MiB para resumen/timeline y 4 MiB para IDs de búsqueda, con límites adicionales de entradas. Estos números no son un límite de RSS: hay estructuras transitorias y una caché de respuestas final separada. Los rangos con cardinalidad excesiva usan paginación SQL exacta; esa ruta sigue teniendo agrupación y ordenación completas.

La revisión temporal usa los contadores de los minutos intersectados: admite llegadas fuera de orden y evita invalidar un rango por ingestión en minutos ajenos. Las opciones globales de filtros se refrescan incluso al reutilizar una respuesta de rango.

La búsqueda conserva la semántica v2: valores interpretados en orden de nombre de campo, con la última ocurrencia presente de un campo duplicado, concatenados con espacios; `LIKE` mantiene comodines escapados. Decodifica sin copiar cada token normal y reutiliza planes de esquema. Las coincidencias se materializan una vez por consulta en tablas TEMP y se cachean por IDs dentro de su presupuesto. No hay aún un índice FTS/trigram: la búsqueda nueva sigue siendo lineal.

La UI solicita páginas compactas sólo para las vistas de registros y pide el detalle por ID al abrirlo. Los paneles analíticos y el PDF omiten registros. Las consultas descartadas por cambio de selección pueden interrumpirse en SQLite. La tabla sigue usando OFFSET, no cursores.

El streaming agrupa el texto recibido hasta 256 KiB o el siguiente intervalo de 500 ms. Al detenerlo conserva el texto parcial recibido para su interpretación/diagnóstico. Sigue existiendo un mutex compartido de sesiones y el timeline acumulado continúa viajando por IPC; este corte no implementa eventos delta ni cambia la importación estática de chunks de 8 MiB.

## Compatibilidad y comportamiento observable

- Consultas, listados y detalles abren SQLite con `SQLITE_OPEN_READ_ONLY`; sólo guardar una captura abre una conexión de escritura explícita.
- Las bases v2 se leen con su esquema original, sin ALTER, VACUUM, conversión ni modificación de capturas históricas. Conservan su ruta analítica heredada; no se les atribuye el rendimiento de v3.
- Crear una captura exige un archivo nuevo: no sobrescribe un SQLite existente.
- Se mantiene substring para cliente/usuario/host/categoría/threat y coincidencia exacta para método/acción/status. `errorsOnly` sigue afectando a la página de registros, no al resumen/rankings.
- Las categorías se deduplican por membresía; las incidencias múltiples no multiplican el total de requests. Los porcentajes multivaluados pueden sumar más de 100%.
- Los listados compactos muestran los bytes analíticos no negativos; el detalle conserva los valores originales. Los timestamps no indexables siguen disponibles en el listado, aunque no participen en rangos temporales.
- En v3 se corrigen los buckets anteriores a 1970 para que rango y global usen el mismo redondeo hacia abajo. El lector v2 mantiene su comportamiento histórico.
- La fuente puede regenerar los hechos, como comprueba una prueba que elimina la proyección sintética y reconstruye otra base. No hay todavía un comando de mantenimiento/conversión publicado. Ninguna conversión destructiva es automática.

## Evidencia de rendimiento

Datos exclusivamente sintéticos: 100000 requests, 10000 hosts, hasta 64516 clientes, 2000 usuarios, rutas únicas y categorías repetidas. Todos los archivos se crean con nombre único en el directorio temporal y se eliminan al terminar. Nunca se usan capturas del operador como fixtures mutables.

| Consulta | Primera implementación, debug | Tras corregir agrupación/caché, debug |
| --- | ---: | ---: |
| Primer rango | 2470 ms | 1114 ms |
| Otra página de ranking | 2149 ms | 63 ms |
| Otra métrica | 2102 ms | 68 ms |
| Substring selectivo | 6099 ms | 800 ms |
| Página profunda de registros | 12 ms | 11 ms |

La primera medición rechazaba la caché por su presupuesto y repetía SQL; además, búsqueda/resumen/rankings/timeline decodificaban repetidamente la selección. Las trazas de admisión y `EXPLAIN QUERY PLAN` permitieron distinguirlo. El recorrido actual comparte resumen/timeline con la agrupación de hechos.

Una ejecución posterior del código actual, optimizando **sólo el paquete de la app a nivel 2**, dio: primer rango 665 ms; otra página 13 ms; otra métrica 8 ms; substring 291 ms; página profunda 12 ms. Dependencias y SQLite seguían en perfil de test: no es una build release ni debe compararse como si tuviera el mismo perfil que la columna debug.

En esa ejecución: RAW de líneas 14641396 bytes; payload JSON equivalente 257895875 bytes; payload de tokens 11893806 bytes; SQLite v3 total 44089344 bytes; ingestión 20051 ms. El JSON es una medida de payload, no el tamaño de una SQLite v2 construida. La SQLite incluye índices/diccionarios/proyecciones; el payload de tokens no incluye todos esos componentes. El tiempo de ingestión incluye generación sintética, parser y serialización para estimar el JSON de referencia; no es una medida aislada de escritura SQL. Los tiempos de consulta se toman después de abrir la conexión y no incluyen IPC ni render del frontend.

“Primer rango” significa caché analítica vacía y conexión lectora nueva; la caché del SO estaba caliente por la ingestión. No se midió almacenamiento físicamente frío, p95, RSS máximo, millones de requests, capturas reales ni Windows. El primer rango y la búsqueda siguen escalando con los datos: no se afirma resuelto el rendimiento de intervalos enormes.

## Verificación y reproducción

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib traffic_ --offline
npx tsc --noEmit --incremental false
npx playwright test --config tests/traffic-report-model.config.ts
node --experimental-strip-types --test src/lib/trafficAnalysis.test.mjs
npx biome check src/components/trafficAnalysisWorkspace.tsx src/lib/trafficAnalysis.ts src/lib/trafficReport.ts
pnpm exec next build
```

Benchmark opt-in, con archivo temporal nuevo:

```sh
TRAFFIC_QUERY_PROFILE=1 cargo test --manifest-path src-tauri/Cargo.toml --lib benchmark_compact_store --offline -- --ignored --nocapture
TRAFFIC_QUERY_PROFILE=1 cargo test --manifest-path src-tauri/Cargo.toml --config 'profile.test.package.proxytools.opt-level=2' --lib benchmark_compact_store --offline -- --ignored --nocapture
```

`TRAFFIC_BENCH_ROWS` cambia la cantidad sintética dentro de límites acotados. Las trazas imprimen etapas, admisión/hits y planes, sin valores de capturas del operador.

Las pruebas cubren codec corrupto/truncado, round-trip, sentinelas/escapes/campos duplicados, esquemas cambiantes, malformación, rollback, regeneración desde fuente, filtros/rankings/redes, v2/v3, lectura v2 sin modificar bytes, opciones globales con caché temporal, timestamps no indexables/anteriores a 1970 y cancelación SQL activa. Las pruebas de modelo PDF renderizan fixtures en ambos temas.

Los E2E de navegador se verificaron posteriormente contra la exportación de producción: **5 pruebas aprobadas** (detalle compacto bajo demanda y PDF claro/oscuro en modos navegador/Tauri simulados). El servidor Next de desarrollo falló con `listen EPERM` en un sandbox anterior; para la verificación final se utilizó un servidor HTTP local que resuelve rutas estáticas sin extensión hacia su archivo `.html`. El servidor Python sin reescritura inicialmente devolvía 404 y no sirve para ejecutar estas pruebas sin adaptación. Se empleó `/usr/bin/chromium` y no se ejecutó la UI Tauri nativa sobre Windows. Para reproducirlas, compilar la exportación, servir `dist/` en 127.0.0.1:3100 reescribiendo `/Diagnostics/TrafficAnalysis?...` a `/Diagnostics/TrafficAnalysis.html`, y ejecutar:

```sh
pnpm exec next build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test --config tests/traffic-static.config.ts
```

Además, `pnpm tauri build --no-bundle` terminó correctamente en Linux, generando `src-tauri/target/release/proxytools` sin instaladores. Esto verifica la compilación release del frontend y el ejecutable Rust, pero no su funcionamiento nativo completo con un proxy real ni la compilación Windows de GitHub Actions.

Se corrigieron cuatro errores de accesibilidad preexistentes de Biome en el workspace; permanecen advertencias de complejidad/non-null anteriores. Los fixtures nuevos también pueden emitir advertencias por complejidad y nombres exigidos por las APIs de Tauri/Playwright. El ajuste en `embedded_browser.rs` sólo completa un campo faltante de un fixture que impedía compilar tests.

## Pendientes del rework integral

1. Medir release Windows y capturas reales consistentes, inicialmente sólo lectura, con distribuciones de alta cardinalidad y rangos muy amplios.
2. Agregados temporales persistentes selectivos y estrategia para alta cardinalidad. No se ha creado un cubo de todas las combinaciones ni un Top local que pierda exactitud.
3. Índice de búsqueda que preserve la semántica acordada, cursores para páginas profundas y presupuesto de memoria observado.
4. Comandos de conversión/reconstrucción hacia archivos nuevos, reanudables, con comprobación de equivalencia; lector v2 sigue siendo la protección actual.
5. IPC incremental de timeline y aislamiento del mutex de sesiones; reducir memoria transitoria del parser estático.
6. Validar la interacción real en Chromium y Tauri Windows. Comparar RAW comprimido frente a tokens comprimidos antes de añadir compresión.
