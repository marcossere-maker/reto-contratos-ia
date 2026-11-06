# Registro de Contratos · Periferia

Aplicación del reto 02: chat, ciclo de agente con herramientas, extracción determinista, revisión humana, maestro CSV, archivo simulado y alertas. Datos ficticios; no conecta con un correo ni SharePoint real.

**Demo pública:** https://reto-contratos-ia.vercel.app · Qwen real vía Groq · persistencia en Supabase.

**Explicación para la entrega:** [PDF con propuesta, controles y revisión de seguridad](docs/Explicacion_Reto_02_Contratos.pdf).

**Repositorio público:** https://github.com/marcossere-maker/reto-contratos-ia

Las credenciales se configuran únicamente en el backend. Este repositorio contiene `.env.example` con valores de ejemplo y campos vacíos; el archivo `.env` y los datos generados están excluidos. Para ejecutar tu propia copia, usá tus claves y tu entorno de datos.

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

`npm run check` verifica TypeScript; `npm test` verifica los escenarios; `npm run build && npm start` ejecuta el compilado. `npm run demo` corre las herramientas sin proveedor y **borra previamente solo la carpeta out de este proyecto**. La app web usa un directorio separado por visitante; `demo.ts` conserva su salida inspeccionable en `out/`. Una conversación nueva conserva el maestro de tu espacio. Para repetir la app desde cero, usar el botón de reinicio de datos de prueba.

## Guion de defensa

1. Empezar desde fixtures limpios y pulsar “Procesar los 6 mensajes”.
2. Mostrar nuevos, otrosí, duplicado y rechazo; abrir el detalle de alguna herramienta para explicar la trazabilidad.
3. Mostrar `msg-006`: valor indeterminado y día de firma ausente. El correo no prueba la fecha de firma. El remitente desconocido es una observación, no un bloqueo adicional.
4. Como **supuesto confirmado por el operador solo para la demo**, ingresar valor `0`, inicio `2026-08-31` y fin `2027-08-31`. Pulsar la confirmación expresa. No representar estas fechas como extraídas del contrato.
5. Descargar alertas y explicar la póliza condicional del contrato marco. El reporte usa 2026-09-03 para reproducir el ejemplo del PRD.

## API

- `POST /api/visitor`: inicia el espacio y emite la cookie HttpOnly firmada. Las otras rutas de datos requieren esa cookie.
- `POST /api/chat`: `{sessionId?: uuid, message: string}` → `{sessionId, reply, toolCalls, needsConfirmation, pending, tokens}`.
- Confirmación, únicamente en el turno siguiente: agregar `confirmation: {token, values: {valor, fecha_inicio, fecha_fin}}`. El token lo entrega `pending`; se consume y no puede reutilizarse. El backend autoriza el registro, no el modelo.
- `GET /api/sessions/:id`: historial visible y revisiones de esa sesión.
- `GET /api/health`: solo `{ok:true}`; la configuración visible del modelo se entrega al iniciar la demo.
- `GET /api/report`: descarga el último `alertas.md`.
- `POST /api/demo/reset`: `{confirm:"reiniciar-datos-ficticios"}` restaura los datos de prueba y vacía las conversaciones. El botón pide confirmación; afecta solo al espacio del visitante. No reinicia el límite diario de tokens.

En local, sesiones y límites viven en memoria y una cola serializa la escritura del CSV. En Vercel, Supabase conserva el estado y coordina las escrituras entre instancias mediante un lease y control de versión. Cada herramienta retorna un string JSON `{ok,data}` o `{ok:false,error}`, con argumentos zod. Las herramientas son importables sin servidor.

## Despliegue en Vercel + Supabase

Proyecto Vercel: `reto-contratos-ia`. **Enlace público: https://reto-contratos-ia.vercel.app**. La protección se retiró solo de esta demo tras aprobación explícita. Proyecto Supabase separado: `reto-contratos-ia` (`orlwzamtsmirpzsrmalv`), organización Free del candidato.

`vercel.json` publica los archivos web y una función Node con las rutas API. `src/local.ts` conserva el arranque local; la función importa Express sin abrir un puerto.

Variables de Vercel: `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `STORAGE_ACCESS_TOKEN` cifrado. El token está restringido por RLS al estado del reto; no es una clave service_role. La UI no recibe este secreto. Para Qwen agregar además las variables LLM, con la clave cifrada en el backend.

La tabla `reto02_state` guarda el estado completo: maestro, documentos, auditoría, correos procesados, conversaciones, confirmaciones y consumo. Las vistas `reto02_contracts` y `reto02_documents` facilitan inspección SQL. Cada turno recupera ese estado en un directorio temporal y confirma la nueva versión en Postgres antes de responder. Una publicación o reinicio no borra la base. El botón de reinicio sí restaura deliberadamente los datos ficticios de ese visitante.

`GET /api/state` muestra revisión y conteos sin secretos; `GET /api/master` descarga el CSV. Consultar DESPLIEGUE.md para operación y límites.

## Entrega y protección de secretos

Entregar Git o ZIP con código, fixtures originales, README, SOLUCION y lockfile. Excluir `.env`, `node_modules`, `dist` y `out`. Los originales adjuntos se mantienen intactos. El log del backend registra herramienta, mensaje, resultado y resumen sin la clave. Variables: `MAX_ITERATIONS` (25), `MAX_SESSION_TOKENS` (150000), `MAX_DAILY_TOKENS` (1000000), `LLM_TIMEOUT_MS` (45000), `PORT` (3000).

## Revisión externa y seguridad

El análisis con Claude se contrastó con el backend y dio lugar al aislamiento público por visitante, cuotas compartidas, cabeceras y exportación segura. Ver [REVISION_SEGURIDAD.md](REVISION_SEGURIDAD.md) para los siete hallazgos, correcciones y límites pendientes. Aplicar `database/schema.sql` y luego `database/visitor-isolation.sql` para reproducir el esquema.
