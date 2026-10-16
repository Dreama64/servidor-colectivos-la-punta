# Presencia global experimental

Base app: e8cffe45b3a88adc0233279853a55cb0ac12c786.
Base servidor: c6b56c30e89b5f9f825288c67643ac020c45740e.
Rama en cada repositorio: experiment/global-presence. Sin push ni despliegue.

## Protocolo

Cliente -> servidor al abrir el socket desde el hub:
`{"type":"registrar_usuario","emisor":"Juan","clienteId":"id-persistente"}`.
Requiere nombre e ID no vacíos. No une a ningún canal. Repetir el registro
actualiza el nombre y conserva el canal del mismo socket. Al reconectar dentro
de un canal se mantiene el join_channel original, que también publica presencia.

Servidor -> sesiones identificadas, snapshot completo:
`{"type":"lista_usuarios_global","usuarios":[{"nombre":"Juan","clienteId":"id-persistente","sala":null}]}`.
Se emite después de registro, join/cambio de canal, leave y close.
El registro comparte exactamente la sustitución por instalación de c6b56c3:
elimina el socket anterior del mapa antes de cerrar con 4001; su cierre tardío
no elimina la sesión nueva. Solo se incluyen sockets OPEN con nombre.
lista_usuarios conserva su semántica por canal.

## Hub y compatibilidad

Debajo de Generar reporte, incluye al propio operador y a las demás instalaciones.
Sala null se presenta como Sin canal. El contador cuenta sesiones/instalaciones,
no nombres únicos. Dos teléfonos con igual nombre siguen siendo dos operadores.
No se deduplican nombres en UI. Conexiones anónimas no aparecen.
Clientes antiguos aparecen después de join; sin ID no es posible identificar
reconexiones como una misma instalación, igual que en el servidor base.
El ID es identidad de instalación, no autenticación.

Lista vacía: Sin operadores conectados. Antes del primer snapshot, con servidor
anterior o después de perder conexión: Presencia no disponible. Los datos se
limpian al cerrar el socket. Un corte silencioso se detecta con el heartbeat
existente (aproximadamente hasta 60 s); no se alteraron tiempos ni lifecycle.
El área de acciones del hub permite desplazamiento para listas largas y
pantallas pequeñas. Estilos nuevos usan la conversión claro/oscuro existente.

## Validación realizada

node --test tests/*.test.cjs en ambos repositorios: 23/23 pruebas en total.
App 21: FIFO 4; theme 6; websocket/background 9 existentes y 2 nuevas.
Servidor 2 integraciones reales: suite anterior (chat, audio, presencia por
canal, reemplazo, compatibilidad y report sin correo) y suite global nueva
(registro, sin canal, registro inválido, repetición, cambio de canal, renombre,
leave, reemplazo desde hub y desde canal, no duplicados y cierre normal/abrupto).
Las pruebas nuevas de app ejercitan el handler real, aislamiento por canal,
actualización, limpieza, sockets obsoletos y JSX real del hub: filas, orden,
contador, vacío y no disponible. El render es con elementos simulados, no una
prueba visual en teléfono.
node --check server.js y git diff --check en ambos: correctos.
Comparación contra base: 23 funciones de app sin cambios, excepto la función
de conexión WebSocket ampliada; pttQueue.js, modules/, app.json, package.json y
package-lock.json intactos. Heartbeat y endpoints del servidor intactos.
Sin prueba física nueva, sin APK, sin push, merge ni despliegue.

## Prueba manual pendiente antes de usar en demo

1. Con servidor experimental en entorno de prueba y dos apps actualizadas,
   abrir ambos hubs: dos nombres con Sin canal, sin iniciar servicio de radio.
2. Entrar a General y Canal 1: verificar canal global correcto y miembros
   correctos de cada sala. SALIR deja al operador visible como Sin canal.
3. Renombrar y reconectar misma instalación: una sola fila, sin nombre viejo.
   Dos instalaciones con el mismo nombre deben mantener dos filas.
4. Cerrar app/cortar red: desaparece al cerrar transporte o vencer heartbeat.
   Recuperar red: una fila; desde hub no se une automáticamente a canal.
5. Probar temas claro/oscuro, lista larga y pantalla pequeña.
6. Repetir la prueba física PTT en ambos sentidos, ráfaga FIFO y audio de 30 s
   con Xiaomi bloqueado/en segundo plano. Verificar que salir detiene servicio.

## Llevar el commit a C:\dev\colectivos

No aplicar sobre main ni sobre un checkout sucio. Revisar git status primero.
Desde C:\dev\colectivos, hacer fetch LOCAL de la copia presence-app de este
proyecto y su rama experiment/global-presence. Crear una rama nueva desde
e8cffe45b3a88adc0233279853a55cb0ac12c786 y aplicar solo el commit experimental
con cherry-pick. Revisar diff; compilar con el procedimiento Android habitual
del proyecto. No copiar App.js ni assets a mano. El checkout entregado no tiene
android/. La app requiere la extensión del servidor para mostrar presencia.
No se ha autorizado/publicado ningún servidor como parte de esta tarea.
Para descartar el experimento basta volver a las ramas previas; conservar los
commits probados. No hacer reset del trabajo local.
