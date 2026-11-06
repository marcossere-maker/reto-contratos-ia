# Verificación de la entrega

- `npm run check`: TypeScript sin errores.
- `npm test`: 8 pruebas aprobadas. Cubren seis casos, correo corrupto, revisión humana, intento de alterar valores, confirmación de un solo uso, idempotencia, ciclo con adaptador de prueba, restauración entre instancias, presentación de resultados y orquestación del lote con dos llamadas al modelo.
- `npm run build`: compilación correcta.
- `npm run demo`: dos nuevos, una actualización, un duplicado, un rechazo y un nuevo pendiente. Segunda pasada con confirmación simulada: registro del contrato marco. Alertas finales: 2 vencimientos, 4 pólizas pendientes y 4 registros desde el corte.
- Navegador: se comprobó el flujo de seis mensajes y la revisión de fechas antes del registro confirmado.
- HTTP sobre la versión compilada: health, procesamiento con 19 tool calls, confirmación, historial de cuatro mensajes, descarga del reporte y reinicio de datos ficticios correctos.
- `.env`, `out`, `node_modules` y `dist` excluidos del repositorio y del ZIP de entrega.

## Verificaciones pendientes

- Qwen real verificado: `qwen/qwen3.8-27b` en Groq respondió correctamente, procesó los seis correos mediante herramientas y produjo el resumen con confirmación pendiente. La confirmación del operador completó el sexto caso. Una ejecución del lote consumió 4.354 tokens en total. La clave se configuró cifrada en Vercel y está excluida de los archivos entregables.
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
