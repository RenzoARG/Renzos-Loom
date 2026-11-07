const $ = (id) => document.getElementById(id);
const tabsEl = $("tabs");
const chatsEl = $("chats");
const input = $("input");
const sendBtn = $("send");
const modelSelect = $("model-select");
const statusEl = $("status");
const filterVision = $("filter-vision");
const filterFree = $("filter-free");
const ctxEl = $("ctx");
const activityEl = $("activity");
// clave = propiedad booleana del modelo (ver getAvailableModels en main.js)
const filterBoxes = { vision: filterVision, audio: $("filter-audio"), reasoning: $("filter-reasoning"), files: $("filter-files"), web: $("filter-web"), free: filterFree };
const attachmentsEl = $("attachments");

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
const tabs = new Map();   // id -> { id, name, model, busy, unread, el, draft, attachments }
let order = [];           // ids en el orden de la barra
let activeId = null;
let allModels = [];
let editingId = null;     // pestaña que se está renombrando
let renderPending = false;

const activeTab = () => tabs.get(activeId);
const extOf = (n) => (n.lastIndexOf(".") >= 0 ? n.slice(n.lastIndexOf(".")).toLowerCase() : "");
const baseName = (p) => p.replace(/\\/g, "/").split("/").pop();
const modelHasVision = (id) => allModels.find((m) => m.id === id)?.vision ?? true;
function setStatus(msg) { statusEl.textContent = msg; }

// ------------------------------------------------------------ contador de contexto (usado/máximo)
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  : n >= 1e4 ? Math.round(n / 1000) + "k"
  : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));
function updateCtx() {
  const tab = activeTab();
  if (!tab) { ctxEl.textContent = "–"; return; }
  const max = allModels.find((m) => m.id === tab.model)?.context || 0;
  const used = tab.ctx || 0;
  const pct = max ? used / max : 0;
  ctxEl.textContent = (tab.ctxReal ? "" : "~") + fmtTok(used) + (max ? "/" + fmtTok(max) : "");
  ctxEl.className = pct >= 0.95 ? "crit" : pct >= 0.8 ? "warn" : "";
  ctxEl.title = `Contexto: ${used.toLocaleString()}${max ? " de " + max.toLocaleString() + " tokens (" + Math.round(pct * 100) + "%)" : " tokens"}${tab.ctxReal ? "" : " · estimado hasta la próxima respuesta"}`;
}

// ------------------------------------------------------------ actividad en vivo (qué hace el agente y hace cuánto)
// El cronómetro corre en el renderer: sigue contando aunque el proceso principal esté ocupado o colgado.
const fmtDur = (ms) => (ms < 10000 ? (ms / 1000).toFixed(1) + "s" : ms < 60000 ? Math.round(ms / 1000) + "s"
  : `${Math.floor(ms / 60000)}m ${String(Math.round(ms / 1000) % 60).padStart(2, "0")}s`);
function setActivity(tab, text, hint = "", slowAfter = 60, until = 0) {
  tab.activity = { text, hint, since: Date.now(), slowAfter, until };
  if (tab.id === activeId) renderActivity();
}
function renderActivity() {
  const tab = activeTab();
  if (!tab || !tab.busy || !tab.activity) { activityEl.className = ""; activityEl.textContent = ""; return; }
  const a = tab.activity, now = Date.now(), el = now - a.since, slow = a.slowAfter * 1000;
  const level = el > slow * 2 ? "crit" : el > slow ? "warn" : "";
  const mk = (cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; return s; };
  const text = a.until ? a.text.replace("{s}", Math.max(0, Math.ceil((a.until - now) / 1000))) : a.text;
  const parts = [mk("", "⏳ " + text), mk("time", fmtDur(el))];
  if (a.hint) parts.push(mk("hint", a.hint));
  if (tab.busySince) parts.push(mk("time", "total " + fmtDur(now - tab.busySince)));
  if (level) parts.push(mk("alert", level === "crit"
    ? `⚠ Lleva ${fmtDur(el)} sin avanzar: probablemente esté trabado. Podés cortarlo con ⏹ Detener (o Esc).`
    : `⚠ Sin novedades hace ${fmtDur(el)}: puede estar lento o trabado.`));
  activityEl.className = "on " + level;
  activityEl.replaceChildren(...parts);
}
setInterval(renderActivity, 1000);

// ------------------------------------------------------------ mensajes
function addMessage(tab, role, text) {
  tab.el.querySelector(".empty")?.remove();
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "system" && text.includes("Cambio de agente")) {
    // Handoff (pasada de posta): colapsado por defecto para no floodear — click para expandir.
    const d = document.createElement("details");
    d.className = "handoff";
    d.open = false;
    const summary = document.createElement("summary");
    summary.textContent = "🔄 Cambio de agente (click para ver detalle)";
    const body = document.createElement("div");
    body.textContent = text;
    body.style.cssText = "white-space: pre-wrap; word-break: break-word; margin-top: 6px;";
    summary.addEventListener("click", (e) => e.stopPropagation());
    d.append(summary, body);
    div.appendChild(d);
  } else if (role === "tool" || role === "log" || role === "log warn") {
    // Pensamientos/steps/tools: colapsados por defecto, click para ver el detalle.
    const d = document.createElement("details");
    d.className = "thought";
    d.open = false;
    const summary = document.createElement("summary");
    summary.textContent = text.length > 80 ? text.slice(0, 77) + "…" : text;
    const body = document.createElement("div");
    body.textContent = text;
    body.style.cssText = "white-space: pre-wrap; word-break: break-word; margin-top: 6px;";
    summary.addEventListener("click", (e) => e.stopPropagation());
    d.append(summary, body);
    div.appendChild(d);
  } else {
    div.textContent = text;
  }
  tab.el.appendChild(div);
  tab.el.scrollTop = tab.el.scrollHeight;
}

