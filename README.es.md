# Renzo's Loom

Agente de coding con pestañas, contexto persistente, soporte de imágenes y **Agent Skills (formato estándar)**. Funciona con **múltiples API keys y proveedores** (OpenRouter, OpenAI, Anthropic, DeepSeek, Groq y más): la lista de modelos se arma desde *todas* tus llaves y cada modelo se llama con la llave que lo expone. Las skills enseñan al agente flujos reutilizables (debugging, TDD, code review, planning) bajo demanda.

> *¿Te la pasás usando agentes gratuitos porque no tenés un centavo partido a la mitad? Usá Renzo's Loom para no perder el hilo de la conversación!!!*

> 🌐 [English](README.md) · [Español](README.es.md)

## Instalación (para no desarrolladores)

**No necesitás la línea de comandos.** Andá a [Releases](../../releases), bajá el `.exe` para tu sistema (Windows: `Renzo's Loom Setup x.y.z.exe` para el instalador, o `Renzo's Loom x.y.z.exe` para el portable), hacé doble clic para instalarlo y abrí ⚙️ (Configuración) para agregar la API key.

## Instalación (para desarrolladores)

1. `npm install`
2. `npm start`
3. Al abrir la app, hacé clic en ⚙️ (Configuración) → **API Keys** → **＋ Agregar llave**:
   - elegí el **proveedor** (OpenRouter, OpenAI, Anthropic, DeepSeek, Groq, Together, Mistral, xAI, Google o uno personalizado),
   - el **endpoint** se completa solo (editálo si hace falta),
   - pegá tu **API key** y guardá.
   - Cada llave se puede **probar** (muestra cuántos modelos ve) y **borrar** con el botón 🗑.
   - Las llaves se guardan localmente en `sessions/_api_keys.json` (git-ignored, nunca se suben, nunca llegan al renderer: solo se muestra una versión enmascarada).

## Uso

- **Pestañas**: cada pestaña es una conversación independiente, con su propio historial y su propio modelo.
  `+` o `Ctrl+T` crea una nueva, `Ctrl+W` la cierra, `Ctrl+Tab` cambia de pestaña.
  **Doble clic en el nombre para renombrarla.** Si no la renombrás, toma el nombre del primer mensaje.
- Varias pestañas pueden estar respondiendo al mismo tiempo (punto naranja = respondiendo, punto azul = respuesta sin leer).
- **Cerrar una pestaña no la borra**: queda en 🗂️ *Conversaciones guardadas*, desde donde se reabre o se borra.
  Al abrir la app vuelven las pestañas que tenías abiertas.
  Si la pestaña estaba respondiendo, cerrarla también cancela la request o el comando en curso.
- **Modelos**: el selector del sidebar cambia el modelo de la pestaña activa. La lista está **agrupada por proveedor/llave**
  (un encabezado por llave, ej. `OpenRouter`, `DeepSeek`) y se actualiza sola al agregar o borrar una llave.
  Seis filtros de prestación combinables:
  👁️ visión · 🎤 audio · 🧠 razonamiento · 📄 PDF · 🌐 internet · 💰 gratis — más **una casilla por proveedor/llave**,
  todo recordado entre sesiones. El contador muestra cuántos modelos cumplen (ej. `12/340`).
  Íconos: 🔧 tools · 👁️ visión · 🎤 audio · 📄 PDF · 🧠 razonamiento · 🌐 internet · 💰 gratis.
  - 🌐 solo marca modelos con búsqueda web **nativa** del proveedor. El plugin `:online` de OpenRouter funciona con cualquier modelo,
    pero cuesta créditos incluso en modelos gratis, por eso no se marca.
  - Cada modelo se llama con la llave que lo expuso (se muestra junto al id en el sidebar). Si esa llave falla, se usa la primera disponible.
- **Contador de contexto**: junto al estado (ej. `34k/100k`) muestra cuánto del context window del modelo usa la
  conversación activa. Usa el número real de la API; con `~` es estimado (conversaciones reabiertas, o mensajes agregados
  desde la última respuesta). Se pone naranja al 80 % y rojo al 95 %.
