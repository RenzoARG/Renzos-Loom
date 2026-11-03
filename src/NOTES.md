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
