import "dotenv/config";
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import OpenAI from "openai";
import { tools, executeTool, runBashAsync } from "../tools/index.js";
import {
  saveConversation, loadConversation, listConversations, deleteConversation,
  saveWorkspace, loadWorkspace, newId, SESSIONS_DIR,
} from "../context/sessions.js";

const APP_NAME = "Renzo's Loom";
app.setName(APP_NAME);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- llaves de API (múltiples)
// Cada entrada tiene su propio cliente OpenAI-compatible. Para saber qué modelo va por qué llave
// pedimos /models a cada entrada y etiquetamos los modelos con keyId (ver getAvailableModels).
// Las llaves se guardan SOLO en main: el renderer recibe como máximo (provider, endpoint, keyTail).
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const PROVIDER_PRESETS = {
  openrouter: { label: "OpenRouter", baseURL: OPENROUTER_BASE },
  openai: { label: "OpenAI", baseURL: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic", baseURL: "https://api.anthropic.com/v1" },
  google: { label: "Google (Gemini, OpenAI-compatible)", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  xai: { label: "xAI (Grok)", baseURL: "https://api.x.ai/v1" },
  deepseek: { label: "DeepSeek", baseURL: "https://api.deepseek.com/v1" },
  groq: { label: "Groq", baseURL: "https://api.groq.com/openai/v1" },
  together: { label: "Together AI", baseURL: "https://api.together.xyz/v1" },
  mistral: { label: "Mistral", baseURL: "https://api.mistral.ai/v1" },
  custom: { label: "Personalizado", baseURL: "" },
};

let apiKeys = [];          // [{ id, provider, providerId, baseURL, key }]
let clients = new Map();   // id -> cliente OpenAI
let keyStatus = {};        // id -> { estado: "ok"|"error"|"untested", detalle, checkedAt }

function maskKey(key) {
  if (!key) return "";
  return key.length <= 8 ? "••••" : key.slice(0, 4) + "…•••" + key.slice(-4);
}
function apiKeySummary(e) {
  return {
    id: e.id, provider: e.provider || "Personalizado", providerId: e.providerId || "custom",
    baseURL: e.baseURL || "", keyTail: maskKey(e.key), status: keyStatus[e.id] || { estado: "untested" },
  };
}

const KEYS_FILE = path.join(SESSIONS_DIR, "_api_keys.json");
function saveApiKeys() {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const tmp = KEYS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(apiKeys.map(({ id, providerId, baseURL, key }) => ({ id, providerId, baseURL, key })), null, 2));
    fs.renameSync(tmp, KEYS_FILE);
  } catch (e) { console.error("saveApiKeys:", e.message); }
}
function loadApiKeys() {
  apiKeys = [];
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
      if (Array.isArray(arr)) {
        for (const a of arr) {
          if (!a?.key) continue;
          const providerId = a.providerId || "custom";
          apiKeys.push({
            id: a.id || newId(),
            provider: PROVIDER_PRESETS[providerId]?.label || "Personalizado",
            providerId,
            baseURL: a.baseURL || PROVIDER_PRESETS[providerId]?.baseURL || "",
            key: a.key,
          });
        }
      }
    }
  } catch (e) { console.error("loadApiKeys:", e.message); }
  // Las llaves viven solo en Configuración ⚙️ (sessions/_api_keys.json). Sin fallback de .env.
  for (const e of apiKeys) initClientFor(e);
  // La primera llave es la "activa" para el IPC viejo (get/set-api-key) y para la migración del renderer.
  if (apiKeys[0]) { apiKey = apiKeys[0].key; client = clients.get(apiKeys[0].id) || null; }
}

function initClientFor(e) {
  clients.set(e.id, new OpenAI({
    baseURL: e.baseURL || undefined,
    apiKey: e.key || undefined,
    maxRetries: 0,
  }));
}
function initAllClients() {
  clients = new Map();
  for (const e of apiKeys) initClientFor(e);
}

