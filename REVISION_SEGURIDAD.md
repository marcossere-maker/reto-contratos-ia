# Revisión de seguridad y correcciones

## Origen y alcance

El candidato solicitó una revisión externa con Claude el 6 de noviembre de 2026. El informe revisó la página, JavaScript y respuestas HTTP mediante caja negra; no inspeccionó el backend ni la base. Se contrastaron sus siete hallazgos con el código antes de decidir cambios. El enlace privado del informe no se publica porque incluye una credencial de acceso compartido.

La revisión sirve para mejorar este prototipo; no constituye una auditoría exhaustiva ni una certificación para operar con datos reales.

## Hallazgos y respuesta

| Observación de Claude | Verificación y corrección | Estado |
| --- | --- | --- |
| Alta: reinicio público del entorno compartido | El literal de confirmación era visible y no era un secreto. Se sustituyó el espacio global por un espacio por visitante. Reset exige cookie firmada y solo reinicia ese espacio, con límite de 3/minuto. | Corregido para la demo |
| Alta: maestro y alertas descargables sin control de acceso | Las descargas exigían solo conocer la URL. Ahora requieren la capacidad del visitante y consultan exclusivamente su snapshot. Sin cookie: HTTP 401. | Corregido para la demo |
| Media: escritura/consumo de IA sin login; rate limit por confirmar | Ya había límites en memoria y validación determinista contra documentos. Se agregaron contadores atómicos compartidos en Supabase por IP, visitante y día, más un máximo global de 100 solicitudes de chat/día. El backend sigue rechazando valores inventados y confirmaciones ajenas. | Mitigado; acceso anónimo deliberado |
| Media: sesiones recuperables por identificador | Ya se generaban UUID criptográficamente aleatorios. Faltaba vincularlos a un propietario. Ahora sesión, confirmación y archivos pertenecen al espacio derivado de la cookie firmada. Otro visitante recibe 404, aunque conozca el UUID. | Corregido para la demo |
| Baja: faltaban CSP y protección contra iframe en HTML estático | Se configuraron CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy y HSTS en Vercel y Express. El middleware precede al parser JSON. | Corregido |
| Baja: CORS estático abierto y respuestas 200 para rutas inexistentes | Se restringió el origen estático al dominio público de la app; el backend rechaza POST desde otro origen. Se agregó 404 explícito y se eliminaron los falsos 200 de rutas sensibles. El informe no había encontrado una clave expuesta: /.env devolvía HTML. | Corregido |
| Informativa: health y trazas muestran información técnica | Health público devuelve solo `{ok:true}`. Modelo y estado se muestran dentro del inicio de la demo porque explican el uso real de IA. Las trazas siguen disponibles dentro del espacio propio, plegadas en “Ver actividad”, como evidencia exigida por el reto. | Reducido; transparencia controlada |

También se implementó la recomendación adicional de **neutralizar fórmulas en el CSV descargado**. Se antepone un apóstrofo a valores peligrosos, incluso con espacios o controles iniciales; la exportación no altera el dato canónico. El quoting CSV por sí solo no evita esta clase de ataque.

## Cómo funciona el aislamiento público

1. `POST /api/visitor` emite una capacidad aleatoria de 256 bits, con fecha y firma HMAC. Se guarda en una cookie HttpOnly, SameSite=Lax, Secure en Vercel y con prefijo `__Host-`. Expira a los siete días. No se expone al JavaScript.
2. El backend deriva un ID de espacio mediante SHA-256 y nunca acepta un ID de espacio enviado por el cliente. El UUID de conversación no reemplaza la cookie.
3. Cada espacio tiene una fila independiente en `reto02_state`, con los seis fixtures iniciales, maestro, documentos, historial y confirmaciones propios. La copia global anterior `demo` queda conservada para administración; la API de visitantes no la sirve.
4. La conexión backend–Supabase conserva RLS y la capacidad de servidor `STORAGE_ACCESS_TOKEN`. La clave publicable sola no da acceso. El aislamiento entre visitantes se controla en el backend; no se presenta como autenticación corporativa ni RLS de usuarios de Supabase Auth.
5. Las funciones SQL son SECURITY INVOKER, con permisos explícitos y sin service_role. Crear una fila exige poseer la capacidad real del backend, no elegir cualquier hash de token.

El navegador recupera su espacio durante la vigencia de la cookie, aunque Vercel se reinicie. Borrar cookies o usar otro navegador crea otro espacio. La expiración de acceso no borra automáticamente los datos de Supabase.

## Límites y mantenimiento

- Nuevos espacios: 10 por IP/día; capacidad total de la demo: 50 espacios. Revisar y eliminar espacios vencidos desde administración cuando corresponda; no se ofrece borrado de otras personas en la API pública.
- Chat: 10 solicitudes/IP/minuto, 6/visitante/minuto, 30/visitante/día y 100 globales/día. Son ventanas fijas y el contador global mide solicitudes admitidas, no tokens ni usuarios reales. Reintentos también consumen cupo.
- Se conservan los topes de tokens de sesión y por espacio/día, máximo 25 iteraciones y tiempos de espera. Reset no vacía contadores de gasto ni límites compartidos. Las cuotas del proveedor pueden ser más restrictivas.
- La IP se obtiene de la cabecera sobrescrita por Vercel; se guarda un HMAC, sin almacenar la IP en claro en la tabla de cuotas. Los contadores antiguos se eliminan después de dos días.
- Un visitante anónimo puede consumir su propio cupo y un ataque distribuido puede agotar la cuota global o la capacidad de espacios. Antes de abrir a gran escala: autenticación, reglas de borde, monitoreo y presupuestos del proveedor.

## Verificación y límites de la evidencia

`tests/security.test.ts` agrega pruebas de firma/expiración, CSV malicioso y un recorrido HTTP con dos visitantes: sesiones y confirmaciones ajenas rechazadas, reinicio aislado, descargas protegidas, CSRF, JSON inválido con cabeceras, rutas 404 y límite HTTP 429. La suite completa contiene 11 pruebas y mantiene la cobertura de los seis casos funcionales.

Las pruebas con sustitutos del transporte no certifican RLS real. La publicación se comprueba además contra Vercel y Supabase; el registro concreto de comprobaciones está en `VERIFICACION.md`. Ninguna prueba de reinicio debe dirigirse al antiguo espacio global.

## Antes de usar contratos reales

Definir identidad corporativa y permisos por organización/rol, revocación de sesiones, retención y borrado, respaldo/restauración, registro de accesos y alertas de abuso. Separar documentos en Storage, normalizar datos y evaluar PDF/OCR con un corpus representativo. Revisar con Seguridad y Administración la información enviada al proveedor de IA. Los datos de esta app siguen siendo exclusivamente ficticios.

## Referencias técnicas

- [Supabase: RLS y políticas](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Vercel: cabeceras de IP del cliente](https://vercel.com/docs/headers/request-headers).
- [CSV Stringify: escape_formulas](https://csv.js.org/stringify/options/escape_formulas/).