function showEmptyHint(tab) {
  if (tab.el.childElementCount) return;
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = "Conversación nueva. Escribí un mensaje o adjuntá un archivo.";
  tab.el.appendChild(p);
}

// ------------------------------------------------------------ pestañas
function addTab(info) {
  const el = document.createElement("div");
  el.className = "chat";
  el.setAttribute("role", "log");
  chatsEl.appendChild(el);
  const tab = { id: info.id, name: info.name, model: info.model, busy: !!info.busy, unread: false, el, draft: "", attachments: [], ctx: info.ctx || 0, ctxReal: !!info.ctxReal };
  tabs.set(tab.id, tab);
  order.push(tab.id);
  (info.messages || []).forEach((m) => addMessage(tab, m.role, m.text));
  showEmptyHint(tab);
  el.scrollTop = el.scrollHeight;
  return tab;
}

function renderTabs() {
  if (editingId) { renderPending = true; return; } // no pisar el input de renombrado
  tabsEl.innerHTML = "";
  for (const id of order) {
    const tab = tabs.get(id);
    const div = document.createElement("div");
    div.className = "tab" + (id === activeId ? " active" : "") + (tab.busy ? " busy" : "") + (tab.unread ? " unread" : "");
    div.setAttribute("role", "tab");
    div.setAttribute("aria-selected", id === activeId);
    div.title = `${tab.name}\n${tab.model}\n${t("dblClickRename")}`;
    div.dataset.id = id;

    const dot = document.createElement("span"); dot.className = "dot";
    const label = document.createElement("span"); label.className = "label"; label.textContent = tab.name;
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.setAttribute("aria-label", "Cerrar " + tab.name); x.title = "Cerrar (queda guardada)";
    x.addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });

    div.addEventListener("click", () => { if (id !== activeId) activate(id); });
    div.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
    label.addEventListener("dblclick", (e) => { e.stopPropagation(); startRename(id); });
    div.append(dot, label, x);
    tabsEl.appendChild(div);
  }
  tabsEl.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function startRename(id) {
  const t = tabs.get(id);
  const div = tabsEl.querySelector(`.tab[data-id="${id}"]`);
  if (!t || !div) return;
  editingId = id;
  // Ancho fijo mientras se edita: si la pestaña cambia de tamaño al terminar, la de al lado se corre
  // y el clic que provocó el blur cae en el vacío.
  const lock = (w) => { div.style.width = div.style.minWidth = div.style.maxWidth = w; };
  lock(div.getBoundingClientRect().width + "px");
  const label = div.querySelector(".label");
  const field = document.createElement("input");
  field.className = "rename";
  field.value = t.name;
  field.maxLength = 60;
  field.setAttribute("aria-label", "Nombre de la conversación");
  label.replaceWith(field);
  field.focus();
  field.select();

  let done = false;
  // Se restaura la etiqueta en el lugar (sin reconstruir la barra): si el blur vino de hacer clic en otra
  // pestaña, reconstruir el DOM en pleno mousedown haría que ese clic se pierda.
  const finish = (commit, refocus, byBlur = false) => {
    if (done) return;
    done = true;
    editingId = null;
    const value = field.value.replace(/\s+/g, " ").trim();
    if (commit && value && value !== t.name) {
      t.name = value; // optimista; el proceso principal confirma y guarda
      window.loom.renameTab(id, value).then((n) => { if (n && n !== t.name) { t.name = n; renderTabs(); } });
    }
    label.textContent = t.name;
    if (field.isConnected) field.replaceWith(label);
    if (byBlur) { // posible clic en curso: soltar el ancho recién cuando termine
      document.addEventListener("mouseup", () => setTimeout(() => lock(""), 0), { once: true });
      setTimeout(() => lock(""), 2000);
    } else lock("");
    if (renderPending) { renderPending = false; renderTabs(); }
    if (refocus) input.focus();
  };
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true, true);
    else if (e.key === "Escape") finish(false, true);
  });
  field.addEventListener("blur", () => finish(true, false, true));
  field.addEventListener("click", (e) => e.stopPropagation());
}

// Mientras la pestaña responde, "Enviar" pasa a ser un botón rojo "Detener".
const tr = (key) => t(key);
function updateSendState() {
  const t = activeTab();
  const busy = !!t?.busy;
  sendBtn.disabled = !t || (busy && t.stopping);
  sendBtn.classList.toggle("stop", busy);
  sendBtn.textContent = busy ? "⏹ " + tr(t.stopping ? "stopping" : "stop") : tr("send");
  sendBtn.title = busy ? "Cortar la respuesta o el comando en curso (Esc)" : "";
}

async function stopActive() {
  const tab = activeTab();
  if (!tab || !tab.busy || tab.stopping) return;
  tab.stopping = true;
  updateSendState();
  setActivity(tab, "Deteniendo…", "", 15);
  const ok = await window.loom.stopTab(tab.id);
  if (!ok) { tab.stopping = false; updateSendState(); }
}

