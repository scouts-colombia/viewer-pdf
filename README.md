# Visor PDF - Scouts Colombia

Visor web de documentos para la Biblioteca Virtual de la Asociacion Scouts de Colombia. Esta construido con Vite, TypeScript y PDF.js, y esta pensado para cargar archivos desde `cdnscout.org` con controles de lectura, busqueda, indice y zoom.

[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PDF.js](https://img.shields.io/badge/PDF.js-5.x-E34F26)](https://mozilla.github.io/pdf.js/)

## Caracteristicas

- Render de PDF con PDF.js y worker servido localmente.
- Carga progresiva por paginas visibles para reducir trabajo inicial.
- Navegacion por pagina, teclado y scroll.
- Zoom por botones, teclado y `Ctrl`/`Meta` + rueda del mouse.
- Modos de ajuste por ancho y por pagina.
- Busqueda de texto con resaltado de resultados.
- Panel de indice cuando el PDF trae outline.
- Validacion de origenes permitidos para evitar cargar URLs arbitrarias.
- Headers de seguridad para hosting estatico.
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

El visor es una app estatica. No descarga documentos desde cualquier dominio: `src/security.ts` permite en produccion solo `https://cdnscout.org` y subdominios. En desarrollo tambien permite `localhost` y `127.0.0.1`.

## Inicio Rapido

### Prerrequisitos

- Node.js compatible con Vite 8.
- pnpm mediante Corepack.

### Instalacion

```bash
corepack enable
corepack pnpm install
```

### Desarrollo

```bash
corepack pnpm dev
```

Abrir:

```text
http://localhost:5173/?file=https://cdnscout.org/ruta/documento.pdf
```

En desarrollo, las URLs de `cdnscout.org` se reescriben a `/cdn-proxy` para evitar bloqueos de CORS durante pruebas locales.

### Build

```bash
corepack pnpm build
```

El build copia primero los assets necesarios de `pdfjs-dist` hacia `public/pdfjs` y luego genera `dist/`.

## Scripts Disponibles

| Comando | Descripcion |
| :--- | :--- |
| `corepack pnpm dev` | Inicia Vite en desarrollo |
| `corepack pnpm build` | Copia assets de PDF.js, corre TypeScript y genera `dist/` |
| `corepack pnpm preview` | Previsualiza el build localmente |
| `node scripts/copy-pdfjs-assets.mjs` | Sincroniza worker, cmaps, fuentes y wasm de PDF.js |

## Parametros

| Parametro | Descripcion | Ejemplo |
| :--- | :--- | :--- |
| `file` | URL absoluta del documento a visualizar | `?file=https://cdnscout.org/biblioteca/doc.pdf` |

Si `file` esta ausente o no pasa la validacion de seguridad, el visor muestra una pantalla de error.

## Seguridad

El visor aplica varias defensas:

- `validatePdfUrl()` bloquea protocolos peligrosos como `javascript:`, `data:`, `file:`, `blob:` y `vbscript:`.
- En produccion solo se aceptan documentos servidos por `cdnscout.org` o subdominios.
- `_headers` define CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors`.
- El worker R2 limita CORS a origenes conocidos.
- `download` en el worker se sanitiza antes de crear `Content-Disposition`.
- Rangos HTTP malformados retornan `416` en vez de caer a una descarga completa.

## Worker R2

El archivo `r2-worker/worker.js` sirve objetos de R2 con:

- CORS para `viewer.cdnscout.org`, `scout.org.co` y localhost.
- `GET`, `HEAD` y `OPTIONS`.
- Soporte para `Range`, necesario para que PDF.js cargue documentos por chunks.
- `Content-Disposition` opcional mediante `?download=nombre.pdf`.
- Descarga forzada mediante `?force`.

Para actualizarlo, copiar el contenido de `r2-worker/worker.js` en el Worker de Cloudflare correspondiente.

## Despliegue

El proyecto genera archivos estaticos en `dist/`, por lo que puede desplegarse en:

- Cloudflare Pages
- Vercel
- Netlify
- Cualquier hosting de archivos estaticos

El dominio esperado para produccion es:

```text
https://viewer.cdnscout.org
```

## Tecnologias

- Vite
- TypeScript
- PDF.js
- Cloudflare R2 / Workers

## Licencia

Proyecto privado de la Asociacion Scouts de Colombia. Todos los derechos reservados.
