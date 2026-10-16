# Análisis del editor visual de Local Policy

Nota: este documento registra el diagnóstico anterior al refactor. El estado implementado y su cobertura se describen en [Local Policy Manager](local-policy-manager.md).

Fecha: 2026-10-16. Alcance: análisis de la policy de ejemplo, la descarga local de VPM y el editor actual. No se modificó el editor ni se ejecutaron conexiones o instalaciones sobre appliances durante este análisis.

## Decisión de arquitectura

**El CPL será la única fuente persistente de la política.** No habrá proyecto XML, archivo auxiliar de objetos ni una base de datos paralela necesaria para volver a editarla.

Al abrir o recibir la policy, el editor construirá en memoria una representación de su sintaxis, sus objetos y sus relaciones. Las operaciones visuales modificarán ese mismo CPL. Al volver a abrirlo, la vista se reconstruirá desde el contenido, incluyendo modificaciones realizadas por otras herramientas o usuarios.

El XML presente en la descarga se utilizó exclusivamente para analizar el VPM original. No se propone importarlo como formato de trabajo, escribirlo en el appliance ni incorporar sus archivos o código a la aplicación.

## Material examinado

- Policy CPL adjunta: 51.406 bytes con los saltos originales, 1.415 líneas.
- Descarga `PROXY VPM PAGE`: 24 archivos, aproximadamente 11 MB.
- Frontend VPM 2.2.2, identificado por su manifest, con referencias a SGOS 7.4.4.2 en la página contenedora.
- Captura de `show source policy vpm-xml`: estructura del proyecto, objetos y referencias entre celdas.
- Captura de `/config_classification.xml`: 240 registros de clasificación de objetos. Esto no equivale a una gramática completa de CPL ni a 240 formularios implementados en nuestro editor.
- Captura de `show xml-config concise`: configuración utilizada por VPM para ofrecer recursos del appliance. No se extrajeron ni publicaron valores internos.
- Código actual de `cplDocument`, `cplCatalog`, `cplVisualEditor`, `cplRuleComposer` y el controlador del workspace.

Se inspeccionaron los archivos estáticamente. No se ejecutó el JavaScript descargado ni se reprodujeron solicitudes contra el proxy. La descarga contiene metadatos de sesión y configuración reales; no debe incorporarse como fixture público o dependencia de la aplicación.

## Qué demuestra la policy real

La lectura con el parser actual identifica:

| Elemento | Cantidad |
| --- | ---: |
| Capas CPL | 28 |
| Capas Proxy | 22 |
| Capas SSL-Intercept | 3 |
| Capas SSL | 2 |
| Capas Cache | 1 |
| Reglas fuera de definiciones | 170 |
| Definiciones de condiciones | 16 |
| Filas no vacías ni comentadas en las definiciones | 1.038 |
| Entradas de `Office365IPs` | 793 |
| Nombres distintos de condiciones/propiedades, sin distinguir mayúsculas | 38 |
| Nombres presentes en el catálogo actual de sugerencias | 13 |

Estas cifras describen la muestra, no una certificación de validez por SGOS. Que el parser marque una regla como editable solo demuestra reconocimiento sintáctico parcial.

### Carencias concretas

1. **Origen no es solo una IP.** Hay usuarios, grupos, realms y combinaciones. `realm=AD group=...` debe poder editarse como identidad con su contexto, sin introducir manualmente dos gestos CPL.
2. **Destino no es solo un dominio.** La muestra tiene IPs IPv4/IPv6, subredes, fragmentos de hostname, paths, regex, categorías y atributos de certificados. Cada tipo necesita operadores y validaciones apropiados.
3. **Acción no es solo permitir o denegar.** Hay autenticación, detección de protocolo, interceptación TLS, selección de keyring, ICAP y excepciones; varias pueden coexistir en una regla. Algunas reglas no tienen una decisión allow/deny explícita.
4. **La lógica de objetos importa.** Las filas de una condición representan alternativas; las condiciones de una misma fila se combinan. También existen condiciones que referencian otras condiciones. Una lista de chips sin relaciones visibles resulta insuficiente.
5. **Los encabezados afectan a toda la capa.** `<Proxy> authenticate(no)` contiene una propiedad en el encabezado. Debe mostrarse como comportamiento de capa, separado de sus condiciones de entrada; no puede perderse ni convertirse silenciosamente en una regla independiente.
6. **Los comentarios son información operativa.** Hay secciones por aplicación, tickets, notas y reglas comentadas. No se deben descartar, reubicar por categorías ni activar al interpretar comentarios como reglas.
7. **Hace falta edición masiva de listas.** Agregar cientos de IPs o URLs mediante un formulario por expresión no es utilizable. Se necesita pegar listas, buscar, seleccionar y editar entradas, conservando orden y duplicados salvo petición explícita.
8. **Hay variantes que el parser no representa.** La línea `http.method=PUT authenticate (no) ALLOW` queda no editable por el espacio antes del paréntesis. Esto evidencia una limitación del parser; por sí solo no demuestra si esa variante es válida en el SGOS de destino. Debe preservarse y señalizarse, no normalizarse automáticamente.