function activate(id, { notify = true } = {}) {
  const prev = activeTab();
  if (prev) { prev.draft = input.value; prev.el.classList.remove("active"); prev.el.style.removeProperty("display"); }
  activeId = id;
  const t = activeTab();
  t.unread = false;
  t.el.classList.add("active");
  t.el.style.removeProperty("display");
  input.value = t.draft;
  t.el.scrollTop = t.el.scrollHeight;
  renderTabs();
  renderAttachments();
  renderModelOptions();
  updateSendState();
  renderActivity();
  setStatus(t.busy ? "Pensando..." : "Listo");
  if (notify) window.loom.activateTab(id);
  if (!editingId) input.focus();
}

async function newTab() {
  hideConfigPanel(); // Ocultar panel de configuración si está abierto
  const info = await window.loom.newTab(activeId);
  addTab(info);
  activate(info.id, { notify: false });
}

async function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const wasActive = id === activeId;
  const res = await window.loom.closeTab(id);
  t.el.remove();
  tabs.delete(id);
  order = order.filter((x) => x !== id);
  if (res.created) addTab(res.created);
  if (wasActive || !tabs.has(activeId)) {
    activeId = null; // ya no existe: que activate() no intente guardar el borrador de la pestaña cerrada
    activate(res.active, { notify: false });
  } else renderTabs();
}

function switchBy(delta) {
  if (order.length < 2) return;
  const i = order.indexOf(activeId);
  activate(order[(i + delta + order.length) % order.length]);
}

// ------------------------------------------------------------ sistema de idiomas (diccionarios en /lang/)
let currentLang = "es";
const langDict = {};

async function loadLanguages() {
  // Cargar directamente es.json y en.json (ruta relativa desde src/renderer -> src/languages)
  for (const code of ["es", "en"]) {
    try {
      const res = await fetch(`../languages/${code}.json`);
      if (res.ok) {
        langDict[code] = await res.json();
      } else {
        console.warn("No se pudo cargar idioma " + code + ": " + res.status);
      }
    } catch (e) {
      console.warn("Error cargando idioma " + code, e);
    }
  }
  console.log("Idiomas cargados:", Object.keys(langDict));
  currentLang = localStorage.getItem("loomLanguage") || "es";
  if (!langDict[currentLang]) currentLang = Object.keys(langDict)[0] || "es";
}

function t(key) {
  return langDict[currentLang]?.[key] || key;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (langDict[currentLang] && langDict[currentLang][key]) {
      el.textContent = langDict[currentLang][key];
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (langDict[currentLang] && langDict[currentLang][key]) {
      el.placeholder = langDict[currentLang][key];
    }
  });
  statusEl.textContent = t("ready");
  updateSendState();
}

function saveLanguage(code) {
  currentLang = code;
  localStorage.setItem("loomLanguage", code);
  applyTranslations();
}

// ------------------------------------------------------------ pestaña de configuración
let configPanelEl = null;

