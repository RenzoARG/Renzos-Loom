import { spawn } from "child_process";
import fs from "fs";
import WebSocket from "ws";
import { speakappTranscribe } from "./speakapp.js";

// Control del navegador de la PC vía CDP (Chrome DevTools Protocol).
// Brave/Chrome necesitan lanzarse con --remote-debugging-port=9222 para exponer el puerto.

const CDP_HOST = process.env.LOOM_CDP_HOST || "127.0.0.1";
const CDP_PORT = Number(process.env.LOOM_CDP_PORT || 9222);
export { CDP_HOST, CDP_PORT };
const BRAVE_PATHS = process.platform === "win32"
  ? [process.env.PROGRAMFILES + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
     process.env["PROGRAMFILES(X86)"] + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
     process.env.LOCALAPPDATA + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"]
  : ["/usr/bin/brave", "/opt/brave-bin/brave"];
let spawnedBrave = false;

export async function cdpList() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return await res.json();
}

function braveExe() {
  return BRAVE_PATHS.find((p) => p && fs.existsSync(p));
}

export function cdpCallRaw(target, method, params = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP timeout " + method)); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(msg.result);
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP error " + method)); };
  });
}

export function cdpEval(target, expr, timeoutMs = 15_000) {
  return cdpCallRaw(target, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs);
}

