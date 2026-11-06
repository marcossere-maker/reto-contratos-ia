# Guion breve para la entrevista

**Apertura, 30 segundos.** “El problema es la falta de un registro confiable, causada por un proceso sin canal único ni responsable claro. Propongo un agente que reduzca la carga administrativa y haga visibles las excepciones, acompañado de una regla de gobierno que asegure que los contratos lleguen.”

**Demo, 3 minutos.** Procesar el buzón; mostrar los dos contratos nuevos, el otrosí, el duplicado y la cotización rechazada. Abrir una llamada para demostrar fuente y validación. Explicar que la interfaz conversacional permite pedir el proceso completo, mientras las herramientas controlan las escrituras. Mostrar el contrato por demanda y la fecha imprecisa: confirmar explícitamente los datos supuestos para la demo, registrar y abrir el reporte.

**Decisiones, 1 minuto.** “Usé Qwen vía Groq para el prototipo; la prueba sin clave usa un flujo programado que se identifica en pantalla. La decisión de registrar depende de reglas y evidencia. El modelo propone herramientas y explica resultados. El adaptador permite implementar luego Vertex AI o Bedrock, según las políticas de la organización.” Aclarar qué modo se está mostrando y si ya se probó la conexión real.

**Gobierno y valor, 1 minuto.** Administración es dueña del maestro. Comercial entrega documentos firmados dentro de dos días hábiles. Hay acuses, responsables y escalamiento. Para reconstruir el faltante se cruza contra facturación; registrar lo que llegó al buzón no alcanza para demostrar cobertura. Medir cobertura contractual, antigüedad de pendientes y minutos de revisión. El retorno se calcula con tiempo realmente ahorrado, sin prometer cifras no medidas.

**Límites y siguiente paso, 30 segundos.** TXT y archivos locales representan correo y SharePoint. El hosting gratuito pierde estado al reiniciar. Antes de producción se necesitan integraciones reales, acceso por rol, almacenamiento transaccional, evaluación con documentos diversos y un piloto supervisado.

## Preguntas probables

- **¿Por qué un chat?** Permite expresar una tarea completa y resolver excepciones en contexto; la trazabilidad visible deja revisar qué hizo cada herramienta.
- **¿Por qué no automatizar todo?** El día de firma ausente, las pólizas condicionales y las inconsistencias requieren una decisión responsable; la revisión se concentra donde falta evidencia.
- **¿Qué evita que el modelo invente un valor?** El servidor vuelve a comparar el contrato con la extracción y rechaza cambios sin autorización humana ligada al caso.
- **¿Cambiar de proveedor es inmediato?** Las herramientas y las pruebas se conservan. Hay que implementar y verificar el adaptador de mensajes, herramientas, errores, permisos y consumo de la plataforma elegida.
- **¿Qué demuestra esta entrega?** Comportamiento funcional con los seis fixtures, controles de revisión y una propuesta operativa. No demuestra cobertura en documentos reales ni ahorros productivos.
