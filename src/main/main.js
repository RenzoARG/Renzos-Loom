import "dotenv/config";
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import OpenAI from "openai";
import { tools, executeTool } from "../tools/index.js";
import {
  saveConversation, loadConversation, listConversations, deleteConversation,
  saveWorkspace, loadWorkspace, newId,
} from "../context/sessions.js";

const APP_NAME = "Renzo's Loom";
app.setName(APP_NAME);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// El cliente OpenAI se crea SIN apiKey inicial. Se configura cuando el usuario guarda la key.
let apiKey = null;
let client = null;

function initOpenAIClient(key) {
  apiKey = key;
  client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: key || undefined,
  });
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
// Devuelve TODOS los modelos con tool calling, con flags de capacidades.
// El filtrado (visión / gratis) lo hace la UI.
async function getAvailableModels(force = false) {
  if (!apiKey) return []; // No hay API Key configurada
  if (!force && modelsCache.length && Date.now() - modelsFetchedAt < 10 * 60_000) return modelsCache;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const { data } = await res.json();
    modelsCache = (data || [])
      .filter((m) => m.context_length > 0 && m.supported_parameters?.includes("tools"))
      .map((m) => {
        // input_modalities es el campo confiable; "modality" ("text+image->text") es fallback
        const inputs = m.architecture?.input_modalities
          ?? m.architecture?.modality?.split("->")[0].split("+")
          ?? ["text"];
        const free = Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
        const info = {
          id: m.id,
          name: m.name,
          context: m.context_length,
          vision: inputs.includes("image"),
          files: inputs.includes("file"),
          audio: inputs.includes("audio"),
          reasoning: !!m.supported_parameters?.includes("reasoning"),
          free,
        };
        info.caps = ["🔧", info.vision && "👁️", info.audio && "🎤", info.reasoning && "🧠", free && "💰"].filter(Boolean).join(" ");
        return info;
      })
      .sort((a, b) => b.context - a.context);
    modelsFetchedAt = Date.now();
  } catch (e) {
    console.error("getAvailableModels:", e.message);
  }
  return modelsCache;
}

// Si no conocemos el modelo (ej: MODEL del .env que no esta en la lista) dejamos que decida la API.
const modelSupportsVision = (id) => {
  const info = modelsCache.find((m) => m.id === id);
  return info ? info.vision : true;
};

function pickDefaultModel(models) {
  if (process.env.MODEL && models.some((m) => m.id === process.env.MODEL)) return process.env.MODEL;
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
    busy: false, closed: false, pendingHandoff: null,
  };
  tabs.set(id, tab);
  return tab;
}

const tabInfo = (t) => ({ id: t.id, name: t.name, model: t.model, busy: t.busy });
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
  return { model: tab.model, handoffNote };
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

// ---------------------------------------------------------------- IPC: API Key
ipcMain.handle("get-api-key", () => apiKey);
ipcMain.handle("set-api-key", (event, key) => {
  initOpenAIClient(key);
  return { ok: true, key: !!key };
});

// ---------------------------------------------------------------- IPC: mensajes
ipcMain.handle("send-message", async (event, tabId, userMessage, attachments = []) => {
  const tab = tabs.get(tabId);
  if (!tab) return { ok: false };
  if (!apiKey) { emit("error", { tabId, message: "No hay API Key configurada. Abrí Configuración (⚙️) y pegá tu clave de OpenRouter." }); return { ok: false }; }
  if (tab.busy) { emit("error", { tabId, message: "Esta conversación todavía está respondiendo." }); return { ok: false }; }

  tab.busy = true;
  emit("tab-updated", tabInfo(tab));
  const checkpoint = tab.history.length; // si algo falla, volvemos acá para no dejar el historial roto

  try {
    tab.history.push(buildUserMessage(tab, userMessage, attachments));
    if (tab.autoName) {
      const n = autoNameFrom(userMessage, attachments);
      if (n) { tab.name = n; emit("tab-updated", tabInfo(tab)); }
    }

    while (!tab.closed) {
      const resp = await client.chat.completions.create({ model: tab.model, messages: historyForModel(tab), tools });
      if (tab.closed) break; // la cerraron mientras esperábamos: se descarta la respuesta
      const msg = resp.choices[0].message;
      tab.history.push(msg);

      if (!msg.tool_calls?.length) {
        emit("assistant-message", { tabId, text: msg.content ?? "" });
        break;
      }

      // Las imágenes devueltas por tools se mandan DESPUÉS de todos los mensajes "tool":
      // intercalar un mensaje "user" entre tool results rompe el protocolo con varios tool_calls.
      const pendingImages = [];
      for (const tc of msg.tool_calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments || "{}"); }
        catch { tab.history.push({ role: "tool", tool_call_id: tc.id, content: "Error: argumentos JSON inválidos" }); continue; }

        emit("tool-call", { tabId, name: tc.function.name, args });
        const result = String(executeTool(tc.function.name, args));

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
    tab.history.length = checkpoint;
    emit("error", { tabId, message: e.message });
  } finally {
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

