# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/). Versiones en GitHub Releases.

---

## [0.7.0] - 2026-11-08

### Añadido
- **Tool `browser` (CDP contra Brave/Chrome)**: `list` / `activate` / `close` / `snapshot` / `inspect` / `click` / `fill` / `send` + atajos WhatsApp Web (`whatsapp_chat`, `whatsapp_send`, `whatsapp_send_to` — abre, verifica header, envía y confirma). Requiere Brave con `--remote-debugging-port=9222`.
- Tool `whatsapp_chat` / `whatsapp_send` como accesos directos con selectores `data-testid` estables.

## [0.6.0] - 2026-11-07

### Añadido
- **Compartir conversación** (📤 junto a ⚙️): exporta la pestaña activa como ZIP con `*.md` legible + `*.json` completo + `assets/` (imágenes adjuntas).
- **Scoring jack-of-all-trades**: cada modelo lleva un score heurístico (familia + visión/reasoning/contexto, sin API externa). El dropdown lo muestra inline por prestación (`🔧92 👁️89 🧠91 💰94`), ordenado mejor-primero, y las pestañas nuevas usan el mejor balance.
- **UX**: handoffs ("Cambio de agente"), "pensamientos"/steps y resultados de tools colapsables vía `<details>` (click para expandir) para evitar flood; renombrado automático fijo al primer mensaje (`autoName` se bloquea).

## [0.5.0] - 2026-11-05

### Añadido
- **Agent Skills estándar** (`src/skills/<nombre>/SKILL.md`): 20 bundled (4 propios + 10 de `addyosmani/agent-skills` + 6 de `obra/superpowers`, todos MIT, curados para las tools de Loom; TDD dedupe conserva Addy).
- **Loader multi-raíz** (`src/context/skills.js`): catálogo barato (name+description) en el system prompt + cuerpo bajo demanda con `read_file`. Prioridad: usuario > proyecto > bundled.
- **Carpeta externa** `%APPDATA%/Renzo's Loom/skills/` (auto-generada): agregar skills sin rebuild; Configuración → Skills con path, **📁 Abrir carpeta** (`shell.openPath`) y **↻ Recargar**.
- Skill `user-profile` (externo): notas persistentes del usuario con evidencia y sin datos sensibles.

### Cambiado
- Migrados y eliminados los `.json` planos viejos. `src/skills/THIRD-PARTY-NOTICES.md` con atribución.
- Consolidada la doble carpeta AppData (`Renzos Loom` vs `Renzo's Loom`) a una sola canónica.

## [0.4.0] - 2026-11-04

### Añadido
- **Multi-key multi-provider**: Settings → API Keys (provider + endpoint + key) con test/delete; lista de modelos fusionada de todas las llaves, **agrupada por provider/llave** con filtros por provider (un checkbox por llave), **auto-refresh** al agregar/borrar.
- Cada modelo se llama por la llave que lo expuso (`keyForModel()`), con fallback a la primera llave.
- `user-profile` (bundled en esta versión; luego movido a externa). `VERSION` → 0.4.0.

### Cambiado
- Higiene `.env`: eliminado `MODEL`/`OPENROUTER_API_KEY` como fuente; llaves solo en `sessions/_api_keys.json` (git-ignored). `dotenv` queda solo para la CLI.
- Migración auto de la llave vieja (`localStorage` / `.env`) como primera entrada OpenRouter.

## [0.3.0] - 2026-11-04

### Añadido
- Filtros por prestación (visión/audio/reasoning/PDF/internet/gratis) + contador de contexto (real con `~` estimado, 80%/95% avisos).
- Barra de actividad (paso, cronómetro, total, alertas) + registro verbose con reintentos visibles (429/5xx/timeout, 4 intentos).
- Botón **⏹ Detener** (o `Esc`) con `AbortController`; tools sin bloqueo (`runBashAsync`, 120 s).

### Interno
- Pestañas persistentes en `sessions/` (un JSON por conversación + assets). Atajos `Ctrl+T/W/Tab`.

## [0.2.0] - 2026-11-03

### Añadido
- Electron + OpenRouter: tabs independientes, contexto persistente, imágenes y PDF adjuntos, herramientas (`read_file`/`write_file`/`bash`/`list_dir`/`grep`), rename por doble clic, sesiones guardadas/reabriables.

## [0.1.x] - 2026-11-03

### Añadido
- Visión con imágenes reales como partes del mensaje (`image_url`), CLI con `src/index.js` (`/session`, `/sessions`, `/load`, `/models`).