- **Adjuntos**: 📎, arrastrar y soltar, o pegar con `Ctrl+V`. Imágenes y PDF viajan como adjuntos reales;
  el código/texto se inserta en el mensaje. Si adjuntás una imagen y el modelo no tiene visión,
  la pestaña cambia sola a uno que sí.
- El agente usa herramientas (leer/escribir archivos, ejecutar comandos, buscar). Los comandos corren sin bloquear las otras
  pestañas, no esperan input de teclado y se cancelan a los 120 s.
- **Seguir al agente**: la barra sobre el input muestra el paso actual, un cronómetro y el tiempo total, y se pone
  naranja/roja si un paso tarda demasiado. Con 🔍 *Detalle de pasos*, el chat también registra cada paso (tiempo del modelo,
  tokens, herramientas, reintentos). Los rate limits (429), errores de servidor y timeouts se reintentan solos (hasta 4
  intentos) con una cuenta regresiva visible.
- **Detener**: mientras el agente trabaja, *Enviar* pasa a ser un botón rojo **⏹ Detener** (o apretá `Esc` en el input). Cancela
  la request, la espera entre reintentos o el comando en curso. Lo ya hecho (archivos escritos, comandos corridos) **no**
  se deshace; al modelo se le dice que lo detuviste.
- Todo se guarda en `sessions/` (un JSON por conversación; imágenes en `<id>.assets/`; llaves en `_api_keys.json`).
- **Skills (v0.5.0)**: Agent Skills estándar — una carpeta por skill con su `SKILL.md` (frontmatter `name` + `description`). Trae 21 bundled (5 propios + 10 de [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) + 6 de [obra/superpowers](https://github.com/obra/superpowers), todos MIT, curados para las tools de Loom). Sumá las tuyas en `%APPDATA%/Renzo's Loom/skills/` (fuera del `.exe`, se autogenera, gana sobre bundled en choque de nombre). Configuración ⚙️ → **Skills**: muestra el path, **📁 Abrir carpeta de skills** y **↻ Recargar skills**. El agente ve un catálogo barato (name+description) y carga el `SKILL.md` completo bajo demanda con `read_file`. Detalle en `src/skills/README.md`.
- **Compartir (v0.6.0)**: 📤 junto a ⚙️ exporta la pestaña activa como ZIP (`*.md` + `*.json` + `assets/`).
- **Scoring (v0.6.0)**: cada modelo lleva un score jack-of-all-trades (heurística por familia, sin API externa). El desplegable lo muestra inline por prestación, ordenado mejor-primero, y las pestañas nuevas usan el mejor balance.
- **Browser (v0.7.0)**: tool `browser` (CDP contra Brave con `--remote-debugging-port=9222`).
- **WhatsApp Web (unreleased)**: `whatsapp_web` — una sola tool para automatizar WhatsApp Web (`list`/`open`/`read`/`send`/`send-to`/`search`/`scroll`/`status`/`transcribe`/`extract-audio`). Las notas de voz se transcriben a texto (gratis, hasta 5/hora y 80 s de audio, vía SpeakApp — el audio sale a un servidor tercero). Ver CHANGELOG.

## Créditos

- Hecho con el mismo agente de coding con el que estás hablando — **Loom es el agente que te ayuda a construir Loom.**
- Skills: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) y [obra/superpowers](https://github.com/obra/superpowers) (MIT, ver `src/skills/THIRD-PARTY-NOTICES.md`).

## Ícono

`src/assets/icon.png` y `src/assets/icon.ico`. Al correr con `npm start` cambia el ícono de la ventana y de la barra de tareas;
el ícono del `.exe` solo cambia al empaquetar (por ejemplo con electron-builder, usando `src/assets/icon.ico`).

## Soporte

> *Hubiera puesto un medio de donaciones, pero era demasiado esfuerzo.*

Si querés apoyar el proyecto, en el futuro puede aparecer un link de donación acá.

Detalles técnicos para quien toque el código: `src/NOTES.md`.
