# Verificación de la entrega

- `npm run check`: TypeScript sin errores.
- `npm test`: 5 pruebas aprobadas. Cubren seis casos, correo corrupto, revisión humana, intento de alterar valores, confirmación de un solo uso, idempotencia y ciclo con adaptador de prueba.
- `npm run build`: compilación correcta.
- `npm run demo`: dos nuevos, una actualización, un duplicado, un rechazo y un nuevo pendiente. Segunda pasada con confirmación simulada: registro del contrato marco. Alertas finales: 2 vencimientos, 4 pólizas pendientes y 4 registros desde el corte.
- Navegador: se comprobó el flujo de seis mensajes y la revisión de fechas antes del registro confirmado.
- HTTP sobre la versión compilada: health, procesamiento con 19 tool calls, confirmación, historial de cuatro mensajes, descarga del reporte y reinicio de datos ficticios correctos.
- `.env`, `out`, `node_modules` y `dist` excluidos del repositorio y del ZIP de entrega.

## Verificaciones pendientes

- Llamada real a Qwen: no había clave de Groq disponible en el entorno ni en los archivos locales de los proyectos consultados. No se simuló esa verificación ni se afirma que haya pasado.
- Enlace público: Render mostró la pantalla de acceso; no se creó un servicio ni una URL pública. Se entrega la configuración de despliegue y la app local.
- Vertex AI, Bedrock, buzón real, PDF/OCR y SharePoint: diseño o trabajo futuro, no integraciones implementadas.
