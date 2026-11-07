# Renzo's Loom

Coding agent with tabs, persistent context, image support and **Agent Skills (standard format)**. Works with **multiple API keys and providers** (OpenRouter, OpenAI, Anthropic, DeepSeek, Groq and more) — the model list is built from *all* your keys, and each model is called through the key that exposes it. Skills teach the agent reusable workflows (debugging, TDD, code review, planning) on demand.

> *Are you stuck using free agents because you don't have a dime to spare? Use Renzo's Loom so you never lose the thread of the conversation!!!*

> 🌐 [English](README.md) · [Español](README.es.md)

![Electron](https://img.shields.io/badge/Electron-33-blue) ![OpenRouter](https://img.shields.io/badge/OpenRouter-supported-green) ![Agent Skills](https://img.shields.io/badge/Agent%20Skills-standard-green)

## Installation (non-developers)

**You don't need the command line.** Just go to [Releases](../../releases), download the `.exe` for your system (Windows: `Renzo's Loom Setup x.y.z.exe` for the installer, or `Renzo's Loom x.y.z.exe` for the portable), and double-click it. Then open ⚙️ (Settings) and add your API key(s).

## Installation (developers)

1. `npm install`
2. `npm start`
3. When the app opens, click ⚙️ (Settings) → **API Keys** → **＋ Add key**:
   - pick the **provider** (OpenRouter, OpenAI, Anthropic, DeepSeek, Groq, Together, Mistral, xAI, Google, or a custom one),
   - the **endpoint** is filled in automatically (edit it if needed),
   - paste your **API key** and save.
   - You can **test** each key (shows how many models it sees) and **delete** it with the 🗑 button.
   - Keys are stored locally in `sessions/_api_keys.json` (git-ignored, never committed, never sent to the renderer — only a masked preview is shown).

## Usage

- **Tabs**: each tab is an independent conversation, with its own history and its own model.
  `+` or `Ctrl+T` creates a new one, `Ctrl+W` closes it, `Ctrl+Tab` switches tabs.
  **Double-click the tab name to rename it.** If you don't rename it, it takes the name of the first message.
- Several tabs can be responding at the same time (orange dot = responding, blue dot = unread reply).
- **Closing a tab doesn't delete it**: it goes to 🗂️ *Saved conversations*, from where it can be reopened or deleted.
  When you reopen the app, the tabs you had open come back.
  If the tab was still responding, closing it also cancels the request or command in progress.
- **Models**: the sidebar selector changes the model of the active tab. The list is **grouped per provider/key**
  (one section header per key, e.g. `OpenRouter`, `DeepSeek`) and automatically refreshed when you add or delete a key.
  Six feature filters that can be combined:
  👁️ vision · 🎤 audio · 🧠 reasoning · 📄 PDF · 🌐 internet · 💰 free — plus **one checkbox per provider/key**,
  also remembered between sessions. The counter shows how many models match (for example `12/340`).
  Icons: 🔧 tools · 👁️ vision · 🎤 audio · 📄 PDF · 🧠 reasoning · 🌐 internet · 💰 free.
  - 🌐 only marks models with the provider's **native** web search. OpenRouter's `:online` plugin works with any model,
    but it costs credits even on free models, so it is not marked.
  - Each model is called through the key that exposed it (shown next to the model id in the sidebar). If that key fails, the app falls back to the first available key.
- **Context counter**: next to the status (for example `34k/100k`) it shows how much of the model's context window the
  active conversation uses. It uses the real figure returned by the API; with a `~` it is an estimate (reopened
  conversations, or messages added since the last response). It turns orange at 80 % and red at 95 %.
- **Attachments**: 📎, drag & drop, or paste with `Ctrl+V`. Images and PDFs travel as real attachments;
  code/text is inserted into the message. If you attach an image and the model has no vision,
  the tab switches by itself to one that does.
- The agent uses tools (read/write files, run commands, search text). Commands run without blocking the other tabs,
  can't wait for keyboard input, and are cancelled after 120 s.
- **Following the agent**: the bar above the input shows the current step, a stopwatch and the total time, and turns
  orange/red when a step takes too long. With 🔍 *Step details* on, the chat also logs each step (model time, tokens,
  tools, retries). Rate limits (429), server errors and timeouts are retried automatically (up to 4 attempts) with a
  visible countdown.
- **Stop**: while the agent is working, *Send* becomes a red **⏹ Stop** button (or press `Esc` in the input). It cancels
  the request, the retry wait or the running command. What was already done (files written, commands run) is **not
  undone**; the model is told that you stopped it.
- Everything is saved in `sessions/` (one JSON per conversation; images in `<id>.assets/`; API keys in `_api_keys.json`).
- **Skills (v0.5.0)**: standard Agent Skills — one folder per skill with a `SKILL.md` (`name` + `description` frontmatter). Ships with 20 bundled skills (4 own + 10 from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) + 6 from [obra/superpowers](https://github.com/obra/superpowers), all MIT, curated for Loom's tools). Add your own in `%APPDATA%/Renzo's Loom/skills/` (outside the `.exe`, auto-created, wins over bundled on name clash). Settings ⚙️ → **Skills** shows the path, **📁 Open skills folder** and **↻ Reload skills**. The agent sees a cheap catalog (name + description) and loads the full `SKILL.md` on demand via `read_file`. Details in `src/skills/README.md`.
- **Sharing (v0.6.0)**: 📤 next to ⚙️ exports the active tab as a ZIP (`*.md` + `*.json` + `assets/`).
- **Model scoring (v0.6.0)**: every model carries a jack-of-all-trades score (heuristic by family, no external API). The dropdown shows it inline per cap, sorted best-first, and new tabs default to the best balance.

## Icon

`src/assets/icon.png` and `src/assets/icon.ico`. When running with `npm start` the window and taskbar icon change;
the `.exe` icon only changes when packaging (for example with electron-builder, using `src/assets/icon.ico`).

## Credits

- Built with the same coding agent that you are chatting with — **Loom is the agent that helps you build Loom.**
- Skills: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) and [obra/superpowers](https://github.com/obra/superpowers) (MIT, see `src/skills/THIRD-PARTY-NOTICES.md`).

## Support

> *I would've set up a donation method, but it was too much effort.*


If you'd like to support the project, a donation link may appear here in the future.

Technical details for anyone touching the code: `src/NOTES.md`.
