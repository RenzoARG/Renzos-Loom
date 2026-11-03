# Renzo's Loom

Agente de coding con pestañas, contexto persistente y soporte de imágenes, usando OpenRouter como proveedor.

> 🌐 [English](README.md) · [Español](README.es.md)

## El tono

> *¿Te la pasás usando agentes gratuitos porque no tenés un centavo partido a la mitad? Usá Renzo's Loom para no perder el hilo de la conversación!!!*

## Instalación

1. `npm install`
2. `npm start`
3. Al abrir la app, hacé clic en ⚙️ (Configuración) y pegá tu API key de OpenRouter. Se guarda localmente (no se usa `.env`).
   - (Opcional, legacy) También podés usar `.env` con `OPENROUTER_API_KEY` y `MODEL`.

## Uso

- **Pestañas**: cada pestaña es una conversación independiente, con su propio historial y su propio modelo.
  `+` o `Ctrl+T` crea una nueva, `Ctrl+W` la cierra, `Ctrl+Tab` cambia de pestaña.
  **Doble clic en el nombre para renombrarla.** Si no la renombrás, toma el nombre del primer mensaje.
- Varias pestañas pueden estar respondiendo al mismo tiempo (punto naranja = respondiendo, punto azul = respuesta sin leer).
- **Cerrar una pestaña no la borra**: queda en 🗂️ *Conversaciones guardadas*, desde donde se reabre o se borra.
  Al abrir la app vuelven las pestañas que tenías abiertas.
- **Modelos**: el selector del sidebar cambia el modelo de la pestaña activa. Filtros *Solo con visión* y *Solo gratis*.
  Íconos: 🔧 tools · 👁️ visión · 🎤 audio · 🧠 razonamiento · 💰 gratis.
- **Adjuntos**: 📎, arrastrar y soltar, o pegar con `Ctrl+V`. Imágenes y PDF viajan como adjuntos reales;
  el código/texto se inserta en el mensaje. Si adjuntás una imagen y el modelo no tiene visión,
  la pestaña cambia sola a uno que sí.
- El agente usa herramientas (leer/escribir archivos, ejecutar comandos, buscar).
- Todo se guarda en `sessions/` (un JSON por conversación; las imágenes en `<id>.assets/`).

## Ícono

`src/assets/icon.png` y `src/assets/icon.ico`. Al correr con `npm start` cambia el ícono de la ventana y de la barra de tareas;
el ícono del `.exe` solo cambia al empaquetar (por ejemplo con electron-builder, usando `src/assets/icon.ico`).

## Soporte

> *Hubiera puesto un link para aceptar donaciones, porque algún día quiero pagar por mis tokens con mis ideas.*

Si querés apoyar el proyecto, en el futuro puede aparecer un link de donación acá.

Detalles técnicos para quien toque el código: `src/NOTES.md`.