Entre los nombres que no ofrece el catálogo actual están `group`, `realm`, `user`, `url.address`, `url.port`, `url.scheme`, `url.substring`, `url.host.substring`, `category`, las propiedades adicionales de autenticación, las opciones ICAP y el keyring TLS. Las expresiones importadas pueden aparecer en los controles genéricos, pero eso no aporta formularios semánticos ni validación específica.

## Cómo organiza el VPM de referencia

El XML capturado tiene 14 capas de proyecto, 134 reglas de tabla —117 habilitadas y 17 deshabilitadas— y 1.413 objetos de nivel superior. Entre esos objetos hay 136 combinaciones, 546 objetos IP, 266 objetos URL y 209 objetos de grupo. Es un proyecto distinto de la Local Policy adjunta; sus cifras no deben compararse como si fueran dos representaciones del mismo documento.

El frontend define 12 tipos de capas de reglas con columnas y objetos aplicables diferentes. Por ejemplo:

| Tipo visual | Columnas principales | Encabezado CPL |
| --- | --- | --- |
| Web Access | Origen, destino, servicio, tiempo, acción, seguimiento | Proxy |
| Web Authentication | Origen, destino, acción, seguimiento | Proxy |
| SSL Intercept | Origen, destino, servicio, acción, seguimiento | SSL-Intercept |
| SSL Access | Origen, destino, servicio, acción, seguimiento | SSL |
| Web Content | Destino, acción, seguimiento | Cache |
| Forwarding | Origen, destino, servicio, acción, seguimiento | Forward |

El comportamiento relevante no es el XML: son los **objetos tipados**, su aplicabilidad a una columna/capa, los formularios con campos y restricciones, las referencias reutilizables, las combinaciones y la generación de CPL. El bundle contiene schemas, validadores, controles especializados, condiciones negadas y métodos de generación por tipo de objeto.

La misma etiqueta `<Proxy>` puede representar distintas intenciones visuales. Por ello, al importar CPL sin metadatos no siempre se puede recuperar un nombre de capa, una intención única o la distribución original de objetos en las columnas del VPM. La interfaz debe mostrar lo que puede deducir con certeza, sin inventar una reconstrucción.

