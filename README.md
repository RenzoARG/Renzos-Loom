# Renzo's Loom

Coding agent with tabs, persistent context and image support, using OpenRouter as the provider.

> *Are you stuck using free agents because you don't have a dime to spare? Use Renzo's Loom so you never lose the thread of the conversation!!!*

> 🌐 [English](README.md) · [Español](README.es.md)

## Installation

1. `npm install`
2. `npm start`
3. When the app opens, click ⚙️ (Settings) and paste your OpenRouter API key. It is stored locally (no `.env` needed).
   - (Optional, legacy) You can still use `.env` with `OPENROUTER_API_KEY` and `MODEL`.

## Usage

- **Tabs**: each tab is an independent conversation, with its own history and its own model.
  `+` or `Ctrl+T` creates a new one, `Ctrl+W` closes it, `Ctrl+Tab` switches tabs.
  **Double-click the tab name to rename it.** If you don't rename it, it takes the name of the first message.
- Several tabs can be responding at the same time (orange dot = responding, blue dot = unread reply).
- **Closing a tab doesn't delete it**: it goes to 🗂️ *Saved conversations*, from where it can be reopened or deleted.
  When you reopen the app, the tabs you had open come back.
- **Models**: the sidebar selector changes the model of the active tab. Filters *Vision only* and *Free only*.
  Icons: 🔧 tools · 👁️ vision · 🎤 audio · 🧠 reasoning · 💰 free.
- **Attachments**: 📎, drag & drop, or paste with `Ctrl+V`. Images and PDFs travel as real attachments;
  code/text is inserted into the message. If you attach an image and the model has no vision,
  the tab switches by itself to one that does.
- The agent uses tools (read/write files, run commands, search text).
- Everything is saved in `sessions/` (one JSON per conversation; images in `<id>.assets/`).

## Icon

`src/assets/icon.png` and `src/assets/icon.ico`. When running with `npm start` the window and taskbar icon change;
the `.exe` icon only changes when packaging (for example with electron-builder, using `src/assets/icon.ico`).

## Support

> *I would've set up a donation method, but it was too much effort.*

If you'd like to support the project, a donation link may appear here in the future.

Technical details for anyone touching the code: `src/NOTES.md`.
