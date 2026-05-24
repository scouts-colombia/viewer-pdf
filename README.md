# Visor PDF — Scouts Colombia

![Visor PDF Scouts Colombia](https://viewer.cdnscout.org/og-image.png)

Visor web de documentos para la Biblioteca Virtual de la Asociación Scouts de Colombia. Construido con Vite, TypeScript y PDF.js, pensado para cargar archivos desde `cdnscout.org` con controles de lectura, búsqueda, índice y zoom.

[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PDF.js](https://img.shields.io/badge/PDF.js-5.x-E34F26)](https://mozilla.github.io/pdf.js/)

## Características

- Render de PDF con PDF.js y worker servido localmente.
- Carga progresiva por páginas visibles para reducir trabajo inicial.
- Navegación por página, teclado y scroll.
- Zoom por botones, teclado y `Ctrl`/`Meta` + rueda del mouse.
- Modos de ajuste por ancho y por página.
- Búsqueda de texto con resaltado de resultados.
- Panel de índice cuando el PDF trae outline.
- Validación de orígenes permitidos para evitar cargar URLs arbitrarias.
- Headers de seguridad para hosting estático.
- Worker de Cloudflare R2 con CORS y soporte para Range requests.

## Arquitectura

```text
Usuario
  |
  v
viewer.cdnscout.org
  |
  | ?file=https://cdnscout.org/ruta/documento.pdf
  v
PDF.js Viewer
  |
  +-- /public/pdfjs  -> worker, cmaps, standard fonts y wasm
  |
  +-- cdnscout.org   -> PDF servido desde R2/Cloudflare
```

El visor es una app estática. No descarga documentos desde cualquier dominio: `src/security.ts` permite en producción solo `https://cdnscout.org` y subdominios. En desarrollo también permite `localhost` y `127.0.0.1`.

## Inicio Rápido

### Prerrequisitos

- Node.js compatible con Vite 8
- pnpm

### Instalación

```bash
pnpm install
```

### Desarrollo

```bash
pnpm dev
```

Abrir:

```text
http://localhost:5173/?file=https://cdnscout.org/ruta/documento.pdf
```

En desarrollo, las URLs de `cdnscout.org` se reescriben a `/cdn-proxy` para evitar bloqueos de CORS durante pruebas locales.

### Build

```bash
pnpm build
```

El build copia primero los assets necesarios de `pdfjs-dist` hacia `public/pdfjs` y luego genera `dist/`.

## Scripts disponibles

| Comando | Descripción |
| :--- | :--- |
| `pnpm dev` | Inicia Vite en desarrollo |
| `pnpm build` | Copia assets de PDF.js, corre TypeScript y genera `dist/` |
| `pnpm preview` | Previsualiza el build localmente |
| `node scripts/copy-pdfjs-assets.mjs` | Sincroniza worker, cmaps, fuentes y wasm de PDF.js |

## Parámetros

| Parámetro | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `file` | URL absoluta del documento a visualizar | `?file=https://cdnscout.org/biblioteca/doc.pdf` |

Si `file` está ausente el visor redirige a la landing. Si no pasa la validación de seguridad, muestra una pantalla de error.

## Seguridad

- `validatePdfUrl()` bloquea protocolos peligrosos: `javascript:`, `data:`, `file:`, `blob:` y `vbscript:`.
- En producción solo se aceptan documentos servidos por `cdnscout.org` o subdominios.
- `_headers` define CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors`.
- El worker R2 limita CORS a orígenes conocidos.
- `download` en el worker se sanitiza antes de crear `Content-Disposition`.

## Worker R2

El archivo `r2-worker/worker.js` sirve objetos de R2 con:

- CORS para `viewer.cdnscout.org`, `scout.org.co` y localhost.
- `GET`, `HEAD` y `OPTIONS`.
- Soporte para `Range`, necesario para que PDF.js cargue documentos por chunks.
- `Content-Disposition` opcional mediante `?download=nombre.pdf`.
- Descarga forzada mediante `?force`.

Para actualizarlo, copiar el contenido de `r2-worker/worker.js` en el Worker de Cloudflare correspondiente.

## Despliegue

El proyecto genera archivos estáticos en `dist/`. El dominio de producción es:

```text
https://viewer.cdnscout.org
```

Hosting recomendado: **Cloudflare Pages** (build command: `pnpm build`, output: `dist`).

## Tecnologías

- Vite · TypeScript · PDF.js
- Cloudflare Pages · R2 · Workers

## Licencia

Proyecto privado de la Asociación Scouts de Colombia. Todos los derechos reservados.