Broadcom distingue Local Policy de las fuentes VPM-CPL/VPM-XML. Nuestro objetivo seguirá siendo editar Local Policy, con una experiencia visual más completa, no alterar las fuentes de VPM. Véanse [Local Policy como fuente separada](https://knowledge.broadcom.com/external/article/176304) y [relación entre VPM-XML y VPM-CPL](https://knowledge.broadcom.com/external/article/170078/copying-visual-policy-manager-from-one-p.html).

## Diseño propuesto: operar con conceptos, no con gestos CPL

Mantener la inspección y la distribución encima del editor. Dentro del editor:

- Navegación compacta de capas con orden, tipo, cantidad de reglas y búsqueda. No agruparlas de una manera que cambie el orden de evaluación.
- Tabla virtualizada de reglas: **Estado | Origen | Destino | Servicio | Acción | Opciones | Comentario**. Tiempo o seguimiento pueden aparecer según el contexto o como columnas configurables.
- Cada celda abre un selector contextual de objetos existentes y permite crear uno sin salir de la regla.
- Panel de edición con campos comprensibles: tipo de identidad, realm, IP/subred, operador de coincidencia, dominios, categorías, etc. CPL disponible como vista avanzada y como vista previa del cambio.
- Biblioteca de objetos filtrable por tipo, con cantidad de usos y navegación a las referencias. Edición compartida y duplicación deben ser acciones explícitamente distintas.
- Editor de combinaciones que muestre **todas / cualquiera / no** y su agrupación, con previsualización de la expresión resultante.
- Listas extensas virtualizadas con pegado de múltiples líneas, edición de filas y diagnóstico de entradas sin reformatear toda la definición.

Una regla nueva habitual debe poder crearse completando cliente, destino y decisión. Las opciones avanzadas deben aparecer cuando hacen falta, sin exigir nombres como `client.address` al usuario.

### Ejemplos de presentación de la muestra

| Caso | Origen | Destino | Servicio | Acción / opciones |
| --- | --- | --- | --- | --- |
| Acceso FTP | Realm y condición de grupos existentes | Cualquiera | CONNECT, puerto 21 | Permitir; detección desactivada |
| Exclusión TLS de Office 365 | Cualquiera | Condición `Office365IPs` | Según la capa | No interceptar |
| Autenticación de una aplicación | Condición existente, si aplica | Condición de URLs existente | Según la regla | Autenticar con realm; opciones de modo y forzado |
| Excepción de contenido | Condiciones existentes | Categorías/URLs existentes | Según la regla | Excepción específica, sin inventar un deny adicional |

Estas celdas son una proyección del CPL. El texto generado debe conservar los nombres, expresiones y referencias de origen cuando no se modifican.

## Límites que el diseño debe representar expresamente

### No romper combinaciones al repartirlas en columnas

Una condición con esta estructura:

`(cliente A Y destino X) O (cliente B Y destino Y)`

no equivale a:

`(cliente A O cliente B) Y (destino X O destino Y)`.

En el primer caso, la interfaz debe conservar la relación como condición compuesta vinculada y mostrar el árbol, aunque no pueda repartirla en dos celdas independientes. Mostrar un resumen compacto está bien; convertirlo a dos listas independientes cambia la política.

En la muestra, `Spotify_OK` referencia dos condiciones en filas diferentes. Debe representarse como alternativas, no asumir que ambos requisitos se deben cumplir ni corregirlo automáticamente según el nombre del objeto. [Los ejemplos oficiales](https://knowledge.broadcom.com/external/article/166537) ilustran condiciones alternativas; [este ejemplo de origen y destino](https://knowledge.broadcom.com/external/article/167283/what-is-the-cpl-to-blockdeny-certain-cli.html) muestra condiciones conjuntas en una regla.

### Distinguir interpretación de validez

Cada elemento necesita un estado de capacidad:

1. **Reconocido y editable con formulario específico.**
2. **Composición parcialmente reconocida.** Se puede editar una parte únicamente si se puede preservar exactamente el resto y su relación lógica.
3. **CPL conservado.** Visible con localización y explicación; edición avanzada disponible, sin presentarlo como configuración entendida o inválida.

El catálogo visual no sustituye al compilador. Los formularios pueden validar sintaxis y tipos conocidos; las dependencias de versión, recursos del appliance y restricciones de momento de evaluación requieren información adicional. La compilación del flujo actual sucede al aplicar la policy, no es una prueba sin efectos. No se debe inventar un modo dry-run que no esté documentado y validado.

La captura identifica SGOS 7.4.4.2 y la guía inicial se refería a 7.3. Hay que registrar y comprobar esas diferencias al incorporar capacidades, sin asumir que una versión sirve como gramática exhaustiva de la otra.

## Implementación necesaria, sin XML ni archivos auxiliares

1. **Parser que preserve el texto y modelo semántico en memoria.** Conservar comentarios, espacios, saltos, mayúsculas, orden y rangos de origen. No convertir la policy completa a un formato normalizado al guardarla.
2. **Índice de símbolos y dependencias.** Definiciones, referencias directas/transitivas, nombres ambiguos o duplicados y ciclos. Una referencia no resuelta localmente no se elimina: puede requerir comprobar otras fuentes del appliance. Renombrar o eliminar objetos debe considerar sus usos.
3. **Catálogo tipado de capacidades.** Familia, operadores, valores, formulario, restricciones por capa y versión y generación de la expresión. La captura sirve para identificar conceptos; no se incorporará el bundle del fabricante ni se dependerá de sus clases internas.
4. **Proyección reversible.** Cada cambio visual modifica solo los rangos implicados. Los objetos creados se escriben como definiciones CPL normales y se referencian por nombre. No se necesita una identidad persistida fuera de la policy.
5. **Interfaz de tabla y selectores especializados.** Reutilizar componentes compartidos, virtualización y flujo existente de revisión/distribución. La vista de texto sigue siendo opcional.

Nombres amigables o secciones pueden derivarse de identificadores y comentarios existentes. No se deben insertar marcadores obligatorios ni metadatos propietarios ocultos para que el archivo sea editable. Si una acción explícita agrega un comentario, debe verse en el diff y permanecer como comentario CPL ordinario.

## Criterios de aceptación antes de considerarlo un editor visual completo

- Abrir la muestra y exportarla sin cambios conserva los bytes del documento fuente. El transporte SSH se valida por separado con sus limitaciones de saltos de línea conocidas.
- Cambiar una IP, URL, grupo o decisión solo modifica esa parte del CPL; mantiene comentarios, acciones adicionales y orden.
- Crear una regla cliente/destino/decisión no requiere conocer nombres de gestos CPL.
- Editar una lista de cientos o miles de entradas no obliga a abrir un modal por cada expresión ni renderiza todas las filas.
- Las alternativas, conjunciones y negaciones conservan exactamente su agrupación al importar, editar y generar.
- Editar un objeto compartido muestra qué reglas cambiarán; duplicarlo no altera otros usos.
- La propiedad de capa de la muestra sigue aplicada a su capa tras una edición no relacionada.
- Elementos no soportados siguen visibles y conservados; no se borran ni se habilitan silenciosamente.
- Se prueban autenticación, SSL, ICAP, excepciones, listas IPv6, categorías, encabezados, condiciones anidadas y cambios hechos manualmente fuera de la aplicación.
- Se mantienen revisión del reemplazo, exclusión de discrepancias y comprobaciones de concurrencia de ambos métodos de distribución.
- No existe requisito de cargar o guardar XML o un proyecto auxiliar para volver a editar el CPL.

## Conclusión

El editor actual es un constructor de expresiones con controles visuales, no una alternativa funcionalmente comparable al VPM. Agregar más entradas al desplegable o cambiar el estilo de las cards no corrige esa diferencia. La mejora requiere un modelo semántico derivado del CPL y una interacción basada en objetos, columnas y formularios específicos, manteniendo el código existente que conserva el texto y controla la distribución cuando sea reutilizable.
