import app from "./server.js";
app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0", () =>
  console.log(
    `Contratos listo en http://localhost:${process.env.PORT ?? 3000} · proveedor ${process.env.LLM_PROVIDER ?? "mock"}`,
  ),
);