const PROVIDER_PRESETS = {
  openrouter: { label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1" },
  openai: { label: "OpenAI", baseURL: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic", baseURL: "https://api.anthropic.com/v1" },
  google: { label: "Google (Gemini)", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  xai: { label: "xAI (Grok)", baseURL: "https://api.x.ai/v1" },
  deepseek: { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1" },
  groq: { label: "Groq", baseURL: "https://api.groq.com/openai/v1" },
  together: { label: "Together AI", baseURL: "https://api.together.xyz/v1" },
  mistral: { label: "Mistral", baseURL: "https://api.mistral.ai/v1" },
  custom: { label: "Personalizado", baseURL: "" },
};

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "style") n.style.cssText = v;
    else if (k === "onclick") n.onclick = v;
    else if (k === "onchange") n.onchange = v;
    else n[k] = v;
  }
  for (const c of children) if (c) n.appendChild(c);
  return n;
}

async function refreshModels() {
  allModels = await window.loom.getModels(true);
  renderProviderFilters();
  renderModelOptions();
}

function createConfigPanel() {
  if (configPanelEl) return configPanelEl;
  const div = el("div", { className: "config-panel", style: "padding: 24px; max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;" });

  const h2 = el("h2", { text: t("configure"), style: "font-size: 20px; margin: 0; color: var(--text);" });
  const desc = el("p", { text: t("configureDesc"), style: "font-size: 14px; color: var(--muted); margin: 0;" });

  // ------------------------------------------------------------ API Keys
  const keysGroup = el("div", { style: "display: flex; flex-direction: column; gap: 8px;" });
  const keysHeader = el("div", { style: "display: flex; align-items: center; justify-content: space-between;" });
  const keysLabel = el("label", { text: t("apiKeysTitle") || "API Keys", style: "font-size: 14px; color: var(--text);" });
  const addBtn = el("button", {
    text: "＋ " + (t("addKey") || "Add key"),
    style: "padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px;",
  });
  keysHeader.append(keysLabel, addBtn);
  keysGroup.appendChild(keysHeader);

  const keysList = el("div", { id: "api-keys-list", style: "display: flex; flex-direction: column; gap: 6px;" });
  const keysEmpty = el("p", { text: t("noKeys") || "No API keys yet. Add one to use models.", style: "font-size: 12px; color: var(--muted); margin: 4px 0;" });
  keysList.appendChild(keysEmpty);
  keysGroup.appendChild(keysList);

  // ---- editor inline (menos propenso a fallar que un modal): se muestra bajo la lista
  const editor = el("div", {
    id: "api-key-editor", hidden: true,
    style: "display: none; flex-direction: column; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--surface);",
  });
  const providerSelect = el("select", { style: "padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); font-size: 13px;" });
  for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
    const opt = el("option", { value: id, text: preset.label });
    providerSelect.appendChild(opt);
  }
  const customProviderInput = el("input", {
    placeholder: t("customProviderName") || "Nombre del proveedor (opcional)",
    style: "display: none; padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); font-size: 13px;",
  });
  const baseUrlInput = el("input", {
    placeholder: t("endpoint") || "Endpoint (Base URL)",
    style: "padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); font-size: 13px;",
  });
  const keyInput = el("input", {
    type: "password", placeholder: t("apiKeyPlaceholder") || "sk-...",
    style: "padding: 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); font-size: 13px;",
  });
  const editorStatus = el("p", { style: "font-size: 12px; color: var(--muted); min-height: 16px; margin: 0;" });
  const editorBtns = el("div", { style: "display: flex; gap: 8px;" });
  const saveBtn = el("button", {
    text: t("save") || "Save",
    style: "padding: 8px 16px; border: none; border-radius: 6px; background: var(--blue); color: #fff; cursor: pointer; font-size: 13px;",
  });
  const cancelBtn = el("button", {
    text: t("cancel") || "Cancel",
    style: "padding: 8px 16px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 13px;",
  });
  editorBtns.append(saveBtn, cancelBtn);
  editor.append(providerSelect, customProviderInput, baseUrlInput, keyInput, editorStatus, editorBtns);
  keysGroup.appendChild(editor);

  providerSelect.onchange = () => {
    const preset = PROVIDER_PRESETS[providerSelect.value];
    baseUrlInput.value = preset?.baseURL || "";
    customProviderInput.style.display = providerSelect.value === "custom" ? "block" : "none";
    editorStatus.textContent = "";
  };
  addBtn.onclick = () => {
    editor.hidden = false;
    editor.style.display = "flex";
    providerSelect.value = "openrouter";
    providerSelect.onchange();
    keyInput.value = "";
    editorStatus.textContent = "";
    keyInput.focus();
  };
  cancelBtn.onclick = () => {
    editor.hidden = true;
    editor.style.display = "none";
  };
  saveBtn.onclick = async () => {
    const key = keyInput.value.trim();
    if (!key) { editorStatus.textContent = t("invalidApiKey") || "Falta la API key"; editorStatus.style.color = "#ff8a8a"; return; }
    if (!baseUrlInput.value.trim()) { editorStatus.textContent = t("needEndpoint") || "Falta el endpoint"; editorStatus.style.color = "#ff8a8a"; return; }
    const providerId = providerSelect.value;
    const provider = providerId === "custom" ? customProviderInput.value.trim() || PROVIDER_PRESETS.custom.label : PROVIDER_PRESETS[providerId].label;
    const res = await window.loom.addApiKey({ providerId, provider, baseURL: baseUrlInput.value.trim(), key });
    if (!res?.ok) { editorStatus.textContent = res?.error || "No se pudo guardar"; editorStatus.style.color = "#ff8a8a"; return; }
    editorStatus.textContent = t("saved") || "Saved";
    editorStatus.style.color = "var(--muted)";
    editor.hidden = true;
    editor.style.display = "none";
    await refreshModels();
    await renderKeysList();
  };

  let confirmingId = null;
  async function renderKeysList() {
    const entries = await window.loom.listApiKeys();
    keysList.innerHTML = "";
    if (!entries.length) { keysList.appendChild(keysEmpty); return; }
    for (const e of entries) {
      const st = e.status?.estado || "untested";
      const dotColor = st === "ok" ? "var(--green)" : st === "error" ? "#ff8a8a" : "var(--muted)";
      const stText = st === "ok" ? `✓ ${e.status.detalle || "OK"}` : st === "error" ? `✗ ${e.status.detalle || "Error"}` : "○ sin probar";
      const row = el("div", {
        style: "display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface);",
      });
      const dot = el("span", { style: `width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0;`, title: stText });
      const info = el("div", { style: "flex: 1; min-width: 0;" });
      info.append(
        el("div", { text: e.provider, style: "font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" }),
        el("div", { text: `${e.baseURL} · ${e.keyTail}`, style: "font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" }),
        el("div", { text: stText, style: "font-size: 11px; color: var(--muted);" }),
      );
      const testBtn = el("button", {
        text: t("test") || "Test",
        style: "padding: 5px 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 11px;",
      });
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        testBtn.textContent = "…";
        await window.loom.testApiKey(e.id);
        await renderKeysList();
      };
      const delBtn = el("button", {
        text: confirmingId === e.id ? "¿?" : "🗑",
        title: t("deleteKey") || "Delete key",
        style: `padding: 5px 10px; border: 1px solid var(--line); border-radius: 5px; background: ${confirmingId === e.id ? "#2a1519" : "var(--panel)"}; color: ${confirmingId === e.id ? "#ff8a8a" : "var(--text)"}; cursor: pointer; font-size: 11px;`,
      });
      delBtn.onclick = async () => {
        if (confirmingId !== e.id) { confirmingId = e.id; setTimeout(renderKeysList, 2500); renderKeysList(); return; }
        confirmingId = null;
        await window.loom.deleteApiKey(e.id);
        await refreshModels();
        await renderKeysList();
      };
      row.append(dot, info, testBtn, delBtn);
      keysList.appendChild(row);
    }
  }
  window._loomRenderKeysList = renderKeysList;

  // ------------------------------------------------------------ Skills
  const skillsGroup = el("div", { style: "display: flex; flex-direction: column; gap: 8px;" });
  const skillsLabel = el("label", { text: t("skillsTitle") || "Skills", style: "font-size: 14px; color: var(--text);" });
  const skillsHint = el("p", {
    text: t("skillsHint") || "Tus skills de usuario viven fuera del .exe. Creá una carpeta por skill con su SKILL.md y reiniciá Loom.",
    style: "font-size: 12px; color: var(--muted); margin: 0;",
  });
  const skillsPath = el("p", { text: "", style: "font-size: 11px; color: var(--muted); word-break: break-all; margin: 0;" });
  const skillsBtns = el("div", { style: "display: flex; gap: 8px; flex-wrap: wrap;" });
  const openSkillsBtn = el("button", {
    text: t("openSkillsFolder") || "📁 Abrir carpeta de skills",
    style: "padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px;",
    onclick: async () => {
      openSkillsBtn.disabled = true;
      const res = await window.loom.openSkillsFolder();
      if (!res?.ok) setStatus("No se pudo abrir la carpeta: " + (res?.error || "?"));
      openSkillsBtn.disabled = false;
    },
  });
  const reloadSkillsBtn = el("button", {
    text: t("reloadSkills") || "↻ Recargar skills",
    style: "padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font-size: 12px;",
    onclick: async () => {
      reloadSkillsBtn.disabled = true;
      await window.loom.reloadSkills();
      reloadSkillsBtn.disabled = false;
      setStatus(t("skillsReloaded") || "Skills recargados");
    },
  });
  skillsBtns.append(openSkillsBtn, reloadSkillsBtn);
  skillsGroup.append(skillsLabel, skillsHint, skillsPath, skillsBtns);
  window.loom.getSkillsDirs?.().then((d) => { if (d?.user) skillsPath.textContent = d.user; }).catch(() => {});

  // Idioma
  const langGroup = el("div", { style: "display: flex; flex-direction: column; gap: 8px;" });
  const langLabel = el("label", { text: t("language"), style: "font-size: 14px; color: var(--text);" });
  const langSelect = el("select", { style: "padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 14px;" });
  for (const code in langDict) {
    const opt = el("option", { value: code, text: code === "es" ? "Español" : code === "en" ? "English" : code });
    langSelect.appendChild(opt);
  }
  langSelect.value = currentLang;
  const langOptions = Array.from(langSelect.options);
  langSelect.onchange = (ev) => {
    saveLanguage(ev.target.value);
    langSelect.value = currentLang;
    h2.textContent = t("configure");
    desc.textContent = t("configureDesc");
    langLabel.textContent = t("language");
    keysLabel.textContent = t("apiKeysTitle") || "API Keys";
    addBtn.textContent = "＋ " + (t("addKey") || "Add key");
    skillsLabel.textContent = t("skillsTitle") || "Skills";
    skillsHint.textContent = t("skillsHint") || "Tus skills de usuario viven fuera del .exe. Creá una carpeta por skill con su SKILL.md y reiniciá Loom.";
    openSkillsBtn.textContent = t("openSkillsFolder") || "📁 Abrir carpeta de skills";
    reloadSkillsBtn.textContent = t("reloadSkills") || "↻ Recargar skills";
    btnClose.textContent = t("ready");
  };
  langGroup.append(langLabel, langSelect);

  // Botón cerrar
  const btnClose = el("button", {
    text: t("ready"),
    style: "padding: 10px 24px; border: none; border-radius: 6px; background: var(--blue); color: #fff; cursor: pointer; font-size: 14px; align-self: flex-start; margin-top: 8px;",
  });
  btnClose.onclick = () => { hideConfigPanel(); setStatus(t("ready")); };

  div.append(h2, desc, keysGroup, skillsGroup, langGroup, btnClose);

  configPanelEl = div;
  return div;
}

