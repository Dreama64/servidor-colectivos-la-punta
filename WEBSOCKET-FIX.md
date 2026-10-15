# Corrección de presencia WebSocket — 15 de octubre de 2026

## Hallazgo comprobado

En App.js, el cleanup del efecto inicial llamaba a close(), pero onclose siempre
programaba comprobarYReconectar() tres segundos después. El temporizador no se
guardaba ni cancelaba y no había comprobación de montaje antes/después de leer
AsyncStorage. Una instancia desmontada podía abrir otro socket con su propia
referencia ws. El guard OPEN/CONNECTING solo protege una instancia; no protege
contra otra instancia montada después. Con enCanalRef=true, el socket huérfano
vuelve a enviar join_channel y permanece realmente vivo. Ping/pong no lo elimina.

La prueba de regresión sobre la copia previa falla con 2 sockets creados donde
debe existir 1; pasa sobre la corrección. Esto reproduce un defecto concreto del
código. No se han capturado logs de los dos teléfonos: no se afirma que todos los
duplicados históricos procedan exclusivamente de este recorrido. Minimizar la
app no equivale a desmontar React; no se atribuye ese evento al Honor sin evidencia.

Los callbacks también dependían de ws.current y de nombres capturados. La lista
descartaba todos los usuarios con el mismo nombre propio y no validaba la sala.
Si existían varias sesiones con nombres repetidos, cada teléfono podía ocultar
cantidades distintas. El servidor identificaba sesiones solo por objeto socket:
no podía reconocer la reconexión de la misma instalación. General podía acumular
sesiones anteriores; no hay una regla especial de presencia para ese canal en
el código actual. No se ha demostrado por qué ese canal concentró el síntoma real.

## Cambios

- App: cancela el temporizador, desactiva callbacks y cierra su socket al desmontar;
  impide aperturas después de lecturas pendientes y limita la reconexión a un timer.
- Cada callback comprueba que pertenece al socket actual y usa ese socket.
- Conserva enCanalRef y canalActivoRef locales previos: reconectar restaura solo
  el canal deseado; SALIR impide volver a entrar automáticamente.
- Asigna un clienteId persistente por instalación, independiente del nombre.
  Filtra la entrada propia por ese ID, con compatibilidad por nombre para servidor
  antiguo, y descarta listas de otra sala. No deduplica los demás usuarios en UI.
- Servidor: al recibir join_channel con el mismo clienteId elimina la sesión previa
  del registro y cierra su conexión con código 4001; fuerza el cierre tras un segundo
  si no completa el handshake. Actualiza las salas afectadas. La app reemplazada
  no reintenta tras 4001. Mensajes tardíos de sockets retirados no se procesan.
- Dos instalaciones distintas con el mismo nombre siguen siendo válidas.
  Clientes antiguos sin clienteId siguen funcionando, pero no permiten reemplazo
  por instalación. El ID distingue instalaciones; no es autenticación.
- No se cambió servicio nativo, configuración MagicOS, grabación, reproducción,
  endpoints ni mecanismo de correo. Se evita enviar chat con socket no abierto
  y reproducir una notificación de audio después de SALIR.

## Validación

En cada repositorio: `node --test tests/websocket.test.cjs`.

App: seis pruebas sobre el código funcional real extraído de App.js, con hooks,
WebSocket y timers controlados. El parser revisa el App.js completo, incluido JSX.
Cubren desmontaje, trabajos pendientes, concurrencia, restauración/salida, identidad
tras reinicio/renombre, eventos obsoletos y cierre 4001 sin reconexión en bucle.

Servidor: integración del server.js completo con HTTP y WebSockets reales en un
puerto local efímero y archivos temporales. Cubre join repetido, reemplazo real,
mismo nombre en teléfonos distintos, cambio de sala, renombre, chat una sola vez,
subida/notificación de audio por canal, salida/reingreso, desconexión y compatibilidad
con clientes anteriores. Verifica /report con correo deshabilitado; no envía correos.
El audio de prueba es un archivo ficticio: valida transporte, no calidad/reproducción.

También: `node --check server.js` y `git diff --check` en ambos repositorios.
No se compiló APK ni se probaron micrófono, reproducción, MagicOS o correo real.
No hubo push ni despliegue. La validación final requiere ambos teléfonos actualizados.

## Prueba real para la demo

1. Publicar primero el servidor revisado y actualizar la app en AMBOS teléfonos.
   Cerrar versiones/sesiones anteriores de prueba, incluidas sesiones de desarrollo.
   Las sesiones antiguas sin ID no se pueden asociar con seguridad a un teléfono.
   Conservar los permisos MagicOS actuales del Honor.
2. Iniciar Juan Soto y Andrés Cruz. Antes de elegir canal no deben figurar como
   miembros. Entrar ambos a General: ambos deben ver exactamente 2 y los mismos nombres.
3. Enviar chat y PTT en ambas direcciones: una recepción por envío. Minimizar Honor
   y bloquear pantalla durante varios minutos: verificar PTT entrante y luego volver;
   ambos deben seguir viendo 2, sin crecimiento. Repetir al menos cinco veces.
4. Desactivar red en un teléfono hasta observar desconexión; el otro debe perder
   esa presencia al cerrar el transporte o vencer el heartbeat (aprox. hasta 60 s).
   Reactivar red: se restaura General una vez y ambos vuelven a 2. Repetir cinco veces.
5. SALIR en Juan: Andrés ve 1 y Juan queda en hub. Cortar/reactivar red en Juan:
   no debe volver a General. Entrar Juan a Canal 1: cada sala tiene 1; no debe haber
   audio/chat cruzado. Entrar Andrés a Canal 1: ambos ven 2. Volver a General mediante
   SALIR y selector, y comprobar otra vez 2 y mensajes/audio sin duplicación.
6. Cambiar nombre desde configuración y volver a un canal: el nombre anterior no
   debe persistir. Cerrar/reabrir la app repetidamente y repetir la comprobación.
   Probar un reporte real solo con conocimiento de que enviará el correo habitual.

## Recuperación y preservación

Commits separados por repositorio; revertir el commit de esta corrección en cada
uno para volver atrás sin reset ni borrar archivos. Si se publicó, desplegar luego
ese revert y reinstalar la versión correspondiente. Coordinar app/servidor.

La corrección de App.js incluye y conserva el trabajo local deliberado previo de
enCanalRef/restauración de canal. Revertir el commit completo también lo retiraría;
para recuperarlo existe App.before.js y app-local-before.patch en la carpeta
safety-websocket-20261015 del proyecto de esta conversación. No aplicar el parche
completo a ciegas: también contiene los cambios locales de assets/package-lock.

Se conservaron ramas de respaldo y archivos ajenos; leave-channel.patch no se
editó ni se incluyó. Los assets, package-lock, .bak y módulo backup siguen fuera
de los commits. El estado sucio restante es intencional y anterior a esta tarea.