// Compatibilidad con lo que ya existe (una sola llave activa = la primera).
let apiKey = null;
let client = null;
function initOpenAIClient(key) {
  apiKey = key;
  client = new OpenAI({
    baseURL: OPENROUTER_BASE,
    apiKey: key || undefined,
    maxRetries: 0,
  });
}
function syncLegacyKey() {
  if (apiKeys[0]) { apiKey = apiKeys[0].key; client = clients.get(apiKeys[0].id) || null; }
  else { apiKey = null; client = null; }
}

const FALLBACK_MODEL = "openai/gpt-4o-mini";
const SYSTEM_PROMPT = "Sos Renzo's Loom, un asistente de coding. Tenes herramientas para leer/escribir archivos, ejecutar comandos, listar directorios y buscar texto. Usalas para ayudar al usuario. Se conciso.";
const IMG_PREFIX = "__IMAGE_BASE64__:";
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp" };
const MAX_TEXT_ATTACH = 200_000; // chars
const DEFAULT_TAB_NAME = "Nueva conversación";

let mainWindow = null;
let modelsCache = [];
let modelsFetchedAt = 0;
let defaultModel = FALLBACK_MODEL;

// Cada pestaña es una conversación independiente: su propio historial, su propio modelo.
const tabs = new Map();   // id -> { id, name, autoName, model, createdAt, history, busy, closed }
let openIds = [];         // orden de las pestañas abiertas
let activeId = null;

// ---------------------------------------------------------------- modelos
// Búsqueda web NATIVA del proveedor. Ojo: el plugin "web" de OpenRouter (":online") funciona con cualquier
// modelo, pero cuesta créditos incluso en modelos gratis; eso NO se marca acá.
const hasNativeWebSearch = (m) =>
  !!m.supported_parameters?.includes("web_search_options") ||
  Number(m.pricing?.web_search) > 0 ||
  m.id.startsWith("perplexity/");

