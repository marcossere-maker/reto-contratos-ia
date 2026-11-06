# Publicación y mantenimiento del estado

## Componentes

- App y backend: proyecto Vercel `reto-contratos-ia`, Node 24, máximo 300 segundos por petición.
- Datos: proyecto Supabase independiente `reto-contratos-ia` (`orlwzamtsmirpzsrmalv`), organización Free. No se reutilizan tablas de otras apps.
- Modelo: Qwen vía Groq (`qwen/qwen3.8-27b`) configurado mediante `LLM_PROVIDER=groq` y la clave del candidato cifrada en el backend. El modo de práctica sigue disponible como alternativa explícita.

## Qué conserva la base

`reto02_state` guarda un snapshot JSONB del entorno: maestro CSV y su representación estructurada, documentos TXT archivados, historial, correos procesados, alertas, sesiones con revisiones pendientes, tokens consumidos y fecha del contador diario. Las vistas `reto02_contracts` y `reto02_documents` permiten inspeccionar contratos y adjuntos sin interpretar el snapshot manualmente.

Para seis contratos ficticios se eligió un snapshot por visitante que conserva la forma de archivos del PRD. Es una decisión de alcance del prototipo. Para documentos grandes y operación real conviene normalizar contratos y eventos y mover los binarios a Storage.

Cada solicitud que modifica datos adquiere un lease de seis minutos, restaura los archivos en un directorio temporal, ejecuta las herramientas y confirma una nueva versión de todo el estado antes de responder. Postgres valida versión, dueño del lease y vigencia. Si otra instancia intenta escribir, recibe un aviso de operación en curso. Si un proceso muere, su lease vence y su estado no confirmado se descarta. Las lecturas recuperan la última versión confirmada.

**Reiniciar Vercel o desplegar otra versión no borra Supabase.** El botón “Reiniciar datos de prueba” sí restablece deliberadamente los datos ficticios de ese visitante; mantiene el contador de gasto diario. No usar este entorno público para contratos reales.

## Acceso

RLS habilitado. Una clave publicable por sí sola no puede leer ni escribir el estado. El backend agrega una capacidad aleatoria de 256 bits, verificada por su hash SHA-256 en las políticas de la fila del reto. Ese secreto no sale al navegador ni permite administrar Supabase. Los roles públicos no pueden cambiar el hash ni eliminar espacios; INSERT está restringido por RLS a la capacidad real del backend. La tabla de cuotas permite limpiar solamente contadores antiguos. Las vistas usan security_invoker.

La capacidad se almacena cifrada como `STORAGE_ACCESS_TOKEN` en Vercel. Para rotarla, generar una nueva, cambiar su hash en todas las filas de estado y cuotas usando el panel autorizado de Supabase, actualizar la variable cifrada y volver a publicar. No guardar el valor en Git. Este mecanismo habilita exclusivamente la demo; una aplicación con usuarios y datos reales requiere autenticación y autorización por usuario/organización.

## Mantenimiento

La cuenta de Groq probada tiene un límite de 8.000 tokens por minuto para este modelo. La operación `contratos_procesar_buzon` ejecuta las herramientas deterministas en un lote y luego Qwen explica el resultado, usando normalmente dos llamadas al modelo. Si Groq responde 429, la app informa la limitación; esperar a que la cuota se reponga antes de reintentar. No se confunde ese estado con una clave inválida.

1. Revisar `GET /api/state`: almacenamiento, revisión, número de contratos, correos procesados y sesiones.
2. Descargar `/api/master` y `/api/report` después de una defensa. Desde el panel de Supabase se puede exportar la fila de estado para una copia completa. El proyecto Free no sustituye una política corporativa de respaldos.
3. No modificar a mano la copia temporal ni el CSV compilado: Postgres es la fuente durable cloud. Hacer cambios de esquema con una migración revisada y conservar `database/schema.sql` y `database/visitor-isolation.sql`.
4. Verificar el servicio y el proyecto Supabase antes de la entrevista. La disponibilidad de los planes gratuitos depende de sus cuotas y políticas vigentes.
5. Los logs y conversaciones también consumen espacio. El prototipo conserva hasta treinta sesiones y limita el snapshot a 8 MB. Exportar y reiniciar los datos ficticios cuando corresponda.

## Límites conocidos

La demo es pública y está aislada por visitante mediante cookie firmada de siete días. No valida identidad humana ni corporativa. Otro navegador inicia su propio maestro. El estado compartido anterior se conserva para administración y no se sirve a visitantes. Ver REVISION_SEGURIDAD.md para límites de uso, retención y matriz de hallazgos. El máximo de 50 espacios exige revisar capacidad antes de presentar. Borrar cookies pierde acceso a tu espacio, no borra automáticamente la fila en Supabase.
