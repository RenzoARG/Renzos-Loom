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
  el texto exacto). El usuario es la autoridad de qué se manda y a quién.
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
| `read` | `limit` (default 10) | Últimos N mensajes del chat abierto (+🎤/🖼️) |
| `send` | `text` | Envía texto en el chat abierto |
| `send-to` | `chatName`, `text` | Abre el chat y envía (confirmar antes) |
| `transcribe` | `index` (0=última), `limit` | Transcribe notas de voz con SpeakApp |
| `extract-audio` | `index` | Devuelve el blob en base64 (~costoso en tokens; preferí `transcribe`) |
| `search` | `chatName` | Enfoca el buscador |
| `scroll` | `dy` | Desplaza el chat |
| `status` | — | Chat abierto + estado del composer/buscador |
| `snapshot` / `click` / `fill` / `navigate` / `reload` | — | Escape hatches genéricos |

## Parámetros de la tool

- `action` (required, string): una de las acciones de arriba.
- `chatName` (string): nombre del chat (open/search/send-to).
- `text` (string): texto a enviar o rellenar.
- `limit` (number): mensajes/notas a leer (read/transcribe).
- `index` (number): 0 = última nota de voz, 1 = anterior…
- `dy` (number): píxeles de scroll.
- `tabId` (string opcional): id de pestaña; por defecto la primera.

## Ejemplo

```
whatsapp_web({action:"open", chatName:"TiendaSucursal"})
whatsapp_web({action:"read", limit:5})
whatsapp_web({action:"transcribe", index:0, limit:1})
```
