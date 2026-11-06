# Active Connections Monitor — informe técnico y contrato de datos

## Alcance, evidencia y certeza

Módulo independiente para observar **proxied connections** mediante snapshots XML, sin acceso a un appliance durante el desarrollo. No incluye bypassed connections ni termina sesiones. No modifica Traffic Analysis, Policy Trace, identificador de aplicación, credenciales ni formatos anteriores. Documento escrito antes de la implementación; la sección final delimita el corte efectivamente entregado. No se ejecutaron tests ni builds.

La evidencia de SGOS **7.4.4.2** es el análisis aportado por el usuario/orquestador de `proxied connections.txt`: un archivo HTML guardado por Chromium con XML embebido, no una respuesta HTML aceptable del endpoint. No se ha inspeccionado el archivo original en este turno y no se incluyen nombres, direcciones ni seriales privados. El cliente Live exige XML nativo con la estructura correcta: no extrae XML de una página de login o HTML.

Niveles: **E** = observado en esa única muestra según análisis aportado; **D** = documentación pública consultada; **I** = inferencia/diseño conservador; **U** = significado exacto no verificado en SGOS 7.4.4.2. Una frecuencia observada no es un enum completo ni una garantía del fabricante.

Fuentes y límites de atribución:

- [Broadcom 166641](https://knowledge.broadcom.com/external/article/166641): documenta `/AS/` como área avanzada y advierte usarla bajo dirección del soporte. No valida por sí sola los dos endpoints XML ni garantiza su estabilidad. D.
- [Broadcom 171482](https://knowledge.broadcom.com/external/article/171482): diagnóstico de sesiones activas, columnas Client Bytes, Application, ICAP y Detail; no proporciona un diccionario de códigos XML. D. No se extrapola una columna de texto a la semántica numérica de `ICAP*.Status`.
- [Broadcom 165686](https://knowledge.broadcom.com/external/article/165686): separa proxied sessions y bypassed connections y describe filtros. D. El módulo no implementa comandos de terminación.
- [Broadcom 166747](https://knowledge.broadcom.com/external/article/166747): referencia aportada sobre aumento de Server Bytes tras abortar el cliente; no pudo recuperarse por el navegador de investigación en este turno. Fuente pendiente de relectura, no corroboración independiente.
- [Broadcom 174104](https://knowledge.broadcom.com/external/article/174104): documenta `cs/sc/sr/rs-bytes` de access logs. D. Esos cuatro contadores direccionales **no están presentes en este XML**.
- [Manual histórico de SG Appliance](https://somanuals.com/html/6/Blue-Coat-Systems-Appliance-Trim-Kit-Blue-Coat-Systems-SG-Appliance-User-Manual.html): referencia aportada para `/AS/Sessions/xml` y etiquetas antiguas; no recuperable en esta consulta. U respecto a SGOS actual. No se afirma cuál ruta es legacy en 7.4 ni que ambas respuestas sean idénticas byte por byte.

## Evidencia cuantitativa recibida

XML núcleo: aproximadamente 1.604.921 caracteres. `DisplaySess=1188`, `DisplayConn=1191`, 1188 Session y 1191 Connection. 1186 sesiones tienen un miembro, una tiene dos y una tres. Hay 1188 Primary y tres Secondary. 191 Client.Address distintos; 327 Server.Address distintos incluyendo vacío; 41 Service.Application. Service.Name fue Explicit HTTP en esa muestra; Protocol fue SSL 920, HTTP 270 y HTTPS Fwd 1. Esto no restringe futuros servicios/protocolos/puertos.

Connection.Error fue `0` en todos. Client.Active: 1188 con `1`, tres con `0`; Server.Active: 1171 con `1`, veinte con `0`. Client.StartTime presente en 1188; Server.StartTime en 1174; Server.EndTime en 33; Server.RemoteAddress ausente en 17. Details presente en 1188 y ausente en tres. Client.Active=1 y Server.Active=0 no significa sesión cerrada.

Gain.Value y Savings presentes en 1179; doce Gain tenían CacheHit=false sin esos valores. Value incluyó un `inf` y siete `-nan`; Savings siete `-nan`. Value finito observado: 0,93 a 1,94. Age.Seconds fue `Active` en 1188 y decimal 124.xxx en tres Secondary; Duration.Seconds entre 0,006 y 1084344,069 (aprox. 12,55 días). ICAPREQMOD y ICAPRESPMOD: 1183 códigos `1`, ocho `0` cada uno. ObjectCache: diez `0`, tres `1`, 1178 `2`; Latency: 919 `0`, 22 `1`, 250 `2`; BandwidthManagement siempre `0`. Son códigos sin equivalencia numérica verificada: Latency no es milisegundos, `1` no prueba escaneo completado.

## Diccionario completo de campos

Regla general: XML es texto. Se conserva el valor léxico original; ausente se diferencia de cadena vacía. Atributos inesperados y elementos desconocidos se retienen en el árbol crudo estructurado. Las vistas normalizadas usan nullable; nunca convierten ausencia en cero. `raw` significa valor decodificado de entidades XML, no bytes originales. No se persiste XML completo por poll. Fechas de miembro se mantienen raw hasta verificar su formato; no se les asigna zona implícita. Todas las siguientes rutas son relativas a BlueCoatResponse salvo indicación. E salvo donde se indica U/I.

| Ruta/campo | Tipo interpretado / unidad | Semántica y casos |
|---|---|---|
| Device.Type | string nullable | Clase declarada de dispositivo; no enum cerrado. |
| Device.SerialNumber | string sensible | Identificador del appliance; sólo hash para identidad, en metadatos guardados se enmascara. Nunca fixture real. |
| Device.Name | string sensible nullable | Nombre declarado; no hostname de destino para solicitudes. |
| Device.Address | string sensible nullable | Dirección declarada del dispositivo; no autoriza otros hosts. |
| Device.OSVersion | string nullable | Versión SGOS declarada, sin inferir soporte por versión. |
| Device.DeviceTime | timestamp raw + UTC nullable | Hora del appliance; muestra UTC. Comparar sólo si formato reconocido. Skew respecto a receivedAt incluye latencia. |
| Stats.AccessPath | string nullable | Ruta lógica declarada, observada `/AS/ProxiedConnections`; distinta de ruta HTTP efectiva. |
| Stats.Description | string nullable | Descripción libre; no controlar lógica con texto traducible. |
| Stats.Status | string nullable | `Current` observado; otros valores generan advertencia, no se ocultan. |
| ProxiedConnections.Session | grupo ordenado | Una sesión contiene uno o más Connection, conserva parentesco y orden. No hay ID estable suministrado. |
| Connection.Type | string nullable | Primary/Secondary observados; aceptar desconocidos y conservar. No contar Secondary como nueva sesión. |
| Connection.Error | string/código nullable | `0` observado; otros códigos no se traducen a causas inventadas. |
| Gain.Value | raw + número finito nullable / multiplicador | `inf`, `-nan`, ausente no son valores para gráficos. No promedio ingenuo. |
| Gain.Savings | raw + número finito nullable / porcentaje reportado | Puede ser negativo/no finito/ausente; conservar raw. |
| Gain.CacheHit | raw + boolean nullable | `false` observado sin Value/Savings. No rellenar ratio. |
| Client.Address | string nullable | Endpoint del lado cliente; vacío y ausente distintos. |
| Client.Port | raw + entero nullable / puerto | No hardcodear 443; validar rango antes de uso numérico. |
| Client.RemoteAddress, Client.RemotePort | string, puerto nullable | Extremo remoto reportado en ese tramo; no necesariamente idéntico a Address/Port. |
| Client.LocalAddress, Client.LocalPort | string, puerto nullable | Extremo local del proxy en el tramo cliente. Parte de identidad candidata. |
| Client.AddressInfo | string nullable | Información libre asociada al endpoint, puede vacía. |
| Client.Bytes | raw + entero no negativo nullable / bytes | Acumulado **bidireccional del lado cliente**, no upload. Nunca sumar snapshots como tráfico. |
| Client.Active | raw + boolean nullable | Actividad del tramo cliente; `0`/`1` observados. No estado global de Session. |
| Client.StartTime, Client.EndTime | timestamp raw nullable | Inicio/fin declarados del tramo; no equivalen a first/last observed. Ausencia no prueba actividad. |
| Server.Address, Server.Port | string, puerto nullable | Destino reportado; Address puede vacío, Port puede `0`. No descartar fila. |
| Server.ClientDestAddress, Server.ClientDestPort | string, puerto nullable | Destino solicitado por cliente cuando reportado, puede diferir del destino efectivo. |
| Server.RemoteAddress, Server.RemotePort | string, puerto nullable | Remoto del tramo servidor; atributos opcionales. |
| Server.LocalAddress, Server.LocalPort | string, puerto nullable | Local del tramo servidor; opcional. |
| Server.AddressInfo | string nullable | Información libre, no tratar como nombre DNS validado. |
| Server.Bytes | raw + entero no negativo nullable / bytes | Acumulado bidireccional **del lado servidor**, no download. Puede crecer tras desconexión cliente (referencia aportada). |
| Server.Active | raw + boolean nullable | Estado del tramo servidor, independiente del cliente. `0` no implica sesión cerrada. |
| Server.StartTime, Server.EndTime | timestamp raw nullable | Inicio/fin del tramo servidor; EndTime explícito tiene prioridad sobre inferencias. |
| Age.Seconds | unión `Active` / decimal nullable / raw | No campo numérico obligatorio; Secondary puede tener edad numérica. Semántica exacta de edad U. |
| Duration.Seconds | raw + decimal finito nullable / segundos | Duración declarada; puede superar días. No latencia ICAP. |
| Routing.SOCKS | código raw nullable | Estado de enrutamiento SOCKS; no enum verificado U. |
| Routing.SOCKSInfo | string nullable | Información de SOCKS; vacío/`:0` posibles, no endpoint para solicitudes. |
| Routing.Forwarding | código raw nullable | Estado de forwarding U. |
| Routing.ForwardingInfo | string nullable | Información reportada libre. |
| Routing.FromCache | código raw nullable | Estado reportado de caché U; no derivar ratio. |
| Routing.FromCacheInfo | string nullable | Información reportada libre. |
| Service.Name | string nullable | Nombre de servicio sin lista cerrada. |
| Service.Application | string nullable | Clasificación reportada; `none`/vacío/ausente se presenta Unclassified, raw sigue disponible. |
| Service.Protocol | string nullable | Protocolo reportado, no inferir cifrado/inspección únicamente por puerto. |
| ICAPREQMOD.Status | código raw nullable | Estado de request modification; no tiempo, éxito ni finalización verificables U. |
| ICAPRESPMOD.Status | código raw nullable | Estado de response modification; mismas restricciones U. |
| Acceleration.ObjectCache | código raw nullable | Estado categórico, no cantidad de objetos U. |
| Acceleration.Latency | código raw nullable | Estado categórico, **no ms** U. |
| Acceleration.BandwidthManagement | código raw nullable | Estado categórico, no tasa ni porcentaje U. |
| Details.Subsystem | string nullable | HTTP observado; aceptar otros subsistemas. Details completo puede faltar. |
| Details.Error | raw + boolean nullable | false observado; aceptar true y valores desconocidos sin pérdida. |
| Details.Text | string nullable | Texto diagnóstico libre, vacío permitido; renderizar como texto escapado. |
| Total.DisplaySess | entero no negativo nullable / sesiones | Concurrencia reportada de ese instante, no total histórico de solicitudes. |
| Total.DisplayConn | entero no negativo nullable / conexiones | Concurrencia reportada, incluye miembros Secondary. Contrastar con parseo. |

Ejemplo semántico sintético numérico: Client.Bytes=2902, Server.Bytes=2615, Gain.Value=1.11 y Savings=9.89 no constituyen upload/download ni ratios agregables sin denominadores compatibles. Nunca sumar arbitrariamente contadores de Primary y Secondary para inferir flujo nuevo.

## Transporte y sampling

Origen exclusivamente `proxy_base_url(selectedProxy)` HTTPS puerto 8082, validación existente; credenciales sólo en memoria y transporte autenticado compartido. Primera ruta `/AS/ProxiedConnections/XML`, fallback `/AS/Sessions/xml` únicamente en 404/405/410/501, ruta inaccesible o XML inválido/estructura errónea. No fallback en 401/403 ni login HTML con 200. Una respuesta válida con cero es Empty, nunca motivo de fallback. Ruta exitosa sticky, como máximo dos candidatos por fallo; no dos consultas cada ciclo normal.

Un worker backend, una petición en vuelo, intervalo configurable 5/10/30/60 s (10 por defecto), timeout total 30 s incluyendo autenticación/lectura, cuerpo máximo 16 MiB descomprimido, parser de eventos con profundidad/nodos limitados, DTD y referencias externas prohibidas. Cancelación aborta petición/sleep; pausa cancela la petición en vuelo y conserva captura. Stop finaliza sin destruir ni guardar implícitamente. Refresh manual usa el mismo worker, nunca una segunda petición concurrente. Fallos repetidos: backoff hasta 120 s; auth detiene polling hasta acción explícita. Fallo es Gap/Error/Unavailable, **no cero**. Registrar UTC recibido, DeviceTime, duración, bytes, ruta y calidad. 1,6 MB cada 10 s ≈576 MB/h (decimal, sin compresión); la UI estima usando respuesta medida y advierte costo.

## Identidad e integridad histórica

No hay identificador estable proporcionado. Clave candidata Primary: hash de identidad del dispositivo + Client.Address/Port/LocalAddress/LocalPort/StartTime + Type. Secondary: padre Primary + endpoint servidor + Server.StartTime + Type. Duración, bytes, routing, protocolo y clasificación no forman identidad. Falta de timestamps, varios Primary o colisión en un snapshot producen identidad ambigua; no se fusionan como una conexión probada. La reutilización de puertos con distinto StartTime produce clave distinta. El hash de serial permite identidad sin conservar serial plano.

FirstObserved/LastObserved son límites de observación; StartTime/EndTime pertenecen al appliance. No longer observed sólo puede inferirse entre muestras válidas consecutivas y no prueba hora exacta de cierre. Tras gap no inferir cierres. Un snapshot idéntico sigue agregando punto temporal; no debe aumentar nuevos observados ni bytes transferidos. Unique Clients es cardinalidad de Address en **esa muestra**; no usuarios ni acumulado. Lifetime unique, si se implementa, es aproximado. Tasas sólo entre claves inequívocas consecutivas, contadores monótonos y mismo ámbito; delta negativo es reset/desconocido, nunca clamp. Este primer corte conserva evidencia pero no publica tasas, cierres ni conteos lifetime mientras no estén resueltos de forma confiable.

## Persistencia concreta y consultas

Formato SQLite propio versión 1 bajo cache estándar de Tauri, subdirectorio `active-connections`, fichero por captura con ID generado internamente. Scope obligatorio proxy normalizado + perfil live/mock; enumeración por scope, sin unassigned. Sin migrar/eliminar capturas anteriores. Save marca explícitamente la captura para biblioteca; un borrador permanece recuperable mientras su ID esté en el runtime. Reabrir guardada sólo consulta DB, sin credenciales ni HTTP.

Tablas: captures (versión, scope, intervalo, inicio/fin, saved y ruta); snapshots (UTC, tiempo dispositivo raw, métricas reportadas y parseadas, calidad, hash, bytes y duración); sessions/connections (claves candidatas, ambigüedad, parentesco, first/lastSeen); states (diccionario de estados estructurados completos por contenido); observations (runs con snapshot inicial/final por conexión y state). Cada estado diferente se interna una vez; el run se extiende cuando permanece idéntico en muestras consecutivas. Esto preserva **cada instante exacto muestreado**, incluso snapshots repetidos, sin JSON completo repetido por miembro y poll. Duration cambia a menudo: se reconoce que puede reducir la compresión; no se cuantiza silenciosamente. Metadatos Device/Stats/Total estructurados deduplicados separados de los miembros. No raw XML persistido.

WAL, una transacción por poll, prepared statements e índices por rango de snapshots, miembro/run, cliente, destino y scope. Consultas frontend: ventana temporal paginada de snapshots; página de miembros de un snapshot con búsqueda/sort whitelist; rankings del snapshot; detalle con árbol completo sólo bajo demanda. Nunca cargar toda la captura al frontend. Cancelación de queries por token/runtime y límite de resultados; operación SQL pesada fuera del hilo async. Agregados minuto/hora y diccionarios por atributo son evolución pendiente: no sustituyen detalle ni inventan resolución perdida. El corte inicial interna el árbol completo de cada estado, conservando fidelidad; no afirma tener codec diferencial por atributo.

## UX concreta

Diagnostic Tools incorpora tarjeta Active Connections. Página `/Diagnostics/ActiveConnections?proxy=…`; PageHeader, Card, Button, Badge, TimeZonePicker y DateTimePicker compartidos, ECharts y slider compacto existente. Sin nuevo sistema visual. Cabecera muestra proxy/perfil, ruta activa, zona horaria, intervalo, Start/Pause/Resume/Stop, Refresh, Save, Load Saved. Polling permanece en backend al navegar; al abrir otro proxy/perfil se detiene la captura incompatible. El runtime no persiste credenciales al cerrar la app.

Cuatro KPIs: sesiones reportadas, conexiones reportadas, clientes distintos de última muestra válida y peak de ventana visible. Delta se compara con último punto válido, nunca con error convertido a cero. Estado de polling, última recepción, stale y errores separados del Empty válido. Gráfico de dos series sin conectar gaps, hora en zona elegida y tooltip completo; click selecciona snapshot exacto. KPIs de arriba permanecen live, tabla inferior inspecciona histórico y Return to Live lo aclara. Vista guardada es revisión histórica. Selector fecha/hora centra una ventana, presets para historia y paginación de timeline sin ocultar recortes.

Tabs: Connections (páginas pequeñas, búsqueda cliente/servidor/aplicación/protocolo, orden controlado, relación Session/Primary/Secondary y detalle de **todos** los atributos, incluidos desconocidos); Top Clients y Destinations (miembros observados y bytes acumulados de ese snapshot por lado, sin presentarlos como tráfico del período); Diagnostics (larga duración, tramos discordantes, errores raw, calidad, códigos ICAP/Acceleration sin equivalencias). La tabla agrupada debe hacer visible que count de miembros no es count de sesiones. Inputs compactos, KPIs 2 columnas móvil, overflow sólo local en tablas. Export CSV/PDF es menor prioridad y queda pendiente en el corte inicial.

## Fixtures y verificación manual futura

Datos exclusivamente sintéticos con redes de documentación RFC 5737 y nombres `.invalid`. Fixture principal: Primary + dos Secondary, cliente activo/servidor inactivo, Age decimal, Gain inf/-nan, CacheHit=false, Details y Server.Address ausentes. Casos adicionales necesarios: reset, repetición idéntica, port reuse, gap, XML malformado, login HTML, fallback y cero válido. Fixtures no equivalen a validación ejecutada.

Cuando el usuario autorice: `cargo test --manifest-path src-tauri/Cargo.toml active_connections` y build/check habituales del proyecto; verificar manualmente mock, pause/resume/cancel, save/reopen sin red, cambio de scope, fecha/zona y estado de auth. Probar fallback con servidor controlado antes de appliance real; comprobar memoria con 16 MiB, interrupción durante body y decenas de miles de puntos. No se afirma compatibilidad Live probada en SGOS 7.4.4.2.

## Decisiones aplicadas y pendientes

Diseño aprobado por requisitos de esta conversación: sólo lectura, snapshots sin falsas tasas, rutas fijas, almacenamiento independiente, ausencia distinta de cero, códigos opacos y fixtures sintéticos. Se prioriza vertical Live/mock → parser → SQLite → timeline → página/detalle → Save/Load. El inventario final de implementación y límites se añade al terminar el corte; todo lo descrito como evolución/pendiente no debe confundirse con capacidad entregada.

## Inventario del corte implementado en este turno

Se añadieron `active_connections/{parser,store,mock,mod}.rs`, comandos `ac_*` registrados y estado backend administrado por Tauri. Se añadió dependencia directa `quick-xml` fijada a la versión 0.38.3 ya presente en Cargo.lock; sólo se agregó la referencia de dependencia del paquete, sin regenerar versiones. Parser de eventos con límites de 16 MiB, 32 niveles y 500.000 nodos; permite entidades XML estándar y numéricas, rechaza DTD y entidades personalizadas. Conserva atributos y nodos inesperados como árbol estructurado. No es un parser incremental hacia SQLite: el cuerpo y el árbol acotado se mantienen transitoriamente en memoria. El parseo y SQLite ocurren fuera del executor async.

La captura funciona en el backend con controles, cancelación HTTP/sleep, timeout y backoff; status IPC es un resumen, no XML. Ruta sticky y fallback limitado implementados. Guard global del **nuevo módulo** integrado en layout detiene una captura incompatible al cambiar proxy/perfil, sin modificar otros módulos de diagnóstico. Navegar sin otro proxy mantiene la captura en backend. Un único worker global impide solapamiento entre proxies. Stop conserva la captura en runtime y finaliza `ended`; Save es explícito y no detiene el worker. Iniciar otra captura sustituye el borrador en runtime; guardar antes si se quiere conservar en biblioteca. Borradores no guardados quedan en cache, no hay limpieza ni eliminación automática en este corte. Al cerrar el proceso se pierde el runtime, no se reanudan credenciales/capturas automáticamente.

SQLite v1 implementa captures, snapshots indexados temporalmente, metadata internada, dimensiones sessions/connections, estados deduplicados y observations por rangos; poll_errors separado. WAL y transacción por muestra. Una identidad ambigua usa una clave local por muestra y no comprime su pertenencia como si fuera identidad estable. Todos los puntos temporales exitosos o fallidos se conservan. La revisión de datos guardados es sólo lectura. Consultas limitadas a 500 puntos de timeline o 100 miembros (UI usa 200 y 50), offset paginado, búsqueda parametrizada, orden whitelist, interrupción SQLite y descarte frontend de resultados tardíos. Índices first/last de runs favorecen lectura actual; para historias enormes se necesita medir el costo de intersección de intervalos, todavía no benchmarkeado. Ranking cuenta miembros observados/Primary/tramos cliente activos del snapshot; deliberadamente no muestra bytes agregados engañosos.

UI implementada con componentes existentes: tarjeta en Diagnostics, página nueva, controles, estimación de tráfico, KPIs, gráfico ECharts con slider reutilizado y gaps, selección exacta, retorno live, zona compartida, DateTimePicker compartido, páginas históricas y biblioteca scoped. Tabla paginada de 50 filas con Primary/Secondary indentadas, expansión local por sesión, orden/búsqueda y filtros; no virtualización adicional (no se renderizan miles de filas). Una sesión puede cruzar páginas: S conserva la asociación. Drawer/modal de detalle muestra todos los campos conocidos con missing/empty explícitos y árbol completo para desconocidos. Diagnostics muestra metadatos enmascarados, discrepancias, skew calculable, duración de poll y límites de interpretación. El tooltip muestra el eje temporal de ECharts; las etiquetas, selección y fechas de inspección usan la zona elegida.

Mock determinista sin transporte: repite contenido cada dos ticks, baja contador en tick 8 (reset), cambia StartTime en tick 16 (port reuse), genera gap en ticks congruentes con 6 módulo 12 y cero válido en ticks congruentes con 10 módulo 20. DeviceTime fijo sintético: su skew no representa un appliance real. No hay credenciales/IPs/nombres de dispositivos reales en fixtures. Tests unitarios escritos para estructura, no finitos, repetición, reset, port reuse, ausencias, cero, discrepancia de totales, HTML, DTD y XML truncado. **No ejecutados.** Fallback/autenticación se implementan en el transporte, pero sus tests de integración con servidor controlado quedan pendientes.

Pendiente deliberado: tasas y detección explícita de resets, cierres/no-longer-observed y lifetime unique, agregados minuto/hora, codec diferencial por atributo/diccionarios finos, consultas de ocupación ponderadas por tiempo, CSV/PDF, selector de umbral configurable (filtro inicial fijo de 3600 s), distribución global agregada de códigos ICAP/Acceleration (raw por miembro sí disponible), prueba real de ambos endpoints y de formatos DeviceTime específicos, pruebas de gran escala/accesibilidad/visual, checks TypeScript/Rust y build. No se afirma que estos puntos estén terminados ni que el código compile sin feedback del usuario. `DeviceTime` sólo calcula skew si RFC3339 explícito; formatos distintos se conservan raw, sin asumir UTC silenciosamente. No se infiere inspección SSL, éxito ICAP, latencia ni causa de códigos desde snapshots.

### Ejemplo XML de contrato (sintético, no extracto del equipo)

```xml
<BlueCoatResponse>
  <Device Type="Synthetic" SerialNumber="SYNTHETIC-ONLY"
          Name="proxy.invalid" DeviceTime="2026-01-01T00:00:00Z">
    <Stats AccessPath="/AS/ProxiedConnections" Status="Current">
      <ProxiedConnections>
        <Session>
          <Connection Type="Primary" Error="0">
            <Gain Value="1.11" Savings="9.89"/>
            <Client Address="192.0.2.10" Port="51000" Bytes="2902" Active="1"/>
            <Server Address="" Port="0" Bytes="2615" Active="0"/>
            <Age Seconds="Active"/>
            <Acceleration ObjectCache="2" Latency="2" BandwidthManagement="0"/>
          </Connection>
          <Connection Type="Secondary" Error="0">
            <Gain Value="inf" Savings="-nan"/>
            <Age Seconds="124.25"/>
          </Connection>
        </Session>
        <Total DisplaySess="1" DisplayConn="2"/>
      </ProxiedConnections>
    </Stats>
  </Device>
</BlueCoatResponse>
```

Este fragmento evidencia el **contrato de jerarquía** y los casos que la implementación acepta, no una certificación de la muestra privada. La fixture completa agrega campos de identidad, otra Secondary y otra sesión. Los campos de identidad ausentes en este fragmento intencionalmente producirían identidades ambiguas. Se retienen campos inesperados de Session en metadatos por posición; cuando todas sus cáscaras están vacías se omiten de metadata, pues su orden y cardinalidad ya se conservan en observaciones y contadores parseados.

La cancelación descarta parseos tardíos; un `spawn_blocking` ya iniciado no se interrumpe a mitad del parser, pero su entrada, profundidad y número de nodos están acotados. El transporte puede usar más de un request secuencial para autenticar o intentar fallback; nunca hay polls concurrentes. Los resúmenes se **consultan** por IPC cada dos segundos (no se emite el árbol XML por evento). El timeline se reconsulta sólo cuando cambia la revisión de muestras o el rango. Errores históricos tienen selección propia debajo del gráfico, sin dibujar cero ficticio. Tooltips y etiquetas temporales usan la zona elegida.

Resume vuelve a leer las credenciales actuales de gestión mediante `getCredentials` en perfil Live y las sustituye sólo en memoria antes del próximo poll; mock no las lee ni las recibe. Un error de autenticación deja el worker pausado y requiere acción explícita, respetando el cooldown del transporte compartido. El intervalo es una espera mínima **después** de terminar el poll, por lo que el tráfico estimado por hora es orientativo y puede sobreestimar la cadencia real; no se solapan requests para alcanzar una frecuencia artificial. Abrir Inspect congela la selección inferior en el snapshot exacto para que el próximo poll no cierre/cambie el detalle mientras se está leyendo.

Pause agrega una anotación temporal `Paused` sin contadores mediante el mismo worker/SQLite, por lo que la línea no conecta a través del intervalo sin medición. Refresh estando pausado permite una sola muestra y agrega después otra anotación de pausa. No son errores del appliance ni muestras de cero. Además, el gráfico corta intervalos mayores a 2,5 veces el intervalo configurado con un punto gráfico null (ID -1, no seleccionable ni persistido): representa falta de resolución temporal, no una nueva observación del equipo. Esto cubre suspensión de la app y pausas largas aunque falte una respuesta fallida explícita.

## Cierre de implementación — revisión estática del turno de continuación

Se continuaron los mismos archivos sin reiniciar el trabajo ni reinstalar dependencias. Lectura estática acotada de parser/store/worker, props/imports, comandos `ac_*`, registro/estado Tauri, integración de ruta/guard y referencia directa de quick-xml en Cargo.toml/Cargo.lock. Se corrigieron: carrera Pause vs reemplazo del token de request (rechequeo bajo el mismo lock), controles sobre una captura ya detenida, resultados de consulta anteriores visibles al cambiar captura/rango (resultado asociado a su clave exacta) y apertura de escritura de capturas inexistentes (READ_WRITE sin CREATE; sólo la creación inicial crea ficheros).

**Implementado:** primera vertical Live/mock, endpoints fijos y fallback condicionado/sticky, controles/cancelación/backoff, separación scope proxy/perfil, guard al navegar, SQLite independiente con muestras/estados/rangos/metadatos/errores, Save explícito y Load mediante consultas read-only, timeline paginado con gaps, inspección exacta de miembros, filtros, rankings por snapshot y detalle raw. Save marca la misma base de captura para biblioteca: no genera una copia congelada; si sigue capturando, la base guardada continúa creciendo hasta Stop. No guarda credenciales ni XML original; los atributos observados de conexiones pueden contener direcciones del tráfico, y el serial de metadatos se enmascara. El ejemplo/mock del repositorio es exclusivamente sintético.

**Pendiente/no probado:** compilación Rust/TypeScript y runtime Tauri, autenticación/fallback reales SGOS y cancelación bajo carga, tests unitarios/integración, fidelidad visual, rendimiento de capturas grandes, exports CSV/PDF, agregados temporales, tasas/resets/cierres inferidos y métricas lifetime. Una consulta cancelada antes de registrarse en SQLite puede terminar igualmente; frontend descarta siempre su resultado tardío. Los errores de autenticación pausan; errores de red/XML quedan como gaps y usan backoff, sin sustituir datos faltantes por ceros. DeviceTime no RFC3339 permanece raw sin skew calculado. El formato mantiene un árbol acotado en memoria, no hace ingestión XML→SQL incremental.

No se ejecutaron tests, builds, typecheck ni pruebas contra appliances. Esta revisión es exclusivamente estática y no certifica compilación o funcionamiento. No se realizaron commits, push, cambios de rama, borrados ni migraciones de capturas existentes. Cierre del corte inicial, con límites explícitos para la prueba posterior del usuario.
