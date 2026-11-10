# Renzo's Loom: notas para quien siga tocando el código

## 1. Imágenes y modelos con visión (v0.1.1)

El problema original **no era** la detección de visión: `thinkingmachines/inkling-small:free` sí acepta
imágenes. El modelo decía "no tengo visión" porque **nunca recibía ninguna imagen**:
`parseImageRefs()` convertía `@image:ruta` en el *texto* `__IMAGE_BASE64__:ruta`, y `send-message`
siempre mandaba `content` como string.

Reglas que quedan:
- Un adjunto es una **parte del mensaje**, no una línea de texto:
  `content: [{type:"text",text}, {type:"image_url", image_url:{url:"data:image/png;base64,..."}}]`.
- `__IMAGE_BASE64__:` es solo el retorno interno de la tool `read_file`. Nunca es input del usuario.
- La visión se detecta con `architecture.input_modalities.includes("image")`. El string `modality` también
  da `true` para modelos que *generan* imágenes (`"text->text+image"`).
- Con varios `tool_calls`, todos los mensajes `tool` van juntos y las imágenes se mandan **después**.
- Si algo falla a mitad de turno, se hace rollback del historial (`history.length = checkpoint`).

## 2. Pestañas (v0.2.0)

**Una pestaña = una conversación independiente**: historial propio y **modelo propio** (se elige en el
sidebar y vale solo para la pestaña activa; las nuevas heredan el último elegido).

El estado vive en el proceso principal (`main.js`), no en el renderer:

```
tabs: Map<id, { id, name, autoName, model, createdAt, history, busy, closed }>
openIds: string[]   // orden de la barra
activeId: string
```

- **No volver a introducir** un `history`, `activeModel` o `sessionName` globales. Todo cuelga de la pestaña.
- Todos los eventos main → renderer llevan `tabId` (`assistant-message`, `tool-call`, `tool-result`, `error`)
  y la UI los dibuja en el chat de *esa* pestaña aunque no sea la visible. Eso permite varias respuestas en paralelo.
- `tab-updated` ({id,name,model,busy}) mantiene la barra sincronizada (punto naranja = respondiendo).
- Cerrar una pestaña **no borra** la conversación: queda en "Conversaciones guardadas". Si estaba respondiendo,
  `tab.closed = true` corta el ciclo y se descarta la respuesta tardía. Si se cierra la última, se crea una vacía.
- El nombre arranca con el primer mensaje (`autoName`); al renombrarlo a mano (doble clic) deja de cambiar.
- Atajos: Ctrl+T nueva, Ctrl+W cerrar, Ctrl+Tab / Ctrl+Shift+Tab cambiar. Se interceptan en
  `before-input-event` para que el menú por defecto de Electron no los pise.
- `window.prompt()` **no existe en Electron**. Para pedir texto usar un input inline o un diálogo propio
  (`alert` y `confirm` sí funcionan).

### Persistencia (`sessions/`, en la raíz del proyecto)
| Archivo | Contenido |
|---|---|
| `<id>.json` | `{version, id, name, model, autoName, createdAt, updatedAt, history}` |
| `<id>.assets/` | imágenes del historial (el JSON guarda `session-asset:<hash>.png`, no base64) |
| `_workspace.json` | `{open: [ids en orden], active: id}` para restaurar las pestañas al abrir |

- Las pestañas sin ningún mensaje del usuario no se guardan.
- Las sesiones del formato viejo (un array JSON de mensajes) se siguen leyendo: el nombre del archivo es el título.
- Escritura atómica (`.tmp` + rename).

## 3. Marca
Nombre: **Renzo's Loom**. Íconos en `src/assets/` (`icon.png` 512 px, `icon.ico` multi-tamaño). La ventana usa
el `.ico` en Windows. El ícono del `.exe` solo cambia al empaquetar (ver README).

## Ojo
- El endpoint gratis de Inkling Small registra prompts e imágenes para entrenamiento y es solo para
  "agentic harnesses": no subas datos personales o confidenciales.

## 4. Filtros por prestación y contador de contexto (v0.3.0)

- `getAvailableModels()` marca cada modelo con booleanos: `vision`, `audio`, `files` (PDF), `reasoning`, `web`, `free`.
  La UI arma los filtros con `filterBoxes` (la clave del objeto **es** el nombre de la propiedad del modelo):
  para sumar una prestación nueva alcanza con el booleano en main.js + un checkbox + una entrada en `filterBoxes`.
  Los filtros se guardan en `localStorage.loomFilters`.
- `web` = búsqueda web **nativa** (`supported_parameters` con `web_search_options`, `pricing.web_search > 0` o `perplexity/*`).
  El plugin `web` de OpenRouter (`:online`) funciona con cualquier modelo pero cuesta créditos; no se marca.
  Ojo: la lista se limita a modelos con `tools`, y los de Perplexity (siempre buscan) no suelen soportarlas.
