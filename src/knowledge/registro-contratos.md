# Conocimiento del proceso

El maestro original se conserva sin modificaciones. La copia operativa vive en out/sharepoint/maestro-contratos.csv.
Duplicado: mismo identificador, valor, fecha_inicio y fecha_fin. Actualización: mismo ID o NIT y objeto con similitud >=0.9, con cambios; un otrosí hereda del maestro los campos no modificados y registra diferencias.
Nuevo: sin coincidencias. Rechazado: sin contrato o sin partes y objeto identificables.
Confianza <0.8 y conflictos con el maestro requieren revisión. Una fecha ausente no se reemplaza por la fecha del correo. Los datos confirmados quedan con fuente humana y confianza 1.
Toda póliza nueva es pendiente hasta acreditar su vigencia. El otrosí que amplía el plazo deja pendiente la ampliación de garantías.
Alertas: vencimientos entre hoy y hoy+60 días inclusive; pólizas requeridas que no estén vigentes; registros desde 2026-05-30. Estas últimas muestran actividad desde el corte, no prueban por sí solas cobertura total del faltante.
La fecha de referencia de la defensa es 2026-09-03. Las firmas de los fixtures son texto de demostración, no firmas verificadas digitalmente.