$("share-tab").addEventListener("click", async () => {
  const t = activeTab();
  if (!t) return;
  setStatus("Preparando ZIP…");
  const res = await window.loom.shareTab(t.id);
  if (res?.ok) setStatus("ZIP guardado: " + res.path);
  else if (res?.canceled) setStatus("Compartir cancelado");
  else setStatus("No se pudo compartir: " + (res?.error || "?"));
});

function showConfigPanel() {
  const t = activeTab();
  if (!t) return;
  t.el.style.display = "none";
  const panel = createConfigPanel();
  chatsEl.appendChild(panel);
  panel.style.display = "flex";
  $("input-bar")?.style.setProperty("display", "none", "important");
  $("attachments")?.style.setProperty("display", "none", "important");
  window._loomRenderKeysList?.();
}

function hideConfigPanel() {
  const t = activeTab();
  if (!t) return;
  t.el.style.removeProperty("display");
  t.el.classList.add("active");
  if (configPanelEl) configPanelEl.style.display = "none";
  $("input-bar")?.style.removeProperty("display");
  $("attachments")?.style.removeProperty("display");
}

$("new-tab").addEventListener("click", newTab);
$("config-tab").addEventListener("click", showConfigPanel);
window.loom.onShortcut((action) => {
  if (action === "new-tab") newTab();
  else if (action === "close-tab") closeTab(activeId);
  else if (action === "next-tab") switchBy(1);
  else if (action === "prev-tab") switchBy(-1);
});