async function cdpMouseClick(target, x, y) {
  await cdpCallRaw(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await cdpCallRaw(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdpCallRaw(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

export async function browserTool(args, signal) {
  const action = args.action;
  let targets;
  try {
    targets = await cdpList();
  } catch (e) {
    try {
      const exe = braveExe();
      if (exe && !spawnedBrave) {
        spawnedBrave = true;
        const child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, "--profile-directory=Default", "about:blank"], { detached: true, stdio: "ignore" });
        child.unref();
        await new Promise((r) => setTimeout(r, 3_000));
        targets = await cdpList();
      }
    } catch { /* cae al error de abajo */ }
    if (!targets) return `Error: no hay navegador con CDP en ${CDP_HOST}:${CDP_PORT}. Iniciá Brave con --remote-debugging-port=${CDP_PORT}`;
  }
  const pages = (targets || []).filter((t) => t.type === "page");

  if (action === "list") {
    return pages.map((p, i) => `${i + 1}. "${p.title || "(sin título)"}" — ${p.url} [${p.id}]`).join("\n") || "(sin pestañas de página)";
  }

  if (action === "close") {
    // CDP /json/close funciona con PUT (no GET): reintentar con PUT ante GET no-ok. Verificar con list.
    const t = pick();
    if (!t?.id) return "Error: pestaña no encontrada (usá action:list primero)";
    const title = t.title;
    const url = t.url;
    const tryClose = async (method) => {
      const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${t.id}`, { method, signal: AbortSignal.timeout(5_000) });
      const body = await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, body };
    };
    let r;
    try { r = await tryClose("GET"); } catch (e) { return `Error al cerrar: ${e.message} (tab ${t.id})`; }
    if (!r.ok) {
      try { r = await tryClose("PUT"); } catch (e) { return `Error al cerrar (PUT): ${e.message}`; }
    }
    if (r.ok || /closing/i.test(r.body)) {
      // Verificar con list, no asumir
      try {
        const after = await cdpList();
        const gone = !after.some((x) => x.id === t.id);
        return gone ? `Pestaña cerrada: "${title}" — ${url}` : `Close no confirmado: "${title}" (sigue en list)`;
      } catch {
        return `Pestaña cerrada: "${title}" — ${url} (no se pudo verificar)`;
      }
    }
    return `Error: CDP /json/close HTTP ${r.status} ${r.body?.slice(0, 120)} (tab ${t.id})`;
  }

  if (action === "close-by-pattern") {
    // Atajo: busca por substring en título/URL y cierra la primera que matchea. Solo esa.
    const pat = String(args.pattern || args.chatName || "").toLowerCase();
    if (!pat) return "Error: falta pattern";
    const t = pages.find((p) => (p.title || "").toLowerCase().includes(pat) || (p.url || "").toLowerCase().includes(pat));
    if (!t?.id) return `no encontrado: pattern "${pat}" (pestañas: ${pages.length})`;
    const title = t.title;
    let r;
    try { r = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${t.id}`, { method: "PUT", signal: AbortSignal.timeout(5_000) }); } catch (e) { return `Error: ${e.message}`; }
    const body = await r.text().catch(() => "");
    if (r.ok || /closing/i.test(body)) {
      try {
        const after = await cdpList();
        const gone = !after.some((x) => x.id === t.id);
        return gone ? `Pestaña cerrada por pattern: "${title}"` : `Close no confirmado: "${title}" (sigue en list)`;
      } catch { return `Pestaña cerrada: "${title}"`; }
    }
    return `Error: /json/close PUT HTTP ${r.status} ${body.slice(0, 120)}`;
  }

  if (action === "navigate") {
    const t = pick();
    if (!t?.id) return "Error: pestaña no encontrada (usá action:list primero)";
    const url = String(args.url || "");
    if (!/^https?:|^about:blank/.test(url)) return "Error: url inválida (usá http(s) o about:blank)";
    const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${url}`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return `Error: /json/new HTTP ${res.status}`;
    const j = await res.json().catch(() => ({}));
    return `Navegada a ${url} [${j.id || t.id}]`;
  }

  if (action === "reload") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    await cdpCallRaw(t, "Page.reload", {});
    return `Recargada: "${t.title}" — ${t.url}`;
  }

  if (action === "scroll") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const dy = Number(args.dy ?? args.deltaY ?? 600);
    await cdpCallRaw(t, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 300, deltaX: 0, deltaY: dy, button: "none" });
    return `Scroll ${dy > 0 ? "↓" : "↑"} ${Math.abs(dy)}px`;
  }

  if (action === "extract-text") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const maxChars = Number(args.maxChars || 4000);
    const r = await cdpEval(t, `(() => {
      const links = [...document.querySelectorAll('a')].slice(0, 40).map((a) => {
        const txt = (a.innerText || a.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120);
        return txt ? "- " + txt + " -> " + a.href.slice(0, 120) : null;
      }).filter(Boolean);
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 20).map((h) => h.innerText.trim().replace(/\\s+/g, " ").slice(0, 120)).filter(Boolean);
      const body = (document.body.innerText || "").slice(0, ${maxChars});
      return "Título: " + document.title + "\\nURL: " + location.href + "\\n\\n--- headings ---\\n" + headings.join("\\n") + "\\n\\n--- texto ---\\n" + body + "\\n\\n--- links ---\\n" + links.join("\\n");
    })()`);
    return String(r?.result?.value || "(vacío)");
  }

  const pick = () => {
    const id = args.tabId;
    if (id) return pages.find((p) => p.id === id || String(p.id).startsWith(id));
    return pages[0];
  };

  if (action === "activate") {
    const t = pick();
    if (!t?.id) return "Error: pestaña no encontrada (usá action:list primero)";
    try {
      await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${t.id}`, { signal: AbortSignal.timeout(5_000) });
      return `Pestaña enfocada: "${t.title}" — ${t.url}`;
    } catch (e) {
      return `Error al enfocar: ${e.message} (tab ${t.id})`;
    }
  }

  // WhatsApp Web virtualiza la lista lateral: no todos los chats están renderizados.
  // 1) busca en las celdas visibles; 2) escribe en el buscador, filtra y re-busca;
  // 3) limpia el buscador para no dejar la lista filtrada.
  async function findAndClickChat(t, name) {
    const r = await cdpEval(t, `(() => {
      const name = ${JSON.stringify(String(name).toLowerCase())};
      const cells = [...document.querySelectorAll('[data-testid="cell-frame-container"]')];
      for (const c of cells) {
        const titleEl = c.querySelector('[data-testid="cell-frame-title"] span[title]') || c.querySelector('[data-testid="cell-frame-title"]');
        const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").toLowerCase();
        if (title.includes(name)) {
          c.scrollIntoView({ block: "center" });
          const b = c.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2, title };
        }
      }
      return null;
    })()`);
    const pt = r?.result?.value;
    if (!pt) return null;
    await cdpMouseClick(t, pt.x, pt.y);
    return pt.title;
  }

  const isConfirmed = (a) => a?.confirmed === true || a?.confirm === true;
  const getChatHeader = async (t) => {
    const h = await cdpEval(t, `(() => document.querySelector('[data-testid="conversation-info-header-chat-title"]')?.textContent || document.querySelector('header span[title]')?.getAttribute("title") || "")()`);
    return String(h?.result?.value || "").trim();
  };
  async function openAndVerifyChat(t, name) {
    const chatRes = await browserTool({ action: "whatsapp-chat", chatName: name, tabId: t.id });
    if (!chatRes.startsWith("ok")) return { ok: false, message: chatRes };
    await new Promise((r) => setTimeout(r, 800));
    const header = await getChatHeader(t);
    if (!header.toLowerCase().includes(name.toLowerCase())) {
      return { ok: false, message: `abortado: header es "${header}", esperado "${name}" (no toqué nada)` };
    }
    return { ok: true, chatRes, header };
  }

  async function clearSearchInput(t) {
    await cdpEval(t, `(() => {
      const input = document.querySelector('#side input') || document.querySelector('[data-testid="search-input"]') || document.querySelector('input[placeholder*="Buscar"]') || document.querySelector('input[placeholder*="Search"]');
      if (input) { input.focus(); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); input.dispatchEvent(new Event("input", { bubbles: true })); }
    })()`);
  }

  if (action === "whatsapp-chat") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const name = String(args.chatName || "").trim();
    if (!name) return "Error: falta chatName";
    // 1) lista visible
    let found = await findAndClickChat(t, name);
    if (found) return "ok: " + found;
    // 2) filtrar con el buscador y reintentar
    const sr = await cdpEval(t, `(() => {
      const input = document.querySelector('#side input') || document.querySelector('[data-testid="search-input"]') || document.querySelector('input[placeholder*="Buscar"]') || document.querySelector('input[placeholder*="Search"]');
      if (!input) return "no-search-input";
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(name)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()`);
    if (String(sr?.result?.value || "") !== "ok") return `no encontrado: ${name} (ni en la lista ni en el buscador)`;
    await new Promise((r) => setTimeout(r, 700));
    found = await findAndClickChat(t, name);
    // 3) limpiar el buscador
    await clearSearchInput(t);
    if (!found) return `no encontrado: ${name}`;
    return "ok: " + found;
  }

  if (action === "whatsapp-send") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const rawText = String(args.text || "");
    if (!isConfirmed(args)) {
      const header = await getChatHeader(t);
      return `No enviado. Preview para "${header || "chat abierto"}":\n${rawText}\nPara enviar, pedile confirmación explícita al usuario y volvé a llamar con confirmed:true.`;
    }
    const text = rawText.replace(/`/g, "\\`").replace(/\$/g, "\\$");
    // Mismo selector que el snapshot: footer [contenteditable='true'] (Composer: OK). Sin primer intento fallido.
    const r = await cdpEval(t, `(() => {
      const boxes = document.querySelectorAll("[contenteditable='true']");
      const box = document.querySelector('#main footer [contenteditable="true"]')
        || document.querySelector('[data-testid="conversation-compose-box-input"]')
        || boxes[boxes.length - 1];
      if (!box) return "no encontrado composer";
      box.focus();
      const before = (box.textContent || "").trim();
      if (before.includes(\`${text}\`.slice(0, 12))) return "ya-escrito";
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, \`${text}\`);
      return "escrito";
    })()`);
    const wr = String(r?.result?.value || "");
    if (wr !== "escrito" && wr !== "ya-escrito") return wr || "no encontrado composer";
    // 1) Pedir coordenadas del botón Enviar (click real por coordenadas, no .click() — WhatsApp ignora el sintético)
    const pt = await cdpEval(t, `(() => {
      const send = document.querySelector('button[aria-label="Enviar"]') || document.querySelector('button[aria-label="Send"]') || document.querySelector('[data-testid="send"]') || document.querySelector('span[data-icon="send"]');
      if (!send) return null;
      const b = send.getBoundingClientRect();
      return { x: b.left + b.width/2, y: b.top + b.height/2 };
    })()`);
    const coord = pt?.result?.value;
    if (coord) await cdpMouseClick(t, coord.x, coord.y);
    else {
      // Fallback: Enter por CDP Input (no KeyboardEvent sintético)
      await cdpCallRaw(t, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdpCallRaw(t, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
    const s = await cdpEval(t, `(() => {
      const box = document.querySelector('#main footer [contenteditable="true"]');
      const left = box ? (box.textContent || "").trim() : "";
      return left ? "faló: quedó '" + left + "' en el composer" : "ok: enviado";
    })()`);
    return String(s?.result?.value || "ok");
  }

  if (action === "whatsapp-send-to") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const name = String(args.chatName || "").trim();
    if (!name) return "Error: falta chatName";
    const rawText = String(args.text || "");
    if (!isConfirmed(args)) {
      return `No enviado. Preview para "${name}":\n${rawText}\nPara enviar, pedile confirmación explícita al usuario y volvé a llamar con confirmed:true.`;
    }
    try { await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${t.id}`, { signal: AbortSignal.timeout(5_000) }); } catch {}
    const opened = await openAndVerifyChat(t, name);
    if (!opened.ok) return opened.message;
    const sent = await browserTool({ action: "whatsapp-send", text: rawText, tabId: t.id, confirmed: true });
    return `${opened.chatRes} | ${sent}`;
  }

  if (action === "inspect") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const selector = String(args.selector || "").replace(/"/g, '\\"');
    if (!selector) return "Error: falta selector";
    const r = await cdpEval(t, `(() => {
      const el = document.querySelector("${selector}");
      if (!el) return "no encontrado";
      const b = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), className: el.className, id: el.id, testid: el.getAttribute("data-testid"), role: el.getAttribute("role"), text: (el.innerText || el.textContent || "").slice(0, 200), bbox: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }, parent: el.parentElement ? el.parentElement.tagName + " " + (el.parentElement.className || "").slice(0, 80) : null };
    })()`);
    const v = r?.result?.value;
    return v ? JSON.stringify(v, null, 2) : "no encontrado";
  }

  if (action === "snapshot") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const r = await cdpEval(t, `(() => {
      const header = document.querySelector('[data-testid="conversation-info-header-chat-title"]')?.textContent || document.querySelector('header span[title]')?.getAttribute("title") || "";
      const composer = document.querySelector('#main footer [contenteditable="true"]');
      const msgs = [...document.querySelectorAll('#main div[data-testid="msg-container"]')].slice(-5).map((m) => (m.innerText || "").slice(0, 400));
      const els = [...document.querySelectorAll('button,[contenteditable="true"],input[placeholder]')].slice(0, 25);
      const list = els.map((el, i) => {
        const tag = el.tagName.toLowerCase();
        const txt = (el.getAttribute("aria-label") || el.innerText || el.placeholder || "").slice(0, 60).replace(/\\s+/g, " ");
        return i + ": <" + tag + "> " + txt;
      });
      return "Chat: " + header + "\\nComposer: " + (composer ? "OK" : "no") + "\\n--- últimos mensajes ---\\n" + msgs.join("\\n---\\n") + "\\n--- interactuables ---\\n" + list.join("\\n");
    })()`);
    return String(r?.result?.value || "(vacío)");
  }

  if (action === "click" || action === "fill" || action === "send") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const selector = String(args.selector || "").replace(/"/g, '\\"');
    if (!selector) return "Error: falta selector";
    if (action === "click") {
      const r = await cdpEval(t, `(() => { const el = document.querySelector("${selector}"); if (!el) return "no encontrado: ${selector}"; el.scrollIntoView(); el.click(); return "ok: " + (el.innerText || el.id || el.tagName); })()`);
      return String(r?.result?.value || "ok");
    }
    const text = String(args.text || "").replace(/`/g, "\\`").replace(/\$/g, "\\$");
    if (action === "fill") {
      const r = await cdpEval(t, `(() => { const el = document.querySelector("${selector}"); if (!el) return "no encontrado: ${selector}"; el.focus(); el.value = \`${text}\`; el.dispatchEvent(new Event("input", {bubbles:true})); return "ok"; })()`);
      return String(r?.result?.value || "ok");
    }
    const r = await cdpEval(t, `(() => {
      const el = document.querySelector("${selector}");
      if (!el) return "no encontrado: ${selector}";
      el.focus();
      el.value = \`${text}\`;
      el.dispatchEvent(new Event("input", {bubbles:true}));
      const btn = document.querySelector("${String(args.sendSelector || "").replace(/"/g, '\\"')}") ;
      if (btn) { btn.click(); return "ok: enviado con botón"; }
      el.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true}));
      return "ok: Enter";
    })()`);
    return String(r?.result?.value || "ok");
  }

  // ---- helpers de notas de voz (compartidos entre transcribe y extract-audio)
  // WhatsApp Web guarda el audio descifrado en un <audio> con src tipo blob: (audio/ogg;
  // codecs=opus) SOLO DESPUÉS de descargarlo. Si la nota nunca se descargó, el <audio>
  // existe pero su src está vacío: hay que clickear el botón de descarga de ESA nota y
  // esperar a que cargue (esto descarga el archivo; NO marca la nota como reproducida).
  async function voiceNoteSrcs(t) {
    const r = await cdpEval(t, `(() => {
      const containers = [...document.querySelectorAll('[data-testid="msg-container"]')];
      const notes = [];
      for (const c of containers) {
        const audio = c.querySelector('audio');
        const play = c.querySelector('[data-testid="audio-play"], [data-testid="audio-pause"], [aria-label="Play voice message"], [aria-label="Reproducir nota de voz"], [aria-label="Reproduzir mensagem de voz"], [aria-label="Play voice note"], [aria-label="Reproducir mensaje de voz"]');
        if (audio || play) {
          const inner = (c.innerText || "");
          const dm = inner.match(/(\\d{1,2}):(\\d{2})(?!\\d)/);
          const duration = dm ? parseInt(dm[1], 10) * 60 + parseInt(dm[2], 10) : null;
          const outgoing = !!c.querySelector('.message-out, [data-icon="tail-out"]');
          const quote = c.querySelector('[data-testid="quoted-message"], .quoted-mention, div[aria-label*="Quoted message" i]');
          const preEls = [...c.querySelectorAll('[data-pre-plain-text]')];
          const preEl = preEls.find((el) => !quote || !quote.contains(el)) || null;
          const pre = (preEl && (preEl.getAttribute("data-pre-plain-text") || preEl.textContent || "")) || (c.hasAttribute("data-pre-plain-text") ? c.getAttribute("data-pre-plain-text") : "") || "";
          const authorCandidates = [...c.querySelectorAll('[data-testid="author"], span[data-testid="author"]')];
          const authorEl = authorCandidates.find((a) => !quote || !quote.contains(a));
          let sender = "";
          let timestamp = "";
          if (pre) {
            const open = pre.indexOf("[");
            const close = pre.indexOf("]", open + 1);
            const after = (close >= 0 ? pre.slice(close + 1) : pre).trim();
            const colon = after.lastIndexOf(":");
            if (colon > 0) sender = after.slice(0, colon).trim();
            timestamp = (open >= 0 && close > open ? pre.slice(open + 1, close).trim() : pre.trim());
          }
          if (!timestamp) {
            const meta = c.querySelector('[data-testid="msg-meta"]');
            const metaText = meta ? (meta.innerText || meta.textContent || "") : "";
            const mm = metaText.match(/(\\d{1,2}:\\d{2})/);
            if (mm) timestamp = mm[1];
          }
          if (!sender && authorEl) sender = (authorEl.textContent || "").trim();
          if (!sender) sender = outgoing ? "Yo" : "desconocido";
          const quotedAuthorEl = quote && quote.querySelector('[data-testid="author"], span[data-testid="author"]');
          const quotedSender = quotedAuthorEl ? (quotedAuthorEl.textContent || "").trim() : "";
          notes.push({ src: audio ? (audio.currentSrc || audio.src || "") : "", containerIdx: containers.indexOf(c), duration, sender, timestamp, outgoing, quotedSender });
        }
      }
      return notes;
    })()`);
    return r?.result?.value || [];
  }

  async function readBlobBase64(t, src) {
    const fr = await cdpEval(t, `fetch(${JSON.stringify(src)}).then(r => r.blob()).then(b => b.arrayBuffer().then(ab => {
      const bytes = new Uint8Array(ab);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { base64: btoa(bin), size: ab.byteLength, type: b.type || "audio/ogg" };
    })).catch(e => ({ error: String(e) }))`);
    return fr?.result?.value;
  }

  // WhatsApp decodifica las notas en el client-side para pintar el waveform y guarda
  // los OggP/Opus desencriptados en el Cache Storage (`lru-media-array-buffer-cache`).
  // Si la nota nunca se reprodujo pero ya se renderizó, el audio está acá.
  // Devuelve [{ duration, base64, size, type }] o { error }.
  async function getOggsFromCache(t) {
    const r = await cdpEval(t, `(async () => {
      try {
        const cache = await caches.open("lru-media-array-buffer-cache");
        const keys = await cache.keys();
        const out = [];
        const ctx = new AudioContext();
        for (const k of keys) {
          try {
            const resp = await cache.match(k);
            if (!resp) continue;
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf.slice(0, 4));
            if (!(bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53)) continue; // "OggS"
            const dur = (await ctx.decodeAudioData(buf.slice(0))).duration;
            const u8 = new Uint8Array(buf);
            let bin = "";
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            out.push({ duration: Math.round(dur * 10) / 10, base64: btoa(bin), size: buf.byteLength, type: "audio/ogg" });
          } catch (e) { /* skip entry */ }
        }
        await ctx.close();
        return out;
      } catch (e) { return { error: String(e) }; }
    })()`);
    return r?.result?.value;
  }

  // Resuelve el audio de una nota SIN reproducirla:
  //   1) <audio> con src blob (si ya se descargó/reprodujo antes),
  //   2) Cache Storage (match por duración, tolerancia 2 s),
  //   3) Play como último recurso (marca la nota como escuchada — el usuario lo aceptó).
  async function resolveNoteAudio(t, note) {
    if (note.src) {
      const f = await readBlobBase64(t, note.src);
      if (f?.base64) return { base64: f.base64, size: f.size, type: f.type || "audio/ogg" };
    }
    // 2) cache: misma duración → match directo
    const oggs = await getOggsFromCache(t);
    if (Array.isArray(oggs) && oggs.length) {
      let pick = null;
      if (note.duration != null) {
        let bestDiff = Infinity;
        for (const o of oggs) {
          const d = Math.abs(o.duration - note.duration);
          if (d < bestDiff) { bestDiff = d; pick = o; }
        }
        if (bestDiff >= 2) pick = null;
      }
      if (!pick && oggs.length === 1) pick = oggs[0];
      if (pick) return { base64: pick.base64, size: pick.size, type: pick.type || "audio/ogg" };
    }
    // 3) Play (marca la nota como escuchada)
    const playResult = await playVoiceNote(t, note.containerIdx);
    if (playResult !== "play-clicked") return null;
    const src = await waitForAudioInContainer(t, note.containerIdx, 15000);
    await pauseVoiceNote(t, note.containerIdx);
    if (!src) return null;
    const f = await readBlobBase64(t, src);
    if (!f?.base64) return null;
    return { base64: f.base64, size: f.size, type: f.type || "audio/ogg" };
  }

  // Scrollea el contenedor scrollable de mensajes dentro de #main (no a ciegas: la lista es virtualizada).
  async function scrollChat(t, dy) {
    const r = await cdpEval(t, `(() => {
      const main = document.querySelector('#main');
      if (!main) return "no-main";
      const cand = [...main.querySelectorAll('div')].filter(d => d.scrollHeight - d.clientHeight > 120 && ['auto','scroll'].includes(getComputedStyle(d).overflowY));
      cand.sort((a,b) => b.clientHeight - a.clientHeight);
      const s = cand[0];
      if (!s) return "no-scroller";
      s.scrollTop += ${dy};
      return "ok";
    })()`);
    return String(r?.result?.value || "ok");
  }

  // Busca notas de voz en lo renderizado; si no hay, scrollea hacia arriba y reintenta.
  async function collectVoiceNotes(t, maxScrolls = 12) {
    for (let i = 0; i <= maxScrolls; i++) {
      const notes = await voiceNoteSrcs(t);
      if (Array.isArray(notes) && notes.length) return notes;
      await scrollChat(t, -800);
      await new Promise((res) => setTimeout(res, 500));
    }
    return [];
  }

  // Último recurso: click en "Reproducir mensaje de voz" (única forma de cargar el audio).
  // OJO: marca la nota como ESCUCHADA para el emisor — el usuario ya lo aceptó.
  // Apenas aparece el <audio> se pausa, así suena un instante y despues se corta.
  async function playVoiceNote(t, containerIdx) {
    const r = await cdpEval(t, `(() => {
      const c = [...document.querySelectorAll('[data-testid="msg-container"]')][${containerIdx}];
      if (!c) return "no-container";
      const btn = c.querySelector('[aria-label="Reproducir mensaje de voz"], [aria-label="Reproduzir mensagem de voz"], [aria-label="Play voice message"], [aria-label="Reproducir nota de voz"], [aria-label="Play voice note"]');
      if (!btn) return "no-play-button";
      const b = btn.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    })()`);
    const pt = r?.result?.value;
    if (!pt?.x) return typeof pt === "string" ? pt : "no-coords";
    await cdpMouseClick(t, pt.x, pt.y);
    return "play-clicked";
  }

  async function waitForAudioInContainer(t, containerIdx, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = await cdpEval(t, `(() => {
        const c = [...document.querySelectorAll('[data-testid="msg-container"]')][${containerIdx}];
        const a = c && c.querySelector('audio');
        return a ? (a.currentSrc || a.src || "") : "";
      })()`);
      const src = r?.result?.value;
      if (src) return src;
      await new Promise((res) => setTimeout(res, 400));
    }
    return "";
  }

  async function pauseVoiceNote(t, containerIdx) {
    await cdpEval(t, `(() => {
      const c = [...document.querySelectorAll('[data-testid="msg-container"]')][${containerIdx}];
      const a = c && c.querySelector('audio');
      if (a) { try { a.pause(); a.currentTime = 0; a.muted = true; } catch (e) {} return 'paused'; }
      return 'no-audio';
    })()`);
  }

  if (action === "whatsapp-transcribe") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const targetChat = String(args.chatName || "").trim();
    if (targetChat) {
      const opened = await openAndVerifyChat(t, targetChat);
      if (!opened.ok) return opened.message;
    }
    const senderFilter = String(args.sender || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(20, Number(args.limit || 1)));
    const index = Math.max(0, Number(args.index || 0));
    const header = await getChatHeader(t);

    let notes = await collectVoiceNotes(t);
    if (!Array.isArray(notes) || !notes.length) {
      return `No se encontraron notas de voz en "${header || "el chat abierto"}". Asegurate de que el chat tenga audios visibles (scrollá hacia la nota si hace falta).`;
    }
    if (senderFilter) notes = notes.filter((n) => String(n.sender || "").toLowerCase().includes(senderFilter));
    if (!notes.length) return `No se encontraron notas de voz de "${args.sender}" en "${header || "el chat abierto"}".`;
    if (index >= notes.length) return `Solo hay ${notes.length} nota(s) de voz de "${args.sender || "cualquier persona"}" visibles; usá index entre 0 y ${notes.length - 1}.`;

    // 2) target: index 0 = la última, 1 = la anterior, etc. limit = cuántas hacia atrás.
    const start = Math.max(0, notes.length - index - limit);
    const targets = notes.slice(start, notes.length - index);
    const base = notes.length - index - targets.length;

    const out = [];
    for (let i = 0; i < targets.length; i++) {
      const f = await resolveNoteAudio(t, targets[i]);
      const note = targets[i];
      const metaParts = [`chat="${header || "?"}"`, `sender="${note.sender || "desconocido"}"`];
      if (note.timestamp) metaParts.push(`time="${note.timestamp}"`);
      if (note.quotedSender) metaParts.push(`replyTo="${note.quotedSender}"`);
      const meta = metaParts.join(" | ");
      if (!f) {
        out.push(`#${base + i + 1} (${meta}): no se pudo obtener el audio (ni en caché de WhatsApp ni reproduciéndolo).`);
        continue;
      }
      try {
        const { text, language } = await speakappTranscribe({ base64: f.base64, mime: f.type }, signal);
        out.push(`#${base + i + 1} (${meta}; ${(f.size / 1024).toFixed(0)} KB, ${language || "?"}): ${text || "(sin habla detectada)"}`);
      } catch (e) {
        out.push(`#${base + i + 1} (${meta}): error de transcripción: ${e.message}`);
      }
    }
    return "Transcripción de nota(s) de voz (SpeakApp):\n" + out.join("\n");
  }

  // ------------------------------------------------------------ WhatsApp Web: acciones propias
  if (action === "whatsapp-list") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const r = await cdpEval(t, `(() => {
      const cells = [...document.querySelectorAll('[data-testid="cell-frame-container"]')];
      const out = [];
      for (const c of cells.slice(0, 40)) {
        const titleEl = c.querySelector('[data-testid="cell-frame-title"] span[title]') || c.querySelector('[data-testid="cell-frame-title"]');
        const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").trim();
        if (!title) continue;
        const sub = (c.querySelector('[data-testid="cell-frame-subtitle"]')?.textContent || "").trim();
        const time = (c.querySelector('[data-testid="cell-frame-time"]')?.textContent || "").trim();
        const unread = (c.querySelector('[data-testid="cell-frame-unread"]')?.textContent || "").trim();
        out.push({ title, sub, time, unread });
      }
      return out;
    })()`);
    const list = r?.result?.value;
    if (!Array.isArray(list) || !list.length) return "No se encontraron chats. ¿WhatsApp Web está abierto y logueado?";
    return list.map((c, i) => `${i + 1}. ${c.title}${c.time ? " · " + c.time : ""}${c.unread ? " · " + c.unread + " no leídos" : ""}${c.sub ? "\n   " + c.sub : ""}`).join("\n");
  }

  if (action === "whatsapp-read") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const targetChat = String(args.chatName || "").trim();
    if (targetChat) {
      const opened = await openAndVerifyChat(t, targetChat);
      if (!opened.ok) return opened.message;
    }
    const senderFilter = String(args.sender || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(args.limit || 10)));
    const r = await cdpEval(t, `(() => {
      const containers = [...document.querySelectorAll('[data-testid="msg-container"]')];
      const slice = containers.slice(-${limit});
      return slice.map(c => {
        const audio = c.querySelector('audio');
        const img = c.querySelector('img');
        const outgoing = !!c.querySelector('.message-out, [data-icon="tail-out"]');
        const quote = c.querySelector('[data-testid="quoted-message"], .quoted-mention, div[aria-label*="Quoted message" i]');
        const preEls = [...c.querySelectorAll('[data-pre-plain-text]')];
        const preEl = preEls.find((el) => !quote || !quote.contains(el)) || null;
        const pre = (preEl && (preEl.getAttribute("data-pre-plain-text") || preEl.textContent || "")) || (c.hasAttribute("data-pre-plain-text") ? c.getAttribute("data-pre-plain-text") : "") || "";
        const authorCandidates = [...c.querySelectorAll('[data-testid="author"], span[data-testid="author"]')];
        const authorEl = authorCandidates.find((a) => !quote || !quote.contains(a));
        let sender = "";
        let timestamp = "";
        if (pre) {
          const open = pre.indexOf("[");
          const close = pre.indexOf("]", open + 1);
          const after = (close >= 0 ? pre.slice(close + 1) : pre).trim();
          const colon = after.lastIndexOf(":");
          if (colon > 0) sender = after.slice(0, colon).trim();
          timestamp = (open >= 0 && close > open ? pre.slice(open + 1, close).trim() : "");
        }
        if (!timestamp) {
          const meta = c.querySelector('[data-testid="msg-meta"]');
          const metaText = meta ? (meta.innerText || meta.textContent || "") : "";
          const mm = metaText.match(/(\\d{1,2}:\\d{2})/);
          if (mm) timestamp = mm[1];
        }
        if (!sender && authorEl) sender = (authorEl.textContent || "").trim();
        if (!sender) sender = outgoing ? "Yo" : "desconocido";
        const quotedAuthorEl = quote && quote.querySelector('[data-testid="author"], span[data-testid="author"]');
        const quotedSender = quotedAuthorEl ? (quotedAuthorEl.textContent || "").trim() : "";
        return { audio: !!audio, image: !!img, sender, timestamp, quotedSender, text: (c.innerText || "").slice(0, 1200) };
      });
    })()`);
    const msgs = r?.result?.value;
    if (!Array.isArray(msgs) || !msgs.length) return "No se encontraron mensajes en el chat abierto.";
    const filtered = senderFilter ? msgs.filter((m) => String(m.sender || "").toLowerCase().includes(senderFilter)) : msgs;
    if (!filtered.length) return `No se encontraron mensajes de "${args.sender}" en el chat abierto.`;
    const header = await getChatHeader(t);
    const prefix = header ? `Chat: ${header}\n` : "";
    return prefix + filtered.map((m) => `[${m.sender}${m.timestamp ? ` · ${m.timestamp}` : ""}]${m.quotedSender ? ` (reply to ${m.quotedSender})` : ""} ${m.text}${m.audio ? " 🎤" : ""}${m.image ? " 🖼️" : ""}`).join("\n---\n");
  }

  if (action === "whatsapp-read-last") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const targetChat = String(args.chatName || "").trim();
    if (targetChat) {
      const opened = await openAndVerifyChat(t, targetChat);
      if (!opened.ok) return opened.message;
    }
    const header = await getChatHeader(t);
    const r = await cdpEval(t, `(() => {
      const containers = [...document.querySelectorAll('[data-testid="msg-container"]')];
      const candidates = containers.filter((c) => c.querySelector('.message-in, .message-out, audio, [data-testid="audio-play"], [data-testid="audio-pause"], [aria-label="Play voice message"], [aria-label="Reproducir nota de voz"], [aria-label="Reproducir mensaje de voz"]'));
      const c = candidates[candidates.length - 1];
      if (!c) return null;
      const outgoing = !!c.querySelector('.message-out, [data-icon="tail-out"]');
      const quote = c.querySelector('[data-testid="quoted-message"], .quoted-mention, div[aria-label*="Quoted message" i]');
      const preEls = [...c.querySelectorAll('[data-pre-plain-text]')];
      const preEl = preEls.find((el) => !quote || !quote.contains(el)) || null;
      const pre = (preEl && (preEl.getAttribute("data-pre-plain-text") || preEl.textContent || "")) || (c.hasAttribute("data-pre-plain-text") ? c.getAttribute("data-pre-plain-text") : "") || "";
      const authorCandidates = [...c.querySelectorAll('[data-testid="author"], span[data-testid="author"]')];
      const authorEl = authorCandidates.find((a) => !quote || !quote.contains(a));
      let sender = "";
      let timestamp = "";
      if (pre) {
        const open = pre.indexOf("[");
        const close = pre.indexOf("]", open + 1);
        const after = (close >= 0 ? pre.slice(close + 1) : pre).trim();
        const colon = after.lastIndexOf(":");
        if (colon > 0) sender = after.slice(0, colon).trim();
        timestamp = (open >= 0 && close > open ? pre.slice(open + 1, close).trim() : "");
      }
      if (!timestamp) {
        const meta = c.querySelector('[data-testid="msg-meta"]');
        const metaText = meta ? (meta.innerText || meta.textContent || "") : "";
        const mm = metaText.match(/(\\d{1,2}:\\d{2})/);
        if (mm) timestamp = mm[1];
      }
      if (!sender && authorEl) sender = (authorEl.textContent || "").trim();
      if (!sender) sender = outgoing ? "Yo" : "desconocido";
      const quotedAuthorEl = quote && quote.querySelector('[data-testid="author"], span[data-testid="author"]');
      const quotedSender = quotedAuthorEl ? (quotedAuthorEl.textContent || "").trim() : "";
      const textParts = [...c.querySelectorAll('[data-testid="selectable-text"]')]
        .filter((el) => !quote || !quote.contains(el))
        .map((el) => (el.innerText || el.textContent || "").trim())
        .filter(Boolean);
      const text = textParts.join("\\n").trim();
      const hasAudio = !!c.querySelector('audio, [data-testid="audio-play"], [data-testid="audio-pause"], [aria-label="Play voice message"], [aria-label="Reproducir nota de voz"], [aria-label="Reproducir mensaje de voz"]');
      const hasImage = !!c.querySelector('img');
      const dm = (c.innerText || "").match(/(\\d{1,2}):(\\d{2})(?!\\d)/);
      const duration = dm ? parseInt(dm[1], 10) * 60 + parseInt(dm[2], 10) : null;
      const type = hasAudio ? "audio" : text ? "text" : hasImage ? "image" : "other";
      return { sender, timestamp, quotedSender, outgoing, type, text, duration };
    })()`);
    const m = r?.result?.value;
    if (!m) return `No se encontraron mensajes en "${header || "el chat abierto"}".`;
    const metaParts = [`chat="${header || "?"}"`, `type="${m.type}"`, `sender="${m.sender || "desconocido"}"`];
    if (m.timestamp) metaParts.push(`time="${m.timestamp}"`);
    if (m.quotedSender) metaParts.push(`replyTo="${m.quotedSender}"`);
    if (m.type === "audio" && m.duration != null) metaParts.push(`duration="${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, "0")}"`);
    const body = m.type === "audio" && !m.text ? "[nota de voz; usá action=transcribe para transcribirla]" : m.text || "[sin texto visible]";
    return `Último mensaje — ${metaParts.join(" | ")}\n${body}`;
  }

  if (action === "whatsapp-search") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const q = String(args.chatName || args.query || "").trim();
    if (!q) return "Error: falta chatName (o query)";
    const r = await cdpEval(t, `(() => {
      const input = document.querySelector('#side input') || document.querySelector('[data-testid="search-input"]') || document.querySelector('input[placeholder*="Buscar"]') || document.querySelector('input[placeholder*="Search"]');
      if (!input) return "no-search-input";
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(q)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()`);
    return String(r?.result?.value || "ok");
  }

  if (action === "whatsapp-status") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const r = await cdpEval(t, `(() => {
      const header = document.querySelector('[data-testid="conversation-info-header-chat-title"]')?.textContent || document.querySelector('header span[title]')?.getAttribute("title") || "";
      const composer = !!document.querySelector('#main footer [contenteditable="true"]');
      const search = !!document.querySelector('#side input');
      return { header, composer, search };
    })()`);
    const v = r?.result?.value;
    return v ? `Chat abierto: ${v.header || "(ninguno)"} · Composer: ${v.composer ? "OK" : "no"} · Buscador: ${v.search ? "OK" : "no"}` : "Sin datos (¿WhatsApp Web abierto?)";
  }

  if (action === "whatsapp-extract-audio") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const targetChat = String(args.chatName || "").trim();
    if (targetChat) {
      const opened = await openAndVerifyChat(t, targetChat);
      if (!opened.ok) return opened.message;
    }
    const senderFilter = String(args.sender || "").trim().toLowerCase();
    const index = Math.max(0, Number(args.index || 0));
    const header = await getChatHeader(t);
    let notes = await collectVoiceNotes(t);
    if (!Array.isArray(notes) || !notes.length) return `No se encontraron notas de voz en "${header || "el chat abierto"}".`;
    if (senderFilter) notes = notes.filter((n) => String(n.sender || "").toLowerCase().includes(senderFilter));
    if (!notes.length) return `No se encontraron notas de voz de "${args.sender}" en "${header || "el chat abierto"}".`;
    if (index >= notes.length) return `Solo hay ${notes.length} nota(s) de voz de "${args.sender || "cualquier persona"}" visibles; usá index entre 0 y ${notes.length - 1}.`;
    const note = notes[notes.length - 1 - index];
    const f = await resolveNoteAudio(t, note);
    if (!f) return "No se pudo obtener el audio (ni en caché de WhatsApp ni reproduciéndolo).";
    return JSON.stringify({ ...f, chat: header || null, sender: note.sender || null, timestamp: note.timestamp || null, replyTo: note.quotedSender || null });
  }

  if (action === "whatsapp-scroll") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const dy = Number(args.dy ?? 600);
    await cdpCallRaw(t, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 300, deltaX: 0, deltaY: dy, button: "none" });
    return `Scroll ${dy > 0 ? "↓" : "↑"} ${Math.abs(dy)}px`;
  }

  if (action === "eval" || action === "console") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const expr = String(args.expression || args.code || args.expr || "").trim();
    if (!expr) return "Error: falta expression (JS a ejecutar)";
    if (!isConfirmed(args)) {
      return `No ejecutado. Preview para "${t.title}":\n${expr}\nPara ejecutar, pedile confirmación explícita al usuario y volvé a llamar con confirmed:true.`;
    }
    const r = await cdpEval(t, expr);
    const details = r?.exceptionDetails;
    if (details) {
      return `Error en eval (${t.title}): ${details.exception?.description || details.text || JSON.stringify(details)}`;
    }
    const result = r?.result;
    if (!result) return `Eval OK (${t.title})\n(sin valor)`;
    let out;
    try {
      out = JSON.stringify(result.value, null, 2);
    } catch (e) {
      out = null;
    }
    if (out === undefined) {
      out = `[${result.type}${result.subtype ? "/" + result.subtype : ""}${result.description ? ": " + result.description : result.unserializableValue ? ": " + result.unserializableValue : ""}]`;
    }
    const MAX = 4000;
    if (out.length > MAX) out = out.slice(0, MAX) + `\n… [truncado ${out.length} caracteres]`;
    return `Eval OK (${t.title})\n${out}`;
  }

  return `Error: acción desconocida "${action}". Usá list|activate|close|close-by-pattern|navigate|reload|scroll|extract-text|inspect|snapshot|click|fill|send|whatsapp-chat|whatsapp-send-to|whatsapp-send|whatsapp-transcribe|whatsapp-list|whatsapp-read|whatsapp-read-last|whatsapp-search|whatsapp-status|whatsapp-extract-audio|whatsapp-scroll|eval|console.`;
}