- Contexto: `tab.usage = {tokens, hlen}` guarda `prompt_tokens + completion_tokens` de la última respuesta y el largo del
  historial en ese momento. `tabCtx()` suma una estimación (chars/3.5, imagen ≈ 1000, PDF ≈ 2000) de lo agregado después.
  Si no hay dato real (pestaña restaurada, rollback por error) todo es estimado y la UI muestra `~`.
  Rojo/naranja al pasar 95 % / 80 % del máximo del modelo.

## 5. Qué está haciendo el agente (v0.3.1)

Para saber *dónde* se traba un turno hay un canal `progress` (main → renderer, lleva `tabId`):
`model-start`, `model-done`, `retry`, `tool-start`, `tool-done`. La UI hace dos cosas con él:
- **Barra de actividad** (`#activity`, sobre el input): paso actual + cronómetro + tiempo total. Pasa a naranja/rojo según
  `slowAfter` (90 s modelo, 45 s tool). El cronómetro corre en el renderer, así que sigue aunque main esté bloqueado.
- **Registro en el chat** (`.msg.log`, solo en memoria, no se guarda en la sesión). Se oculta con "Detalle de pasos".

Reglas para no volver a romperlo:
- `client` se crea con `maxRetries: 0`. Los reintentos (429/5xx/timeout, con espera 5/15/30 s o `Retry-After`) son de `callModel()`,
  para que se vean. No volver a llamar `client.chat.completions.create` directo desde el ciclo.
- OpenRouter a veces responde HTTP 200 con `{error}` (modelos gratis): `callModel()` lo convierte en error reintentable
  en vez de caer en `resp.choices[0]` indefinido.
- `bash` en main usa `runBashAsync()` (spawn, sin stdin, timeout 120 s, mata el árbol de procesos con `taskkill /T`).
  `execSync` congelaba **todas** las pestañas mientras corría un comando. `executeTool("bash")` sigue existiendo solo para el CLI.

## 6. Detener (v0.3.2)

El botón "Enviar" pasa a ser "⏹ Detener" (rojo, también con Esc en el input) mientras la pestaña activa está `busy`.
- Cada turno crea `tab.abort = new AbortController()`. Su `signal` llega a la request del modelo (`callModel`), a la espera
  entre reintentos (`sleep`) y a `runBashAsync` (mata el árbol de procesos). `stop-tab` pone `tab.stopped = true` y aborta.
- **Detener no hace rollback**: lo ya hecho queda en el historial (archivos escritos, comandos, mensajes). Si había `tool_calls`
  sin ejecutar se les agrega un mensaje `tool` "Cancelado…" (sin eso el historial es inválido) y se añade una nota `system`
  "⏹ Detenido por el usuario…". El `catch` no emite error ni hace rollback cuando `tab.stopped`/`tab.closed`.
- `completed` evita marcar como detenido un turno cuya respuesta final ya había llegado.
- Cerrar la pestaña también aborta (antes solo dejaba de iterar y la request seguía hasta terminar).

## 7. Skills estándar (v0.4.0+)

Formato **Agent Skills** (compatible con agenteskills.io / Claude Code): cada skill es una carpeta
`src/skills/<nombre>/SKILL.md` con frontmatter `name` + `description` y cuerpo en Markdown.
- `name` debe ser kebab-case y coincidir con el nombre de la carpeta. `description` es la disparadora.
- El loader (`src/context/skills.js`, `loadSkills(roots)`) escanea **tres raíces** en orden
  (la última gana en caso de choque de nombre): bundled `src/skills/` < proyecto `skills/` <
  usuario `%APPDATA%/Renzo's Loom/skills/` (fuera del `.exe`, generada en `app.whenReady`).
  Acepta `SKILL.md` (estándar) y `skill.md` como fallback, e ignora carpetas sin description.
- `main.js` inyecta solo el catálogo (name+description) en el system prompt (`buildSystemPrompt()`).
  El cuerpo completo se carga bajo demanda con `read_file` (que ya es una tool).
- `toUiMessages()` oculta el system prompt original y el catálogo; las notas de handoff sí se muestran.
- IPC: `list-skills` / `read-skill` / `reload-skills` / `get-skills-dirs` / `open-skills-folder`.
- Los `.json` viejos fueron migrados y borrados. No volver a usar JSONs planos para skills.
- Para sumar un skill: crear carpeta + `SKILL.md`, con descripción en 3ª persona ("Ejecuta… Úsala cuando…").
  Opcional: `scripts/`, `references/` y `assets/` dentro de la carpeta.
