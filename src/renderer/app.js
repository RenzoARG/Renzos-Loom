const $ = (id) => document.getElementById(id);
const tabsEl = $("tabs");
const chatsEl = $("chats");
const input = $("input");
const sendBtn = $("send");
const modelSelect = $("model-select");
const statusEl = $("status");
const filterVision = $("filter-vision");
const filterFree = $("filter-free");
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

// ------------------------------------------------------------ mensajes
function addMessage(tab, role, text) {
  tab.el.querySelector(".empty")?.remove();
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
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
  const tab = { id: info.id, name: info.name, model: info.model, busy: !!info.busy, unread: false, el, draft: "", attachments: [] };
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

function updateSendState() {
  const t = activeTab();
  sendBtn.disabled = !t || t.busy;
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
}

function saveLanguage(code) {
  currentLang = code;
  localStorage.setItem("loomLanguage", code);
  applyTranslations();
}

// ------------------------------------------------------------ pestaña de configuración
let configPanelEl = null;

function createConfigPanel() {
  if (configPanelEl) return configPanelEl;
  const div = document.createElement("div");
  div.className = "config-panel";
  div.style.cssText = "padding: 24px; max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;";

  const h2 = document.createElement("h2");
  h2.textContent = t("configure");
  h2.style.cssText = "font-size: 20px; margin: 0; color: var(--text);";

  const desc = document.createElement("p");
  desc.textContent = t("configureDesc");
  desc.style.cssText = "font-size: 14px; color: var(--muted); margin: 0;";

  // API Key
  const apiKeyGroup = document.createElement("div");
  apiKeyGroup.style.cssText = "display: flex; flex-direction: column; gap: 8px;";
  const apiKeyLabel = document.createElement("label");
  apiKeyLabel.textContent = t("apiKey");
  apiKeyLabel.style.cssText = "font-size: 14px; color: var(--text);";
  const apiKeyInput = document.createElement("input");
  apiKeyInput.type = "password";
  apiKeyInput.id = "config-api-key-input";
  apiKeyInput.placeholder = t("apiKeyPlaceholder");
  apiKeyInput.style.cssText = "padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 14px;";
  apiKeyGroup.appendChild(apiKeyLabel);
  apiKeyGroup.appendChild(apiKeyInput);

  // Idioma
  const langGroup = document.createElement("div");
  langGroup.style.cssText = "display: flex; flex-direction: column; gap: 8px;";
  const langLabel = document.createElement("label");
  langLabel.textContent = t("language");
  langLabel.style.cssText = "font-size: 14px; color: var(--text);";
  const langSelect = document.createElement("select");
  langSelect.style.cssText = "padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); font-size: 14px;";
  for (const code in langDict) {
    const opt = document.createElement("option");
    opt.value = code;
    // Cada idioma se muestra con su nombre nativo (no traducido)
    opt.textContent = code === "es" ? "Español" : code === "en" ? "English" : code;
    langSelect.appendChild(opt);
  }
  langSelect.value = currentLang;
  // Guardar referencias a las opciones para actualizarlas al cambiar idioma
  const langOptions = Array.from(langSelect.options);
  langSelect.onchange = (e) => {
    saveLanguage(e.target.value);
    langSelect.value = currentLang;
    h2.textContent = t("configure");
    desc.textContent = t("configureDesc");
    langLabel.textContent = t("language");
    btnClose.textContent = t("ready");
    // Los nombres de idioma no cambian (son nativos)
  };
  langGroup.appendChild(langLabel);
  langGroup.appendChild(langSelect);

  // Botón cerrar
  const btnClose = document.createElement("button");
  btnClose.textContent = t("ready");
  btnClose.style.cssText = "padding: 10px 24px; border: none; border-radius: 6px; background: var(--blue); color: #fff; cursor: pointer; font-size: 14px; align-self: flex-start; margin-top: 8px;";
  btnClose.onclick = async () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem("loomApiKey", key);
      try {
        await window.loom.setApiKey(key);
        // Recargar modelos con la nueva API Key
        const models = await window.loom.getModels();
        allModels = models;
        renderModelOptions();
        setStatus("API Key guardada y modelos cargados");
      } catch (e) {
        setStatus("Error guardando API Key: " + e.message);
      }
      hideConfigPanel();
    } else {
      localStorage.removeItem("loomApiKey");
      try {
        await window.loom.setApiKey("");
        allModels = [];
        renderModelOptions();
        setStatus("API Key eliminada");
      } catch (e) {
        setStatus("Error eliminando API Key");
      }
      hideConfigPanel();
    }
  };

  div.appendChild(h2);
  div.appendChild(desc);
  div.appendChild(apiKeyGroup);
  div.appendChild(langGroup);
  div.appendChild(btnClose);

  configPanelEl = div;
  return div;
}