// Devuelve TODOS los modelos con tool calling, con flags de capacidades.
// Pide /models a cada llave guardada y etiqueta cada modelo con keyId/provider para
// poder elegir la llave correcta al responder (callModel usa keyForModel()).
async function getAvailableModels(force = false) {
  if (!apiKeys.length) return [];
  if (!force && modelsCache.length && Date.now() - modelsFetchedAt < 10 * 60_000) return modelsCache;
  const byId = new Map();
  for (const entry of apiKeys) {
    const base = (entry.baseURL || "").replace(/\/$/, "");
    if (!base) continue;
    const url = `${base}/models`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${entry.key}` }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const { data } = await res.json();
      for (const m of (data || [])) {
        const inputs = m.architecture?.input_modalities
          ?? m.architecture?.modality?.split("->")[0].split("+")
          ?? ["text"];
        const free = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
        const info = {
          id: m.id,
          name: m.name,
          context: m.context_length || m.contextLength || 0,
          vision: inputs.includes("image"),
          files: inputs.includes("file"),
          audio: inputs.includes("audio"),
          reasoning: !!m.supported_parameters?.includes("reasoning"),
          web: hasNativeWebSearch(m),
          free,
          keyId: entry.id,
          provider: entry.provider || entry.providerId || "Personalizado",
          providerId: entry.providerId || "custom",
        };
        info.caps = ["🔧", info.vision && "👁️", info.audio && "🎤", info.files && "📄", info.reasoning && "🧠", info.web && "🌐", free && "💰"].filter(Boolean).join(" ");
        // Si dos llaves exponen el mismo modelo, preferimos la de contexto mayor; en empate, la primera.
        const prev = byId.get(info.id);
        if (!prev || info.context > (prev.context || 0)) byId.set(info.id, info);
      }
    } catch (e) {
      console.error(`getAvailableModels (${entry.provider}):`, e.message);
    }
  }
  modelsCache = [...byId.values()].sort((a, b) => b.context - a.context);
  if (modelsCache.length) modelsFetchedAt = Date.now();
  return modelsCache;
}

function keyForModel(modelId) {
  const info = modelsCache.find((m) => m.id === modelId);
  if (info?.keyId) {
    const entry = apiKeys.find((e) => e.id === info.keyId);
    if (entry && clients.has(entry.id)) return { client: clients.get(entry.id), entry };
  }
  // Fallback: primera llave disponible.
  const first = apiKeys[0];
  return first ? { client: clients.get(first.id), entry: first } : null;
}

// Si no conocemos el modelo, dejamos que decida la API.
const modelSupportsVision = (id) => {
  const info = modelsCache.find((m) => m.id === id);
  return info ? info.vision : true;
};

function pickDefaultModel(models) {
  return (models.find((m) => m.free && m.vision) || models.find((m) => m.free) || models[0])?.id ?? FALLBACK_MODEL;
}

const validModel = (id) => (id && (!modelsCache.length || modelsCache.some((m) => m.id === id)) ? id : defaultModel);

// ---------------------------------------------------------------- mensajes
function buildUserMessage(tab, text, attachments = []) {
  if (!attachments.length) return { role: "user", content: text };

  let extraText = "";
  const parts = [];
  for (const a of attachments) {
    const ext = path.extname(a.name || a.path || "").toLowerCase();
    const isImage = a.dataUrl?.startsWith("data:image/") || IMAGE_MIME[ext];
    if (isImage) {
      const url = a.dataUrl ?? `data:${IMAGE_MIME[ext]};base64,${fs.readFileSync(a.path).toString("base64")}`;
      parts.push({ type: "image_url", image_url: { url } });
    } else if (ext === ".pdf") {
      const b64 = a.dataUrl ? a.dataUrl.split(",")[1] : fs.readFileSync(a.path).toString("base64");
      parts.push({ type: "file", file: { filename: a.name || path.basename(a.path), file_data: `data:application/pdf;base64,${b64}` } });
    } else {
      const buf = a.dataUrl ? Buffer.from(a.dataUrl.split(",")[1], "base64") : fs.readFileSync(a.path);
      const content = buf.toString("utf8");
      const name = a.name || path.basename(a.path);
      if (content.includes("\u0000")) extraText += `\n\n[Archivo binario adjunto: ${a.path || name}]`;
      else extraText += `\n\n--- Archivo: ${name} ---\n${content.slice(0, MAX_TEXT_ATTACH)}`;
    }
  }

  if (!parts.length) return { role: "user", content: text + extraText };
  if (parts.some((p) => p.type === "image_url") && !modelSupportsVision(tab.model)) {
    throw new Error(`El modelo "${tab.model}" no acepta imágenes. Elegí uno con 👁️ (activá el filtro "Solo con visión").`);
  }
  return { role: "user", content: [{ type: "text", text: (text + extraText) || "Mirá el/los adjunto(s)." }, ...parts] };
}

// Si cambiaste a un modelo sin visión, el historial viejo con imágenes haría fallar la request.
function historyForModel(tab) {
  let msgs = tab.history;
  if (!modelSupportsVision(tab.model)) {
    msgs = msgs.map((m) => Array.isArray(m.content)
      ? { ...m, content: m.content.map((p) => p.type === "image_url" ? { type: "text", text: "[imagen omitida: el modelo actual no tiene visión]" } : p) }
      : m);
  }
  // Si acabamos de cambiar de agente, adjuntamos explícitamente el contexto de traspaso
  // como un mensaje de usuario, para que el nuevo modelo lo tome con claridad.
  if (tab.pendingHandoff) {
    const { from, to } = tab.pendingHandoff;
    msgs = msgs.concat([{ role: "user", content: `🔄 Cambio de agente: la conversación anterior la sostuvo "${from}". A partir de ahora la sostenés vos ("${to}"). Revisá el historial completo de arriba y continuá sin repetir información ya dada.` }]);
  }
  return msgs;
}

// Historial -> mensajes simples para dibujar en la UI al restaurar una pestaña.
function toUiMessages(history) {
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
  const out = [];
  for (const m of history) {
    if (m.role === "system") {
      // El prompt del sistema original no se muestra; las notas de cambio de agente sí.
      if (m.content && m.content !== SYSTEM_PROMPT) out.push({ role: "system", text: String(m.content) });
      continue;
    }
    if (m.role === "user") {
      const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
      const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      const imgs = parts.filter((p) => p.type === "image_url").length;
      if (text.startsWith("Imagen(es) solicitadas con read_file")) out.push({ role: "tool", text: "🖼️ imagen cargada" });
      else out.push({ role: "user", text: clip(text, 1500) + (imgs ? `\n🖼️ ${imgs} imagen${imgs > 1 ? "es" : ""}` : "") });
    } else if (m.role === "assistant") {
      if (m.content) out.push({ role: "assistant", text: String(m.content) });
      for (const tc of m.tool_calls || []) out.push({ role: "tool", text: `[tool] ${tc.function.name} ${tc.function.arguments}` });
    } else if (m.role === "tool") {
      out.push({ role: "tool", text: "→ " + clip(String(m.content), 500) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- pestañas
function makeTab({ id = newId(), name = DEFAULT_TAB_NAME, autoName = true, model, createdAt = Date.now(), history } = {}) {
  const tab = {
    id, name, autoName, createdAt,
    model: model || defaultModel,
    history: history ?? [{ role: "system", content: SYSTEM_PROMPT }],
    busy: false, closed: false, pendingHandoff: null, usage: null, stopped: false, abort: null,
  };
  tabs.set(id, tab);
  return tab;
}

// Tokens aproximados de un historial. No cuenta el base64 de imágenes/PDF (valor fijo por adjunto).
function estimateTokens(history, withOverhead = true) {
  let chars = 0, extra = withOverhead ? 600 : 0; // ~600: definiciones de las tools
  for (const m of history) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text") chars += p.text?.length ?? 0;
        else if (p.type === "image_url") extra += 1000;
        else if (p.type === "file") extra += 2000;
      }
    } else chars += String(m.content ?? "").length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.round(chars / 3.5) + extra;
}

// Contexto de la pestaña: el número real de la API (usage) más una estimación de lo agregado después.
function tabCtx(tab) {
  const u = tab.usage;
  if (u && u.hlen <= tab.history.length) {
    const tail = u.hlen < tab.history.length ? estimateTokens(tab.history.slice(u.hlen), false) : 0;
    return { ctx: u.tokens + tail, ctxReal: u.hlen === tab.history.length };
  }
  return { ctx: estimateTokens(tab.history), ctxReal: false };
}

const tabInfo = (t) => ({ id: t.id, name: t.name, model: t.model, busy: t.busy, ...tabCtx(t) });
const tabPayload = (t) => ({ ...tabInfo(t), messages: toUiMessages(t.history) });

// Las pestañas vacías no se guardan: no ensucian la carpeta sessions/.
function persistTab(tab) {
  if (!tab.history.some((m) => m.role === "user")) return;
  try { saveConversation(tab); } catch (e) { console.error("persistTab:", e.message); }
}
function persistWorkspace() {
  try { saveWorkspace({ open: openIds, active: activeId }); } catch (e) { console.error("persistWorkspace:", e.message); }
}

function restoreWorkspace() {
  const ws = loadWorkspace();
  for (const id of ws.open || []) {
    try {
      const c = loadConversation(id);
      if (!c || tabs.has(c.id)) continue;
      makeTab({ ...c, model: validModel(c.model) });
      openIds.push(c.id);
    } catch (e) { console.error("restore", id, e.message); }
  }
  if (!openIds.length) openIds.push(makeTab().id);
  activeId = openIds.includes(ws.active) ? ws.active : openIds[0];
  persistWorkspace();
}

function autoNameFrom(text, attachments) {
  const base = (text || "").replace(/\s+/g, " ").trim() || attachments?.[0]?.name || "";
  if (!base) return null;
  return base.length > 28 ? base.slice(0, 27).trimEnd() + "…" : base;
}

// ---------------------------------------------------------------- ventana
const emit = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

function createWindow() {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  mainWindow = new BrowserWindow({
    width: 1180, height: 760,
    title: APP_NAME,
    icon: path.join(__dirname, "../assets", iconFile),
    backgroundColor: "#0e1320",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.maximize();
  mainWindow.on("closed", () => { mainWindow = null; });

  // Atajos: se interceptan acá para que el menú por defecto de Electron (Ctrl+W = cerrar ventana) no los pise.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    const key = input.key.toLowerCase();
    const action = key === "t" ? "new-tab" : key === "w" ? "close-tab" : key === "tab" ? (input.shift ? "prev-tab" : "next-tab") : null;
    if (action) { event.preventDefault(); emit("shortcut", action); }
  });
}

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("com.renzo.loom");
  loadApiKeys();
  const models = await getAvailableModels();
  defaultModel = pickDefaultModel(models);
  restoreWorkspace();
  createWindow();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// ---------------------------------------------------------------- IPC: pestañas
ipcMain.handle("get-state", () => ({ active: activeId, tabs: openIds.map((id) => tabPayload(tabs.get(id))) }));

ipcMain.handle("new-tab", (event, fromId) => {
  const base = tabs.get(fromId) || tabs.get(activeId);
  const tab = makeTab({ model: base?.model });
  openIds.push(tab.id);
  activeId = tab.id;
  persistWorkspace();
  return tabPayload(tab);
});

ipcMain.handle("activate-tab", (event, id) => {
  if (!tabs.has(id)) return false;
  activeId = id;
  persistWorkspace();
  return true;
});

// Cerrar una pestaña NO borra la conversación: queda en "Guardadas".
ipcMain.handle("close-tab", (event, id) => {
  const tab = tabs.get(id);
  if (!tab) return { active: activeId, created: null };
  tab.closed = true; // si estaba respondiendo, el ciclo se corta solo
  tab.abort?.abort(); // y la request o el comando en curso se cancelan de verdad
  persistTab(tab);
  tabs.delete(id);
  const idx = openIds.indexOf(id);
  openIds.splice(idx, 1);
  let created = null;
  if (!openIds.length) { const t = makeTab({ model: tab.model }); openIds.push(t.id); created = tabPayload(t); }
  if (activeId === id || !tabs.has(activeId)) activeId = openIds[Math.min(idx, openIds.length - 1)];
  persistWorkspace();
  return { active: activeId, created };
});

ipcMain.handle("rename-tab", (event, id, name) => {
  const tab = tabs.get(id);
  if (!tab) return null;
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (clean) { tab.name = clean; tab.autoName = false; persistTab(tab); }
  return tab.name;
});

ipcMain.handle("set-model", (event, id, modelId) => {
  const tab = tabs.get(id);
  if (!tab) return null;
  const oldModel = tab.model;
  const changed = oldModel !== modelId;
  const hasConversation = tab.history.some((m) => m.role === "user");
  tab.model = defaultModel = modelId; // las pestañas nuevas heredan el último modelo elegido
  let handoffNote = null;
  if (changed && hasConversation) {
    handoffNote = `🔄 Cambio de agente: la conversación anterior la sostuvo "${oldModel}". A partir de ahora la sostenés vos ("${modelId}"). Revisá el historial y continuá sin repetir información ya dada.`;
    tab.history.push({ role: "system", content: handoffNote });
    tab.pendingHandoff = { from: oldModel, to: modelId };
  }
  persistTab(tab);
  return { model: tab.model, handoffNote, ...tabCtx(tab) };
});

ipcMain.handle("list-saved", () => listConversations().filter((c) => !tabs.has(c.id)));

ipcMain.handle("open-saved", (event, id) => {
  let tab = tabs.get(id);
  if (!tab) {
    const c = loadConversation(id);
    if (!c) return null;
    tab = makeTab({ ...c, model: validModel(c.model) });
    openIds.push(tab.id);
  }
  activeId = tab.id;
  persistWorkspace();
  return tabPayload(tab);
});

ipcMain.handle("delete-saved", (event, id) => {
  if (tabs.has(id)) return false; // solo se borran las que no están abiertas
  deleteConversation(id);
  return true;
});

ipcMain.handle("get-models", async (event, force) => getAvailableModels(force));

// ---------------------------------------------------------------- IPC: API Keys (múltiples)
ipcMain.handle("get-api-key", () => apiKey);
ipcMain.handle("set-api-key", (event, key) => {
  // Migra la llave vieja (del formulario anterior) como primera entrada OpenRouter si la lista está vacía.
  if (key && !apiKeys.length) {
    apiKeys.push({ id: newId(), provider: "OpenRouter", providerId: "openrouter", baseURL: OPENROUTER_BASE, key: key.trim() });
    saveApiKeys();
    syncLegacyKey();
    void getAvailableModels(true);
  } else if (key) {
    apiKeys[0].key = key.trim();
    saveApiKeys();
    initClientFor(apiKeys[0]);
    syncLegacyKey();
    void getAvailableModels(true);
  } else {
    apiKey = null;
    client = null;
  }
  return { ok: true, key: !!key };
});

ipcMain.handle("list-api-keys", () => apiKeys.map(apiKeySummary));
ipcMain.handle("add-api-key", (event, { providerId, provider, baseURL, key }) => {
  const pid = PROVIDER_PRESETS[providerId] ? providerId : "custom";
  const entry = {
    id: newId(),
    provider: (provider || PROVIDER_PRESETS[pid]?.label || "Personalizado").toString(),
    providerId: pid,
    baseURL: (baseURL || PROVIDER_PRESETS[pid]?.baseURL || "").trim(),
    key: (key || "").trim(),
  };
  if (!entry.key) return { ok: false, error: "Falta la API key" };
  apiKeys.push(entry);
  initClientFor(entry);
  saveApiKeys();
  syncLegacyKey();
  keyStatus[entry.id] = { estado: "untested" };
  void getAvailableModels(true);
  return { ok: true, entry: apiKeySummary(entry) };
});
ipcMain.handle("delete-api-key", (event, id) => {
  const idx = apiKeys.findIndex((e) => e.id === id);
  if (idx < 0) return { ok: false };
  apiKeys.splice(idx, 1);
  clients.delete(id);
  delete keyStatus[id];
  saveApiKeys();
  syncLegacyKey();
  void getAvailableModels(true);
  return { ok: true };
});
ipcMain.handle("test-api-key", async (event, id) => {
  const entry = apiKeys.find((e) => e.id === id);
  if (!entry) return { ok: false, estado: "error", detalle: "Llave no encontrada" };
  const base = (entry.baseURL || "").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${entry.key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const { data } = await res.json();
    const n = Array.isArray(data) ? data.length : 0;
    keyStatus[entry.id] = { estado: "ok", detalle: `${n} modelos`, checkedAt: Date.now() };
    return { ok: true, estado: "ok", detalle: `${n} modelos`, checkedAt: Date.now() };
  } catch (e) {
    keyStatus[entry.id] = { estado: "error", detalle: e.message, checkedAt: Date.now() };
    return { ok: false, estado: "error", detalle: e.message };
  }
});

// ---------------------------------------------------------------- llamadas al modelo con progreso visible
const MODEL_TIMEOUT_MS = 180_000;                  // sin respuesta en 3 min = se considera colgado
const MAX_ATTEMPTS = 4;
const RETRY_WAITS_MS = [5_000, 15_000, 30_000];    // espera antes del 2°, 3° y 4° intento (o Retry-After)
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("abortado"));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("abortado")); }, { once: true });
});

async function callModel(tab, step) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const picked = keyForModel(tab.model);
      if (!picked?.client) { const e = new Error("No hay API Key configurada. Abrí Configuración (⚙️) y agregá una llave."); e.status = 401; throw e; }
      const resp = await picked.client.chat.completions.create(
        { model: tab.model, messages: historyForModel(tab), tools },
        { timeout: MODEL_TIMEOUT_MS, signal: tab.abort?.signal },
      );
      // OpenRouter a veces devuelve HTTP 200 con {error} (típico en modelos gratis): sin esto aparece "Cannot read properties of undefined".
      if (resp.error) { const e = new Error(resp.error.message || "Error del proveedor"); e.status = Number(resp.error.code) || 502; throw e; }
      if (!resp.choices?.length) { const e = new Error("El proveedor devolvió una respuesta vacía"); e.status = 502; throw e; }
      return { resp, ms: Date.now() - started };
    } catch (e) {
      const timedOut = e.name === "APIConnectionTimeoutError";
      const retryable = RETRYABLE.has(e.status) || timedOut || e.name === "APIConnectionError";
      if (!retryable || attempt >= MAX_ATTEMPTS || tab.closed || tab.stopped) throw e;
      const h = e.headers;
      const ra = Number(typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"]);
      const waitMs = Math.min(60_000, ra > 0 ? ra * 1000 : RETRY_WAITS_MS[attempt - 1]);
      const reason = e.status === 429 ? "límite de uso (429)" : timedOut ? `sin respuesta tras ${MODEL_TIMEOUT_MS / 1000}s` : e.status ? `error ${e.status}` : "error de conexión";
      emit("progress", { tabId: tab.id, kind: "retry", step, attempt, max: MAX_ATTEMPTS, reason, waitMs });
      await sleep(waitMs, tab.abort?.signal);
      if (tab.closed) throw e;
    }
  }
}

const clipStr = (s, n = 120) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
function summarizeArgs(name, a = {}) {
  if (name === "bash") return clipStr(a.command);
  if (name === "grep") return clipStr(`"${a.pattern}" en ${a.path}`);
  if (name === "write_file") return clipStr(`${a.path} (${(a.content ?? "").length} caracteres)`);
  return clipStr(a.path);
}

// ---------------------------------------------------------------- IPC: detener
// Corta la request al modelo (o el comando en curso). Lo ya hecho en el historial se conserva; ver finally de send-message.
ipcMain.handle("stop-tab", (event, id) => {
  const tab = tabs.get(id);
  if (!tab || !tab.busy) return false;
  tab.stopped = true;
  tab.abort?.abort();
  return true;
});

// ---------------------------------------------------------------- IPC: mensajes
ipcMain.handle("send-message", async (event, tabId, userMessage, attachments = []) => {
  const tab = tabs.get(tabId);
  if (!tab) return { ok: false };
  if (!apiKeys.length) { emit("error", { tabId, message: "No hay API Key configurada. Abrí Configuración (⚙️) y agregá una llave." }); return { ok: false }; }
  if (tab.busy) { emit("error", { tabId, message: "Esta conversación todavía está respondiendo." }); return { ok: false }; }

  tab.busy = true;
  tab.stopped = false;
  tab.abort = new AbortController();
  emit("tab-updated", tabInfo(tab));
  const checkpoint = tab.history.length; // si algo falla, volvemos acá para no dejar el historial roto
  let step = 0, completed = false;

  try {
    tab.history.push(buildUserMessage(tab, userMessage, attachments));
    if (tab.autoName) {
      const n = autoNameFrom(userMessage, attachments);
      if (n) { tab.name = n; emit("tab-updated", tabInfo(tab)); }
    }

    while (!tab.closed && !tab.stopped) {
      step++;
      emit("progress", { tabId, kind: "model-start", step, model: tab.model, ctx: tabCtx(tab).ctx });
      const { resp, ms } = await callModel(tab, step);
      if (tab.closed) break; // la cerraron mientras esperábamos: se descarta la respuesta
      const msg = resp.choices[0].message;
      tab.history.push(msg);
      if (resp.usage?.prompt_tokens) { // número real: prompt + respuesta = lo que ocupa el historial hasta acá
        tab.usage = { tokens: resp.usage.prompt_tokens + (resp.usage.completion_tokens || 0), hlen: tab.history.length };
        emit("tab-updated", tabInfo(tab));
      }

      emit("progress", { tabId, kind: "model-done", step, ms, promptTokens: resp.usage?.prompt_tokens, completionTokens: resp.usage?.completion_tokens, toolCalls: msg.tool_calls?.length || 0 });

      if (!msg.tool_calls?.length) {
        emit("assistant-message", { tabId, text: msg.content ?? "" });
        completed = true;
        break;
      }

      // Las imágenes devueltas por tools se mandan DESPUÉS de todos los mensajes "tool":
      // intercalar un mensaje "user" entre tool results rompe el protocolo con varios tool_calls.
      const pendingImages = [];
      for (const tc of msg.tool_calls) {
        // Cada tool_call necesita su mensaje "tool" o el historial queda inválido: las que no llegaron a correr se marcan canceladas.
        if (tab.stopped || tab.closed) { tab.history.push({ role: "tool", tool_call_id: tc.id, content: "Cancelado por el usuario antes de ejecutarse." }); continue; }
        let args;
        try { args = JSON.parse(tc.function.arguments || "{}"); }
        catch { tab.history.push({ role: "tool", tool_call_id: tc.id, content: "Error: argumentos JSON inválidos" }); continue; }

        emit("tool-call", { tabId, name: tc.function.name, args });
        emit("progress", { tabId, kind: "tool-start", step, name: tc.function.name, summary: summarizeArgs(tc.function.name, args) });
        const t0 = Date.now();
        const result = String(tc.function.name === "bash" ? await runBashAsync(args.command, undefined, tab.abort?.signal) : executeTool(tc.function.name, args));
        emit("progress", { tabId, kind: "tool-done", step, name: tc.function.name, ms: Date.now() - t0, ok: !result.startsWith("Error:"), chars: result.startsWith(IMG_PREFIX) ? 0 : result.length });

        if (result.startsWith(IMG_PREFIX)) {
          if (modelSupportsVision(tab.model)) {
            pendingImages.push(result.replace(IMG_PREFIX, "data:"));
            tab.history.push({ role: "tool", tool_call_id: tc.id, content: "Imagen cargada; se adjunta en el mensaje siguiente." });
          } else {
            tab.history.push({ role: "tool", tool_call_id: tc.id, content: "No se puede mostrar la imagen: el modelo activo no tiene visión." });
          }
          emit("tool-result", { tabId, name: tc.function.name, result: "[imagen cargada]" });
        } else {
          tab.history.push({ role: "tool", tool_call_id: tc.id, content: result });
          emit("tool-result", { tabId, name: tc.function.name, result });
        }
      }
      if (pendingImages.length) {
        tab.history.push({ role: "user", content: [
          { type: "text", text: "Imagen(es) solicitadas con read_file:" },
          ...pendingImages.map((url) => ({ type: "image_url", image_url: { url } })),
        ] });
      }
    }
  } catch (e) {
    if (!tab.stopped && !tab.closed) { // un corte pedido por el usuario no es un error: el historial queda como está
      tab.history.length = checkpoint;
      if (tab.usage && tab.usage.hlen > checkpoint) tab.usage = null;
      emit("error", { tabId, message: e.message });
    }
  } finally {
    if (tab.stopped && !completed && !tab.closed) {
      const note = `⏹ Detenido por el usuario${step ? ` en el paso ${step}` : ""}. Lo ya ejecutado (archivos escritos, comandos) no se deshace.`;
      tab.history.push({ role: "system", content: note });
      emit("progress", { tabId, kind: "stopped", text: note });
    }
    tab.stopped = false;
    tab.abort = null;
    tab.pendingHandoff = null;
    tab.busy = false;
    emit("tab-updated", tabInfo(tab));
    persistTab(tab);
  }
  return { ok: true };
});

// ---------------------------------------------------------------- IPC: archivos
ipcMain.handle("read-file", async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_MIME[ext]) return IMG_PREFIX + IMAGE_MIME[ext] + ";base64," + fs.readFileSync(filePath).toString("base64");
    return fs.readFileSync(filePath, "utf8");
  } catch (e) { return "Error: " + e.message; }
});
ipcMain.handle("write-file", async (event, filePath, content) => {
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, content); return "OK"; }
  catch (e) { return "Error: " + e.message; }
});
ipcMain.handle("pick-file", async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openFile", "multiSelections"] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