// ------------------------------------------------------------ modelos (por pestaña)
const PROVIDER_FILTER_KEY = "loomProviderFilters";
let providerEnabled = new Set(); // vacío = todos visibles
try {
  const saved = JSON.parse(localStorage.getItem(PROVIDER_FILTER_KEY) || "null");
  if (Array.isArray(saved)) providerEnabled = new Set(saved);
} catch { /* sin filtros de proveedor guardados */ }
function saveProviderFilters() {
  localStorage.setItem(PROVIDER_FILTER_KEY, JSON.stringify([...providerEnabled]));
}

const visibleModels = () => allModels.filter((m) => {
  if (!Object.entries(filterBoxes).every(([k, el]) => !el.checked || m[k])) return false;
  if (providerEnabled.size && !providerEnabled.has(m.keyId || m.providerId || m.provider)) return false;
  return true;
});
function providerGroups(models) {
  const map = new Map();
  for (const m of models) {
    const key = m.keyId || m.providerId || m.provider || "other";
    if (!map.has(key)) map.set(key, { label: m.provider || m.providerId || "Otros", items: [] });
    map.get(key).items.push(m);
  }
  return [...map.values()];
}

function renderProviderFilters() {
  const container = $("provider-filters");
  container.innerHTML = "";
  const seenMap = new Map();
  for (const m of allModels) {
    const id = m.keyId || m.providerId || m.provider || "other";
    if (!seenMap.has(id)) seenMap.set(id, m.provider || m.providerId || "Otros");
  }
  const seen = [...seenMap.entries()].map(([id, label]) => ({ id, label }));
  for (const p of seen) {
    const label = document.createElement("label");
    label.className = "chk";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = providerEnabled.size ? providerEnabled.has(p.id) : true;
    box.addEventListener("change", () => {
      // providerEnabled vacío = todos visibles. Al marcar/desmarcar pasamos a un set explícito.
      if (providerEnabled.size === 0) {
        const allIds = seen.map((s) => s.id);
        providerEnabled = new Set(box.checked ? allIds : allIds.filter((id) => id !== p.id));
      } else if (box.checked) {
        providerEnabled.add(p.id);
      } else {
        providerEnabled.delete(p.id);
      }
      // Si quedan todos marcados, volvemos al estado "todos" (set vacío).
      if (providerEnabled.size && providerEnabled.size === seen.length) providerEnabled = new Set();
      saveProviderFilters();
      renderModelOptions();
    });
    label.append(box, document.createTextNode(" " + (p.label || p.id)));
    container.appendChild(label);
  }
}

function renderModelOptions() {
  const t = activeTab();
  const list = visibleModels();
  // Si el modelo de la pestaña quedó fuera del filtro, igual lo mostramos para que el select diga la verdad.
  const current = allModels.find((m) => m.id === t?.model);
  const shown = current && !list.includes(current) ? [current, ...list] : list;
  modelSelect.innerHTML = "";
  if (t && !current) { // modelo que no está en la lista (ej. una pestaña vieja guardada)
    const opt = document.createElement("option");
    opt.value = t.model;
    opt.textContent = t.model;
    modelSelect.appendChild(opt);
  }
  const groups = providerGroups(shown);
  for (const g of groups) {
    const og = document.createElement("optgroup");
    og.label = g.label || "Otros";
    for (const m of g.items.slice(0, 400)) {
      const opt = document.createElement("option");
      opt.value = m.id;
      // Dos líneas en el desplegable: caps con score arriba, modelo abajo (como pediste).
      const badge = m.capsBadge || m.caps || "";
      opt.textContent = `${badge}\n${m.id} (${Math.round(m.context / 1000)}k) ★${m.jack ?? ""}`;
      og.appendChild(opt);
    }
    modelSelect.appendChild(og);
  }
  if (t) modelSelect.value = t.model;
  const currentInfo = allModels.find((m) => m.id === t?.model);
  $("model-id").textContent = t ? `${t.model}${currentInfo?.provider ? " · " + currentInfo.provider : ""}` : "";
  $("model-count").textContent = `(${list.length}/${allModels.length})`;
  updateCtx();
}

async function changeModel(id) {
  const t = activeTab();
  if (!t) return;
  const res = await window.loom.setModel(t.id, id);
  const newModel = (res && res.model) || res || id;
  t.model = newModel;
  if (res && res.handoffNote) addMessage(t, "system", res.handoffNote);
  if (res && typeof res.ctx === "number") { t.ctx = res.ctx; t.ctxReal = !!res.ctxReal; }
  modelSelect.value = t.model;
  $("model-id").textContent = t.model;
  updateCtx();
  renderTabs();
}

modelSelect.addEventListener("change", async () => {
  await changeModel(modelSelect.value);
  const t = activeTab();
  setStatus("Modelo: " + t.model);
  if (t.attachments.some((a) => a.isImage) && !modelHasVision(t.model)) setStatus("⚠ Este modelo no tiene visión: las imágenes adjuntas darán error");
});
// Los filtros se recuerdan entre sesiones (ahora son varios y resetearlos cada vez molesta).
const FILTER_KEY = "loomFilters";
try {
  const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
  if (saved) for (const k in filterBoxes) if (k in saved) filterBoxes[k].checked = !!saved[k];
} catch { /* sin filtros guardados */ }
for (const el of Object.values(filterBoxes)) {
  el.addEventListener("change", () => {
    renderModelOptions();
    localStorage.setItem(FILTER_KEY, JSON.stringify(Object.fromEntries(Object.entries(filterBoxes).map(([k, b]) => [k, b.checked]))));
  });
}
renderProviderFilters();

