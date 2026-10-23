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
| `pnpm test` | Corre las pruebas de `test/` con el runner de Node |
| `node scripts/copy-pdfjs-assets.mjs` | Sincroniza worker, cmaps, fuentes y wasm de PDF.js |

## Parámetros

| Parámetro | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `file` | URL absoluta del documento a visualizar | `?file=https://cdnscout.org/biblioteca/doc.pdf` |
| `page` | Página en la que abre el documento (opcional) | `&page=12` |

Si `file` está ausente el visor redirige a la landing. Si no pasa la validación de seguridad, muestra una pantalla de error.

## Citas desde Zulú

Zulú embebe el visor en un iframe y le pasa los fragmentos que citó con `postMessage`:

1. En cuanto abre el documento, antes de pintar páginas, el visor envía `{ tipo: 'visor:listo' }` a la ventana padre.
2. La página padre responde con `{ tipo: 'zulu:citas', citas: [{ pagina, texto }], pagina? }`.
3. El visor subraya cada fragmento en su página y salta a `pagina`, o a la primera página citada. Un mensaje nuevo reemplaza las citas anteriores.
4. Si se pulsa `Escape` dentro del visor (fuera de un campo de texto), el visor envía `{ tipo: 'visor:escape' }` a la ventana padre, que puede cerrar el panel. Las teclas dentro de un iframe no llegan a la página que lo embebe.

Solo se aceptan mensajes de `https://*.scout.org.co` y de `http://localhost`. El fragmento viene de una transcripción de la página, así que no se busca la frase exacta (`src/citas.ts`): se ubica el tramo donde se concentran los trigramas de palabras del fragmento. Si la página no tiene capa de texto o la transcripción es muy distinta, el visor solo abre la página.

## Seguridad

- `validatePdfUrl()` bloquea protocolos peligrosos: `javascript:`, `data:`, `file:`, `blob:` y `vbscript:`.
- En producción solo se aceptan documentos servidos por `cdnscout.org` o subdominios.
- `public/_headers` define CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors`. Tiene que estar en `public/` para que Vite lo copie a `dist/`, que es lo que publica Cloudflare Pages.
- El Worker de descargas limita CORS a orígenes conocidos.
- `download` en el worker se sanitiza antes de crear `Content-Disposition`.

## Worker R2

`r2-worker/` es el Worker `r2-download-cleaner`, publicado en `biblioteca.cdnscout.org`. La web lo usa para descargar documentos con nombre legible. El visor no pasa por él: lee de `cdnscout.org`, que es el dominio propio del bucket `scouts-cdn`, y el CORS de ese dominio es la política del bucket.

- `Content-Disposition` mediante `?download=nombre.pdf`, con `?force` para descarga forzada. El nombre va en ASCII en `filename` y completo en `filename*`.
- `GET`, `HEAD` y `OPTIONS`. `HEAD` solo lee metadatos.
- `Range` y revalidación con `ETag` (responde 304).
- `Cache-Control: public, max-age=86400` si el objeto no trae uno propio.
- CORS para `viewer.cdnscout.org`, `scout.org.co` y localhost.

Para desplegarlo, con la CLI `cf` autenticada en la cuenta de Scouts:

```bash
cd r2-worker
pnpm install
cf deploy
```

`cloudflare.config.ts` declara el binding al bucket, el dominio y los logs; si se cambia algo desde el dashboard, hay que reflejarlo ahí.

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
