# El Cierre — Control de gastos

App de control de gastos personal y familiar (tarjetas, cuotas, resúmenes).

## Opción A — La más simple: Netlify Drop (sin GitHub, sin instalar nada)

1. Abrí https://app.netlify.com/drop en tu navegador.
2. En esta carpeta, corré (una sola vez) `npm install` y después `npm run build`.
   Esto genera una carpeta `dist/`.
3. Arrastrá la carpeta `dist/` entera a la página de Netlify Drop.
4. Netlify te da al toque una URL tipo `https://algo-random.netlify.app`.
   Entrá ahí las veces que quieras — queda hosteado.

Nota: con este método, si querés actualizar la app en el futuro tenés que
volver a generar el `dist/` y arrastrarlo de nuevo.

## Opción B — Recomendada: conectar un repositorio (permite actualizar fácil)

1. Subí esta carpeta a un repositorio de GitHub (podés arrastrar los archivos
   directamente en github.com > "Create new repository" > "uploading an
   existing file", o usar git desde la terminal).
2. Entrá a https://app.netlify.com → "Add new site" → "Import an existing
   project" → elegí tu repositorio de GitHub.
3. Netlify va a detectar automáticamente la configuración gracias al archivo
   `netlify.toml` incluido:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Hacé clic en "Deploy site". En un par de minutos tenés tu URL.
5. Cada vez que subas cambios al repositorio, Netlify vuelve a compilar y
   actualizar el sitio solo.

## Datos y backup

Los datos se guardan en el `localStorage` de tu navegador — es decir, viven
en ESE navegador y ESA computadora/perfil. Si entrás desde otro navegador o
borrás datos de navegación, no vas a ver tu información.

Para no perder nada, usá los botones **Exportar** / **Importar** del panel
lateral: te permiten descargar un backup en `.json` y restaurarlo cuando
quieras (por ejemplo si cambiás de PC o de navegador).

## Desarrollo local (opcional)

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.
