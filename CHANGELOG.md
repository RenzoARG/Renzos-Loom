# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/). Versiones en GitHub Releases.

---

## [0.8.1] - 2026-11-10

### Arreglado
- **WhatsApp Web**: `send` y `send-to` ya no envían por defecto. Sin `confirmed:true` devuelven un preview con destino y texto exactos; el envío exige que el modelo pase `confirmed:true` solo tras aprobación explícita del usuario. `send-to` tampoco abre el chat en el preview.
- **Target equivocado en notas de voz**: `transcribe`/`extract-audio` ahora aceptan `chatName` (abren y verifican el header del chat antes de operar) y `sender` (filtran por remitente, p. ej. `Aarón`). Cada nota devuelve metadata `chat`, `sender` y `time`, así el agente sabe quién habló y en qué grupo, en vez de adivinar el último audio global.
- `read` también acepta `chatName`/`sender` y devuelve el remitente junto a cada mensaje (con el header del chat al principio).
- **Citas/replies**: el remitente citado dentro de un mensaje citado ya no se confunde con quien envió el audio/mensaje; `read` y `transcribe` devuelven el remitente real y `replyTo` cuando el mensaje es una respuesta.
- **Formato de transcripción**: la tool separa los metadatos con ` | ` y el skill fija un formato recomendado para que el modelo no concatene `sender` y `replyTo` (bug `YoA: Erick`).
- **WhatsApp Web `message`**: nueva acción genérica para el último mensaje visible (texto o audio). Reporta `type`, `sender`, `time`, `replyTo`; si es audio, indica usar `transcribe`. Mantener alias compatible `read-last`. "Mensaje" significa texto o audio; "audio" significa solo nota de voz.
- **Aviso sonoro configurable**: Configuración > "Volumen de notificación" (0-100, por defecto 70). 0 silencia el aviso; al soltar el slider suena una prueba. El tono solo suena cuando termina una respuesta y la ventana no tiene foco.
- Skill `whatsapp-web` reforzado: confirmación obligatoria antes de enviar, prohibido reenviar vía `click`, usar `sender` para "quién dijo" y siempre pasar `chatName` cuando el usuario nombra un chat.

---

## [0.8.0] - 2026-11-10

### Añadido
- **Tool `whatsapp_web`** (`src/tools/whatsapp-web.js`): todo lo de WhatsApp Web en una sola tool — `list`, `open`, `read`, `send`, `send-to`, `transcribe`, `extract-audio`, `search`, `scroll`, `status` (+ `snapshot`/`click`/`fill` genéricas) — delega en las acciones `whatsapp-*` de `src/tools/browser.js`.
- **Skill `whatsapp-web`** (`src/skills/whatsapp-web/SKILL.md`): instrucciones estándar para que el agente opere WhatsApp Web con esas tools (con cuál confirmar envíos y cómo transcribir notas de voz).
- **Transcripción de notas de voz (`transcribe`)**: usa SpeakApp (WAV mono 16 kHz posteado desde una pestaña background; la página resuelve su propio challenge anti-bot). Límites del endpoint: 80 s por nota y 5 solicitudes/hora. El audio sale a un servidor tercero. La extracción prueba primero el `<audio>` blob, luego el Cache Storage de WhatsApp (`lru-media-array-buffer-cache`, donde WhatsApp decodifica el opus para pintar el waveform) con match por duración, sin reproducir la nota; Play queda como último recurso (marca como escuchada).

### Cambiado
- `whatsapp_chat` / `whatsapp_send` / `whatsapp_transcribe` se unificaron dentro de `whatsapp_web` (eliminadas como tools separadas).
- Se eliminó el backend Voqua de `transcribe` (límite de 3/día) y se reemplazó por SpeakApp.

### Arreglado
- Notas de voz: la duración se parseaba con un regex dentro de un template literal mal escapado (`\d` → `d`), por lo que el matching por duración con el Cache Storage nunca funcionaba y el tool caía al fallback Play (marcando la nota como escuchada). Ahora funciona por cache sin tocar la nota.

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