- Vendorizadas (MIT, ver `src/skills/THIRD-PARTY-NOTICES.md`):
  Addy (10: api-and-interface-design, code-review-and-quality, code-simplification,
  debugging-and-error-recovery, documentation-and-adrs, git-workflow-and-versioning,
  incremental-implementation, planning-and-task-breakdown, security-and-hardening,
  test-driven-development) + Superpowers (6: brainstorming, receiving-code-review,
  requesting-code-review, systematic-debugging, verification-before-completion, writing-plans).
  TDD dedupe: se conserva el de Addy. Excluidas las que requieren MCP/subagentes/metas.

## 8. WhatsApp Web: tool unificada (`whatsapp_web`)

Todo lo que interactúa con la página de WhatsApp Web vive en una sola tool, `whatsapp_web`
(`src/tools/whatsapp-web.js`), que delega en las acciones `whatsapp-*` de `src/tools/browser.js`.
Antes existían `whatsapp_chat`, `whatsapp_send` y `whatsapp_transcribe` por separado: quedaron unificadas.

Acciones (`action`):
- `list`: lista chats (nombre, último mensaje, hora, no leídos).
- `open`: abre un chat por nombre (`chatName`).
- `read`: devuelve los últimos `limit` mensajes del chat abierto (texto + 🎤/🖼️).
- `send`: envía `text` en el chat abierto.
- `send-to`: abre un chat y envía (`chatName` + `text`).
- `transcribe`: transcribe notas de voz (`index`, `limit`).
- `extract-audio`: devuelve el blob de audio de una nota en base64 (sin transcribir).
- `search`: enfoca el buscador con `chatName`/`query`.
- `scroll`: desplaza el chat (`dy`, default 600).
- `status`: chat abierto + estado del composer/buscador.
- `snapshot`/`click`/`fill`/`navigate`/`reload`: genéricas por si el modelo necesita algo puntual.

### cdpEval: convención de escapes en los template literals (importante)
Las expresiones que van a `cdpEval(t, expr)` están en **template literals** (`\`…\`); todo lo
que el browser recibe es el QUE YA INTERPRETÓ Node. Reglas:
- `\b` en un template literal es U+0008 (backspace), **no** word-boundary → usar `\\b` o evitarlo.
- `\d` en un template literal es `d` (no es un escape) → para regex usar `\\d` o escribir los
  caracteres como `[0-9]`.
- `\n` dentro de un template literal es una nueva línea real (va como `\\n` si se quiere un
  backslash-n literal para el DOM).
- Probar SIEMPRE la regex dentro del template literal (una mismatch silenciosa hace que `\w+`
  funcione pero `\b` no: el código no lanza error, simplemente matchea nunca).

### Transcripción de notas de voz (SpeakApp)
- Flujo: `open` (abrir chat) → `transcribe`. El audio sale de la PC a speakapp.com; la pestaña
  de destino se abre en background y se cierra sola al terminar.
- **Cómo se obtiene el audio (sin reproducir la nota, en este orden):**
  1. `<audio>` con `src` blob: (MIME `audio/ogg; codecs=opus`) — sólo si la nota ya se descargó.
  2. **Cache Storage** `lru-media-array-buffer-cache`: WhatsApp decodifica el opus para pintar
     el waveform y cache-a los bytes desencriptados; le hace match por duración (±2 s) con la
     nota visible. El sender **no** verá la nota como reproducida.
  3. Play como último recurso (marca la nota como escuchada — el usuario lo aceptó; se pausa
     apenas arranca y se mutea).
- `src/tools/speakapp.js` abre `https://speakapp.com/t/tools/es/transcripcion-mensaje-voz-whatsapp`
  en una pestaña background (`Target.createTarget background:true`) y desde adentro evalúa un script
  que decodifica el audio (`decodeAudioData` + `OfflineAudioContext` a 16 kHz mono), arma un WAV
  PCM 16-bit y hace `POST /t/api/transcribe-demo?pageId=tools-default`. El `window.fetch` de esa
  página está parcheado por su propio JS para meter los headers `x-is-human` del challenge
  anti-bot → **sólo funciona llamado desde adentro de la página** (un fetch directo devuelve 403).
- **Límites del endpoint tools-default**: **80 s de audio por nota** (más largo → `duration_exceeded`)
  y **5 solicitudes/hora** (`x-ratelimit-*`, 429 al pasarse). Español + 50 idiomas (autodetect).
- Respuesta JSON `{ segments, language, text }`. Si el contexto se destruye justo al evaluar
  (la página aún termina navegación), `speakappTranscribe` reintenta una vez tras 1.5 s.
- Antes existía un backend Voqua (3/día); se eliminó por SpeakApp (mejor cupo y sin cambios de UI).


