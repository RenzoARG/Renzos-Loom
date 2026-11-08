import { spawn } from "child_process";
import fs from "fs";
import WebSocket from "ws";

// Control del navegador de la PC vía CDP (Chrome DevTools Protocol).
// Brave/Chrome necesitan lanzarse con --remote-debugging-port=9222 para exponer el puerto.

const CDP_HOST = process.env.LOOM_CDP_HOST || "127.0.0.1";
const CDP_PORT = Number(process.env.LOOM_CDP_PORT || 9222);
const BRAVE_PATHS = process.platform === "win32"
  ? [process.env.PROGRAMFILES + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
     process.env["PROGRAMFILES(X86)"] + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
     process.env.LOCALAPPDATA + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"]
  : ["/usr/bin/brave", "/opt/brave-bin/brave"];
let spawnedBrave = false;

async function cdpList() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return await res.json();
}

function braveExe() {
  return BRAVE_PATHS.find((p) => p && fs.existsSync(p));
}

function cdpCallRaw(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP timeout " + method)); }, 15_000);
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

function cdpEval(target, expr) {
  return cdpCallRaw(target, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
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

  if (action === "whatsapp-chat") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const needle = String(args.chatName || "").trim().toLowerCase();
    if (!needle) return "Error: falta chatName";
    const r = await cdpEval(t, `(() => {
      const name = ${JSON.stringify(args.chatName || "")}.toLowerCase();
      const cells = [...document.querySelectorAll('[data-testid="cell-frame-container"]')];
      for (const c of cells) {
        const titleEl = c.querySelector('[data-testid="cell-frame-title"] span[title]');
        const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").toLowerCase();
        if (title.includes(name)) {
          c.scrollIntoView({block:"center"});
          const b = c.getBoundingClientRect();
          return { x: b.left + b.width/2, y: b.top + b.height/2, title };
        }
      }
      return null;
    })()`);
    const pt = r?.result?.value;
    if (!pt) return `no encontrado: ${args.chatName}`;
    await cdpMouseClick(t, pt.x, pt.y);
    return "ok: " + pt.title;
  }

  if (action === "whatsapp-send") {
    const t = pick();
    if (!t?.webSocketDebuggerUrl) return "Error: pestaña no encontrada (usá action:list primero)";
    const text = String(args.text || "").replace(/`/g, "\\`").replace(/\$/g, "\\$");
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
    try { await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${t.id}`, { signal: AbortSignal.timeout(5_000) }); } catch {}
    const chatRes = await browserTool({ action: "whatsapp-chat", chatName: name, tabId: t.id });
    if (!chatRes.startsWith("ok")) return chatRes;
    await new Promise((r) => setTimeout(r, 800));
    const h = await cdpEval(t, `(() => document.querySelector('[data-testid="conversation-info-header-chat-title"]')?.textContent || document.querySelector('header span[title]')?.getAttribute("title") || "")()`);
    const header = String(h?.result?.value || "").toLowerCase();
    if (!header.includes(name.toLowerCase())) {
      return `abortado: header es "${header}", esperado "${name}" (no envié nada)`;
    }
    const sent = await browserTool({ action: "whatsapp-send", text: args.text, tabId: t.id });
    return `${chatRes} | ${sent}`;
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

  return `Error: acción desconocida "${action}". Usá list|activate|close|snapshot|inspect|click|fill|send|whatsapp-chat|whatsapp-send-to|whatsapp-send.`;
}
