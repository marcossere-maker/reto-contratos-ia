# Registro de Contratos · Periferia

Aplicación del reto 02: chat, ciclo de agente con herramientas, extracción determinista, revisión humana, maestro CSV, archivo simulado y alertas. Datos ficticios; no conecta con un correo ni SharePoint real.

## Probar en local

Requiere Node 24 (compatible con Node 22 reciente) y npm. Desde esta carpeta:

```sh
npm ci
npm run dev
```

Abrir http://localhost:3000. Sin configurar variables, arranca en **práctica guiada sin IA**, identificada claramente en la interfaz. Ese flujo permite ensayar todo el proceso pero no verifica Qwen.

Para conectar el modelo real, copiar `.env.example` como `.env` y completar `LLM_API_KEY` con la clave de **Groq**. Los proyectos previos del candidato usan Qwen vía Groq; se eligió `qwen/qwen3.8-27b`. Reiniciar el servidor. No compartir la clave ni incorporarla al repositorio.

```dotenv
LLM_PROVIDER=groq
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=qwen/qwen3.8-27b
LLM_API_KEY=tu_clave_solo_en_el_archivo_local
```

También admite Alibaba Model Studio: `LLM_PROVIDER=qwen`, `LLM_MODEL=qwen3.5-plus` y la URL compatible exacta de la región/workspace de la cuenta. La clave debe corresponder a ese proveedor. El adaptador ajusta las opciones de razonamiento según el endpoint.

`npm run check` verifica TypeScript; `npm test` verifica los escenarios; `npm run build && npm start` ejecuta el compilado. `npm run demo` corre las herramientas sin proveedor y **borra previamente solo la carpeta out de este proyecto**. No ejecutar la demo mientras se usa la app: ambas comparten la copia operativa. Una conversación nueva conserva el maestro; para repetir desde cero, detener el servidor, ejecutar la demo o eliminar únicamente `out/`, y volver a iniciar.

## Guion de defensa

1. Empezar desde fixtures limpios y pulsar “Procesar los 6 mensajes”.
2. Mostrar nuevos, otrosí, duplicado y rechazo; abrir el detalle de alguna herramienta para explicar la trazabilidad.
3. Mostrar `msg-006`: valor indeterminado y día de firma ausente. El correo no prueba la fecha de firma. El remitente desconocido es una observación, no un bloqueo adicional.
4. Como **supuesto confirmado por el operador solo para la demo**, ingresar valor `0`, inicio `2026-08-31` y fin `2027-08-31`. Pulsar la confirmación expresa. No representar estas fechas como extraídas del contrato.
5. Descargar alertas y explicar la póliza condicional del contrato marco. El reporte usa 2026-09-03 para reproducir el ejemplo del PRD.

## API

- `POST /api/chat`: `{sessionId?: uuid, message: string}` → `{sessionId, reply, toolCalls, needsConfirmation, pending, tokens}`.
- Confirmación, únicamente en el turno siguiente: agregar `confirmation: {token, values: {valor, fecha_inicio, fecha_fin}}`. El token lo entrega `pending`; se consume y no puede reutilizarse. El backend autoriza el registro, no el modelo.
- `GET /api/sessions/:id`: historial visible y revisiones de esa sesión.
- `GET /api/health`: proveedor, modelo y estado de configuración; nunca devuelve credenciales.
- `GET /api/report`: descarga el último `alertas.md`.

Sesiones y límites de gasto viven en memoria. Hay un único escritor HTTP por proceso para proteger el CSV. No escalar a varias instancias sin cambiar persistencia y coordinación. Cada herramienta retorna un string JSON `{ok,data}` o `{ok:false,error}`, con argumentos zod. Las herramientas son importables sin servidor.

## Publicar en Render

El archivo `render.yaml` configura un servicio gratuito. Subir este proyecto a un repositorio Git propio, conectar ese repositorio en Render y crear un Blueprint. Definir allí `LLM_API_KEY` y `LLM_BASE_URL` como variables del backend. Build: `npm ci && npm run build`; inicio: `npm start`; health: `/api/health`.

**URL pública: pendiente de crear el servicio en la cuenta del candidato.** La app local y el modo real son independientes del proveedor de hosting.

Render gratuito pierde los archivos generados al reiniciar o suspenderse; el maestro se reconstruye a partir de fixtures. Abrir el servicio y comprobarlo antes de la defensa. No usar para datos reales. Vercel requiere un almacenamiento externo y sesiones persistidas; Sites requiere adaptar el servidor a Workers y D1/R2. Ninguna de esas migraciones está implementada.

## Entrega y protección de secretos

Entregar Git o ZIP con código, fixtures originales, README, SOLUCION y lockfile. Excluir `.env`, `node_modules`, `dist` y `out`. Los originales adjuntos se mantienen intactos. El log del backend registra herramienta, mensaje, resultado y resumen sin la clave. Variables: `MAX_ITERATIONS` (25), `MAX_SESSION_TOKENS` (150000), `MAX_DAILY_TOKENS` (1000000), `LLM_TIMEOUT_MS` (45000), `PORT` (3000).