// Al adjuntar una imagen con un modelo sin visión, pasamos solos a uno que sí tenga (respetando "Solo gratis").
async function ensureVisionModel() {
  const t = activeTab();
  if (!t || modelHasVision(t.model)) return;
  const candidate = allModels.find((m) => m.vision && (!filterFree.checked || m.free));
  if (candidate) {
    await changeModel(candidate.id);
    renderModelOptions();
    setStatus(`Cambié a ${candidate.id} (tiene visión)`);
  } else {
    setStatus("⚠ No hay modelos con visión y tools con estos filtros. Probá destildar 'Solo gratis'.");
  }
}

// ------------------------------------------------------------ adjuntos (por pestaña)
function renderAttachments() {
  attachmentsEl.innerHTML = "";
  const t = activeTab();
  if (!t) return;
  t.attachments.forEach((a, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = (a.isImage ? "🖼️ " : "📄 ") + a.name + " ";
    const x = document.createElement("button");
    x.textContent = "✕";
    x.setAttribute("aria-label", "Quitar " + a.name);
    x.onclick = () => { t.attachments.splice(i, 1); renderAttachments(); };
    chip.appendChild(x);
    attachmentsEl.appendChild(chip);
  });
}

async function addAttachment(a) {
  const t = activeTab();
  if (!t) return;
  t.attachments.push(a);
  renderAttachments();
  if (a.isImage) await ensureVisionModel();
}

const readAsDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});

async function addBrowserFile(f) {
  const isImage = f.type.startsWith("image/") || IMAGE_EXTS.includes(extOf(f.name));
  const p = window.loom.getPathForFile(f);
  if (p) await addAttachment({ name: f.name, path: p, isImage });
  else await addAttachment({ name: f.name || "pegado.png", dataUrl: await readAsDataURL(f), isImage }); // ej: captura pegada
}

$("pick-file").addEventListener("click", async () => {
  const files = await window.loom.pickFile();
  for (const p of files) await addAttachment({ name: baseName(p), path: p, isImage: IMAGE_EXTS.includes(extOf(p)) });
});

$("pick-folder").addEventListener("click", async () => {
  const folder = await window.loom.pickFolder();
  if (folder) {
    setStatus("Carpeta: " + folder);
    input.value += `\nTrabajá en la carpeta: ${folder}\n`;
  }
});

// Drag & drop
const dropZone = $("drop-zone");
document.body.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("active"); });
document.body.addEventListener("dragleave", (e) => { if (!e.relatedTarget) dropZone.classList.remove("active"); });
document.body.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("active");
  for (const f of [...e.dataTransfer.files]) await addBrowserFile(f);
});

// Pegar imágenes del portapapeles (Ctrl+V)
input.addEventListener("paste", async (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); for (const f of files) await addBrowserFile(f); }
});

// ------------------------------------------------------------ enviar
async function sendMessage() {
  const tab = activeTab();
  if (!tab || tab.busy) return;
  const text = input.value.trim();
  if (!text && !tab.attachments.length) return;
  if (tab.attachments.some((a) => a.isImage) && !modelHasVision(tab.model)) await ensureVisionModel();

  const toSend = tab.attachments.map(({ name, path, dataUrl }) => ({ name, path, dataUrl }));
  const label = tab.attachments.length ? `\n${tab.attachments.map((a) => (a.isImage ? "🖼️ " : "📄 ") + a.name).join("\n")}` : "";
  input.value = "";
  tab.draft = "";
  tab.attachments = [];
  renderAttachments();
  addMessage(tab, "user", text + label);
  tab.busy = true;
  renderTabs();
  updateSendState();
  setStatus("Pensando...");

  tab.busySince = Date.now();
  tab.stopping = false;
  setActivity(tab, "Preparando el mensaje", "", 30);
  const res = await window.loom.sendMessage(tab.id, text, toSend);
  if (res && res.ok === false && tab.busy) { tab.busy = false; tab.activity = null; renderTabs(); updateSendState(); renderActivity(); }
}

sendBtn.addEventListener("click", () => (activeTab()?.busy ? stopActive() : sendMessage()));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  else if (e.key === "Escape" && activeTab()?.busy) { e.preventDefault(); stopActive(); }
});

// ------------------------------------------------------------ eventos del proceso principal (todos traen tabId)
window.loom.onTabUpdated((info) => {
  const t = tabs.get(info.id);
  if (!t) return;
  Object.assign(t, { name: info.name, model: info.model, busy: info.busy, ctx: info.ctx, ctxReal: info.ctxReal });
  if (!info.busy) { t.activity = null; t.busySince = 0; t.stopping = false; }
  renderTabs();
  if (info.id === activeId) { updateSendState(); updateCtx(); renderActivity(); if (!info.busy && statusEl.textContent === "Pensando...") setStatus("Listo"); }
});

