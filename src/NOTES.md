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
