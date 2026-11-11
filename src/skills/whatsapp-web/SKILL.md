---
name: whatsapp-web
description: Opera WhatsApp Web (Brave con --remote-debugging-port=9222) a través de la tool whatsapp_web — abre chats, lee mensajes, envía texto, transcribe notas de voz. Úsala cuando el usuario pide navegar, leer, escribir o transcribir en WhatsApp Web.
---

# WhatsApp Web

Tool única para controlar WhatsApp Web (la pestaña abierta en Brave vía CDP). El browser tiene
que estar lanzado con `--remote-debugging-port=9222` (ver NOTES.md §8).

## ¿Cuándo usar?

- El usuario pide listar chats, abrir un chat, leer mensajes, enviar mensajes o transcribir notas de voz.
- El usuario pide "ver qué mandaron", "responder X", "transcribir el audio de Y".

## Reglas

- **Antes de enviar cualquier mensaje, pedile confirmación explícita al usuario** (y mostrá
  el texto exacto y el destino exacto). El usuario es la autoridad de qué se manda y a quién.
- **Paso obligatorio de confirmación**: `send` y `send-to` sin `confirmed:true` devuelven un
  preview y no envían nada. Usá `confirmed:true` únicamente cuando el usuario ya aprobó en el
  chat, con palabras claras ("enviá", "mandá", "ok, reenviá"), el texto exacto y el destino.
- **Nunca** uses `click`, `fill` o `send` para reenviar un audio/mensaje de un chat a otro:
  el envío tiene que pasar por `send`/`send-to` con la confirmación de arriba.
- **Nunca reportes "quién dijo" inventando ni por contexto visual**: usá el `sender`, el
  `timestamp` y, si es una respuesta, el `replyTo` que devuelven `read` y `transcribe`.
  El remitente citado dentro de un quote NO es el remitente del mensaje. Si vienen como
  "desconocido", decilo así.
- Si el usuario nombra un chat (por ejemplo "el grupo Kancer"), pasá siempre `chatName` a
  `read`, `message`, `transcribe` o `extract-audio` para que la tool abra y verifique ese chat exacto;
  no trabajes sobre el chat que quedó abierto de antes.
- "Mensaje" es un concepto genérico: puede ser texto o audio. "Audio" es específico: solo nota de voz.
- Si el usuario pide "el último mensaje" (o "un mensaje"), usá `message`, no `transcribe`.
  Actúa según el `type` que devuelva:
  - `type="text"` → devolvé el texto con `sender`, `time` y `replyTo` si viene.
  - `type="audio"` → avisá que es una nota de voz y usá `transcribe` con confirmación por el envío a SpeakApp.
  - `type="image"`/`"other"` → describí lo que se ve y no inventes contenido.
- Si el usuario pide "el último audio", usá `transcribe` (con `sender` si nombró a alguien) o
  `message` primero si querés confirmar que el último mensaje es realmente un audio.
- Si pide varios mensajes, usá `read`.
- Si el usuario pide "el audio de tal persona" o "quién dijo", usá el parámetro `sender`
  (por ejemplo `sender:"Aarón"`) en lugar de tomar ciegamente el último audio.
- Para informar un audio, usá siempre separadores (`|` o saltos de línea), nunca pegues
  remitente y destinatario sin espacio. Formato recomendado:
  `Audio de: <sender> | Respuesta a: <replyTo o "—"> | Hora: <time> | Grupo: <chat>` seguido del texto.
- **Nunca** abras chats o leas mensajes sin que el usuario lo pida.
- **Nunca** reproduzcas una nota de voz para "escucharla" sin permiso: la tool `whatsapp_web`
  con `action=transcribe` ya NO reproduce la nota (usa el Cache Storage del navegador donde
  WhatsApp decodifica el audio para el waveform). Si el audio no está en cache, el botón "Play"
  se usaría como fallback y **la nota quedaría marcada como escuchada** — avisá antes de transcribir.
- Límites del endpoint de transcripción (SpeakApp `tools-default`):
  - **80 s de audio por nota** (más largo → error).
  - **5 solicitudes/hora** por IP (429 al pasarse). Si se agota, avisá, no improvises con otro servicio.
- El audio se envía a un servidor tercero (speakapp.com) — acordate si el contenido es sensible.
- Si algo falla, **reportá el error tal cual** (paso, acción, argumentos, mensaje exacto) en vez
  de improvisar una segunda solución. Seguís las reglas del usuario: el reporte es mejor que un hack.
- Las notas de voz se identifican en el DOM como botones "Reproducir mensaje de voz" dentro de
  `[data-testid="msg-container"]`. No busques `<audio>`: sólo aparece tras reproducir/descargar.
- WhatsApp Web virtualiza la lista: no todos los chats están renderizados; `open` filtra con el
  buscador si no los encuentra en la lista visible.
- Scroll del chat: `action=scroll` con `dy` negativo sube (mensajes viejos); positivo baja.
- No toques selectores de Brave ni reinicies la sesión sin preguntar.

## Acciones

| action | Parámetros | Qué hace |
|---|---|---|
| `list` | — | Lista chats (nombre, último mensaje, hora, no leídos) |
| `open` | `chatName` | Abre el chat (re-busca en el buscador si no está visible) |
| `read` | `limit`, `chatName?`, `sender?` | Últimos N mensajes (+🎤/🖼️); verifica el chat si pasás `chatName` |
| `message` | `chatName?` | Último mensaje visible (texto o audio); incluye type, sender, time, replyTo. Alias compatible: `read-last` |
| `send` | `text`, `confirmed:true` | Envía texto tras confirmación; sin `confirmed` devuelve preview sin enviar |
| `send-to` | `chatName`, `text`, `confirmed:true` | Abre y envía tras confirmación; sin `confirmed` devuelve preview sin abrir ni enviar |
| `transcribe` | `chatName?`, `sender?`, `index` (0=última), `limit` | Transcribe y reporta `chat`, `sender`, `time` de cada nota |
| `extract-audio` | `chatName?`, `sender?`, `index` | Devuelve el blob en base64 + metadata; preferí `transcribe` |
| `search` | `chatName` | Enfoca el buscador |
| `scroll` | `dy` | Desplaza el chat |
| `status` | — | Chat abierto + estado del composer/buscador |
| `snapshot` / `click` / `fill` / `navigate` / `reload` | — | Escape hatches genéricos |

## Parámetros de la tool

- `action` (required, string): una de las acciones de arriba.
- `chatName` (string): nombre del chat (open/search/send-to; también read/message/transcribe/extract-audio). Si se pasa, la tool lo abre y verifica el header antes de operar.
- `text` (string): texto a enviar o rellenar.
- `limit` (number): mensajes/notas a leer (read/transcribe).
- `index` (number): 0 = última nota de voz, 1 = anterior…
- `sender` (string): filtra mensajes/notas por remitente (ej. `"Aarón"`); opcional.
- `confirmed` (boolean): `true` solo después de que el usuario aprobó explícitamente el texto y el destino. Sin esto, `send`/`send-to` no envían.
- `dy` (number): píxeles de scroll.
- `tabId` (string opcional): id de pestaña; por defecto la primera.

## Ejemplo

```
whatsapp_web({action:"open", chatName:"Kancer"})
whatsapp_web({action:"message", chatName:"Kancer"})
whatsapp_web({action:"read", chatName:"Kancer", limit:5})
whatsapp_web({action:"transcribe", chatName:"Kancer", index:0, limit:1})
# Si el usuario aprobó explícitamente: whatsapp_web({action:"send", text:"ok", confirmed:true})
```
