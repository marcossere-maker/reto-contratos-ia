# Verificación de la entrega

- `npm run check`: TypeScript sin errores.
- `npm test`: 11 pruebas aprobadas. Cubren seis casos, correo corrupto, revisión humana, intento de alterar valores, confirmación de un solo uso, idempotencia, ciclo con adaptador de prueba, restauración entre instancias, presentación de resultados y orquestación del lote con dos llamadas al modelo.
- `npm run build`: compilación correcta.
- `npm run demo`: dos nuevos, una actualización, un duplicado, un rechazo y un nuevo pendiente. Segunda pasada con confirmación simulada: registro del contrato marco. Alertas finales: 2 vencimientos, 4 pólizas pendientes y 4 registros desde el corte.
- Navegador: se comprobó el flujo de seis mensajes y la revisión de fechas antes del registro confirmado.
- HTTP sobre la versión compilada: health, procesamiento con 19 tool calls, confirmación, historial de cuatro mensajes, descarga del reporte y reinicio de datos ficticios correctos.
- `.env`, `out`, `node_modules` y `dist` excluidos del repositorio y del ZIP de entrega.

## Evidencia histórica de la versión previa

- Qwen real verificado: `qwen/qwen3.8-27b` en Groq respondió correctamente, procesó los seis correos mediante herramientas y produjo el resumen con confirmación pendiente. La confirmación del operador completó el sexto caso. Una ejecución del lote consumió 4.354 tokens en total. La clave se configuró cifrada en Vercel y está excluida de los archivos entregables.
- Prueba sobre la URL pública con Groq activo: `PUBLIC_GROQ_OK`, 4.032 tokens, 5 llamadas de herramientas para el correo todavía pendiente, respuesta en español y confirmación requerida. Se conservaron los 10 contratos y los 5 correos procesados previos; no se confirmó ni registró el caso dudoso en producción.
- Vercel: URL pública https://reto-contratos-ia.vercel.app. Se retiró la protección exclusivamente de este proyecto, después de la aprobación explícita del candidato. Se probó el flujo completo desde el enlace sin autenticación, incluida revisión, confirmación y descargas. Resultado: 11 contratos, 6 mensajes procesados y 1 sesión, revisión 5.
- Vertex AI, Bedrock, buzón real, PDF/OCR y SharePoint: diseño o trabajo futuro, no integraciones implementadas.

## Persistencia real en Supabase

- Proyecto separado en organización Free, sin reutilizar tablas de otras apps.
- Ejecución contra Postgres real: 11 contratos y una sesión con cuatro mensajes, confirmados en revisión 2 del estado.
- Se recuperó la confirmación pendiente en una instancia nueva y se completó el registro.
- RLS: clave publicable sola y token incorrecto no permiten leer ni modificar el estado.
- Concurrencia: el segundo intento de adquirir el lease fue rechazado mientras otra operación lo poseía.
- Asesor de seguridad de Supabase: sin avisos en el proyecto del reto.
- Persistencia después de una nueva publicación en Vercel: la API pública conservó revisión 5, 11 contratos, 6 mensajes procesados y 1 sesión. Comprobación `REDEPLOY_PERSISTENCE_OK`.

## Revisión de seguridad del 06/11/2026

- Suite ampliada: 11/11 pruebas aprobadas, incluyendo dos visitantes aislados, rechazo de confirmación ajena, reset limitado al propietario, descargas sin cookie rechazadas, firma y expiración, CSRF, 404, cabeceras ante JSON inválido, CSV malicioso y cuota 429.
- Migración `reto02_isolated_visitors_and_shared_limits` aplicada al proyecto separado; snapshot anterior conservado.
- Asesor de seguridad de Supabase después de la migración: sin avisos.

- Publicación `dpl_rXoGfBc2ophFPfvEipCAPqTNtVBR`, código `057004f`: READY y alias público actualizado.
- `PUBLIC_VISITOR_SECURITY_OK`: Groq/Qwen real, 4.177 tokens y 20 llamadas (19 operaciones internas y la coordinación del lote); 10 contratos, 5 mensajes procesados y msg-006 pendiente.
- Dos espacios nuevos en Supabase: sesión y confirmación ajenas devuelven 404, reset B conserva los 5 mensajes procesados de A, y la confirmación pendiente se recupera desde la base. Solo se reinició el espacio B creado por la prueba.
- En la URL pública: descargas sin cookie 401, rutas inexistentes y sensibles 404, CSP y X-Frame-Options en HTML y JS, CORS restringido, JSON inválido 400 con cabeceras, POST de otro origen 403 y cuota compartida 429.

- `LIVE_RLS_OK`: contra la API real de Supabase, clave publicable y token inventado no leen estado, vistas ni cuotas; tampoco crean un espacio con hash inventado ni ejecutan RPC de inicialización o cuotas.