function showConfigPanel() {
  const t = activeTab();
  if (!t) return;
  t.el.style.display = "none";
  const panel = createConfigPanel();
  chatsEl.appendChild(panel);
  panel.style.display = "flex";
  $("input-bar")?.style.setProperty("display", "none", "important");
  $("attachments")?.style.setProperty("display", "none", "important");
  
  // Mostrar API Key guardada en el input
  const savedKey = localStorage.getItem("loomApiKey");
  const apiKeyInput = document.getElementById("config-api-key-input");
  if (apiKeyInput && savedKey) {
    apiKeyInput.value = savedKey;
  }
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
const visibleModels = () => allModels.filter((m) => (!filterVision.checked || m.vision) && (!filterFree.checked || m.free));

function renderModelOptions() {
  const t = activeTab();
  const list = visibleModels();
  // Si el modelo de la pestaña quedó fuera del filtro, igual lo mostramos para que el select diga la verdad.
  const current = allModels.find((m) => m.id === t?.model);
  const shown = current && !list.includes(current) ? [current, ...list] : list;
  modelSelect.innerHTML = "";
  if (t && !current) { // modelo que no está en la lista (ej: el del .env)
    const opt = document.createElement("option");
    opt.value = t.model;
    opt.textContent = t.model;
    modelSelect.appendChild(opt);
  }
  shown.slice(0, 400).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.caps} ${m.id} (${Math.round(m.context / 1000)}k)`;
    modelSelect.appendChild(opt);
  });
  if (t) modelSelect.value = t.model;
  $("model-id").textContent = t ? t.model : "";
}

async function changeModel(id) {
  const t = activeTab();
  if (!t) return;
  const res = await window.loom.setModel(t.id, id);
  const newModel = (res && res.model) || res || id;
  t.model = newModel;
  if (res && res.handoffNote) addMessage(t, "system", res.handoffNote);
  modelSelect.value = t.model;
  $("model-id").textContent = t.model;
  renderTabs();
}

modelSelect.addEventListener("change", async () => {
  await changeModel(modelSelect.value);
  const t = activeTab();
  setStatus("Modelo: " + t.model);
  if (t.attachments.some((a) => a.isImage) && !modelHasVision(t.model)) setStatus("⚠ Este modelo no tiene visión: las imágenes adjuntas darán error");
});
filterVision.addEventListener("change", renderModelOptions);
filterFree.addEventListener("change", renderModelOptions);

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

  const res = await window.loom.sendMessage(tab.id, text, toSend);
  if (res && res.ok === false && tab.busy) { tab.busy = false; renderTabs(); updateSendState(); }
}

sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ------------------------------------------------------------ eventos del proceso principal (todos traen tabId)
window.loom.onTabUpdated((info) => {
  const t = tabs.get(info.id);
  if (!t) return;
  Object.assign(t, { name: info.name, model: info.model, busy: info.busy });
  renderTabs();
  if (info.id === activeId) { updateSendState(); if (!info.busy && statusEl.textContent === "Pensando...") setStatus("Listo"); }
});

window.loom.onAssistantMessage(({ tabId, text }) => {
  const t = tabs.get(tabId);
  if (!t) return;
  addMessage(t, "assistant", text);
  if (tabId !== activeId) { t.unread = true; renderTabs(); } else setStatus("Listo");
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

  // Cargar API Key guardada en localStorage y aplicarla al cliente OpenAI
  const savedKey = localStorage.getItem("loomApiKey");
  if (savedKey) {
    try {
      await window.loom.setApiKey(savedKey);
    } catch (e) {
      console.warn("No se pudo aplicar API Key guardada:", e);
    }
  }

  // Cargar estado y modelos (los modelos dependen de que la key esté seteada)
  const state = await window.loom.getState();
  allModels = await window.loom.getModels();
  state.tabs.forEach(addTab);
  activate(state.active, { notify: false });
  applyTranslations();
})();