window.loom.onAssistantMessage(({ tabId, text }) => {
  const t = tabs.get(tabId);
  if (!t) return;
  addMessage(t, "assistant", text);
  if (tabId !== activeId) { t.unread = true; renderTabs(); } else setStatus("Listo");
});

// Pasos del agente: la barra de actividad muestra el paso actual; el chat guarda el registro (con "Detalle de pasos").
const verboseBox = $("verbose");
verboseBox.checked = localStorage.getItem("loomVerbose") !== "0";
const applyVerbose = () => document.body.classList.toggle("verbose", verboseBox.checked);
verboseBox.addEventListener("change", () => { localStorage.setItem("loomVerbose", verboseBox.checked ? "1" : "0"); applyVerbose(); });
applyVerbose();

window.loom.onProgress((p) => {
  const t = tabs.get(p.tabId);
  if (!t) return;
  switch (p.kind) {
    case "model-start":
      setActivity(t, `Paso ${p.step} · esperando al modelo`, `${p.model} · contexto ~${fmtTok(p.ctx)}`, 90);
      break;
    case "model-done": {
      const tok = p.promptTokens ? ` · ${fmtTok(p.promptTokens)} entrada + ${fmtTok(p.completionTokens || 0)} salida` : "";
      const what = p.toolCalls ? `pide ${p.toolCalls} herramienta${p.toolCalls > 1 ? "s" : ""}` : "respuesta final";
      addMessage(t, "log", `← Paso ${p.step}: el modelo respondió en ${fmtDur(p.ms)}${tok} · ${what}`);
      break;
    }
    case "retry":
      setActivity(t, `Paso ${p.step} · ${p.reason} · reintento ${p.attempt + 1}/${p.max} en {s}s`, "", 60, Date.now() + p.waitMs);
      addMessage(t, "log warn", `⚠ Paso ${p.step}: ${p.reason}. Reintento ${p.attempt + 1}/${p.max} en ${Math.round(p.waitMs / 1000)}s.`);
      break;
    case "tool-start":
      setActivity(t, `Paso ${p.step} · ejecutando ${p.name}`, p.summary, 45);
      break;
    case "stopped":
      addMessage(t, "system", p.text);
      break;
    case "tool-done":
      addMessage(t, p.ok ? "log" : "log warn", `${p.ok ? "✓" : "✗"} Paso ${p.step}: ${p.name} ${p.ok ? "terminó" : "falló"} en ${fmtDur(p.ms)}${p.chars ? ` · ${fmtTok(p.chars)} caracteres` : ""}`);
      break;
  }
});

window.loom.onToolCall(({ tabId, name, args }) => { const t = tabs.get(tabId); if (t) addMessage(t, "tool", `[tool] ${name} ${JSON.stringify(args)}`); });
window.loom.onToolResult(({ tabId, result }) => { const t = tabs.get(tabId); if (t) addMessage(t, "tool", `→ ${result.slice(0, 500)}`); });
window.loom.onError(({ tabId, message }) => {
  const t = tabs.get(tabId);
  if (!t) return;
  addMessage(t, "error", "Error: " + message);
  if (tabId === activeId) setStatus("Error");
  else { t.unread = true; renderTabs(); }
});

// ------------------------------------------------------------ conversaciones guardadas
const modal = $("saved-modal");
const savedList = $("saved-list");
const closeSaved = () => { modal.hidden = true; $("open-saved").focus(); };

async function openSavedDialog() {
  const list = await window.loom.listSaved();
  savedList.innerHTML = "";
  $("saved-empty").hidden = list.length > 0;
  for (const c of list) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.className = "open";
    const name = document.createElement("span"); name.className = "name"; name.textContent = c.name;
    const meta = document.createElement("span"); meta.className = "meta";
    meta.textContent = `${new Date(c.updatedAt).toLocaleString()} · ${c.messages} mensaje${c.messages === 1 ? "" : "s"}${c.model ? " · " + c.model : ""}`;
    open.append(name, meta);
    open.addEventListener("click", async () => {
      const info = await window.loom.openSaved(c.id);
      if (!info) return;
      modal.hidden = true;
      if (!tabs.has(info.id)) addTab(info);
      activate(info.id, { notify: false });
    });
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "🗑";
    del.title = "Borrar para siempre";
    del.setAttribute("aria-label", "Borrar " + c.name);
    del.addEventListener("click", async () => {
      if (!confirm(`¿Borrar "${c.name}" para siempre?`)) return;
      await window.loom.deleteSaved(c.id);
      li.remove();
      $("saved-empty").hidden = savedList.childElementCount > 0;
    });
    li.append(open, del);
    savedList.appendChild(li);
  }
  modal.hidden = false;
  (savedList.querySelector(".open") || $("saved-close")).focus();
}

$("open-saved").addEventListener("click", openSavedDialog);
$("saved-close").addEventListener("click", closeSaved);
modal.addEventListener("click", (e) => { if (e.target === modal) closeSaved(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeSaved(); });

// ------------------------------------------------------------ arranque
(async function init() {
  await loadLanguages();

  // La llave vieja de localStorage ya no se migra: las llaves se cargan en Configuración ⚙️.
  localStorage.removeItem("loomApiKey");

  // Cargar estado y modelos (los modelos dependen de que la key esté seteada)
  const state = await window.loom.getState();
  allModels = await window.loom.getModels(true);
  renderProviderFilters();
  state.tabs.forEach(addTab);
  activate(state.active, { notify: false });
  applyTranslations();
})();
