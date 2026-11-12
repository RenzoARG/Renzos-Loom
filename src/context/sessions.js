import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// <raíz del proyecto>/sessions  (este archivo vive en src/context)
export const SESSIONS_DIR = path.resolve(__dirname, "../../sessions");
const WORKSPACE_FILE = path.join(SESSIONS_DIR, "_workspace.json");

const REF = "session-asset:";
const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp" };
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const safe = (id) => String(id).replace(/[\\/:*?"<>|\0]/g, "_").replace(/^\.+/, "_");
const fileOf = (id) => path.join(SESSIONS_DIR, safe(id) + ".json");
const assetsDir = (id) => path.join(SESSIONS_DIR, safe(id) + ".assets");
const ensureDir = () => fs.mkdirSync(SESSIONS_DIR, { recursive: true });

export const newId = () => crypto.randomBytes(4).toString("hex");
export const getAssetsDir = assetsDir;
export const getSessionFile = fileOf;

// ---------------------------------------------------------------- imágenes fuera del JSON
function externalizeImages(history, id) {
  return history.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((p) => {
        const url = p.type === "image_url" ? p.image_url?.url : null;
        const match = typeof url === "string" && url.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
        if (!match) return p;
        const buf = Buffer.from(match[2], "base64");
        const file = crypto.createHash("sha1").update(buf).digest("hex") + "." + (EXT_BY_MIME[match[1]] || "png");
        fs.mkdirSync(assetsDir(id), { recursive: true });
        const full = path.join(assetsDir(id), file);
        if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
        return { ...p, image_url: { url: REF + file } };
      }),
    };
  });
}

function internalizeImages(history, id) {
  return history.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((p) => {
        const url = p.type === "image_url" ? p.image_url?.url : null;
        if (typeof url !== "string" || !url.startsWith(REF)) return p;
        const file = url.slice(REF.length);
        const full = path.join(assetsDir(id), file);
        if (!fs.existsSync(full)) return { type: "text", text: "[imagen no disponible]" };
        const mime = MIME_BY_EXT[path.extname(file).slice(1)] || "image/png";
        return { ...p, image_url: { url: `data:${mime};base64,${fs.readFileSync(full).toString("base64")}` } };
      }),
    };
  });
}

function writeJsonAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- conversaciones
// Formato: { version, id, name, model, modelKeyId, autoName, createdAt, updatedAt, history }
// También se leen las sesiones viejas (un array de mensajes): el nombre del archivo pasa a ser el título.
export function saveConversation(conv) {
  ensureDir();
  writeJsonAtomic(fileOf(conv.id), {
    version: 2,
    id: conv.id,
    name: conv.name,
    model: conv.model,
    modelKeyId: conv.modelKeyId || null,
    autoName: !!conv.autoName,
    createdAt: conv.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    history: externalizeImages(conv.history, conv.id),
  });
}

export function loadConversation(id) {
  const file = fileOf(id);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(raw)) {
    const st = fs.statSync(file);
    return { id, name: id, model: null, autoName: false, createdAt: st.birthtimeMs, updatedAt: st.mtimeMs, history: internalizeImages(raw, id) };
  }
  return { ...raw, id, history: internalizeImages(raw.history || [], id) };
}

// Solo metadatos, para el listado de conversaciones guardadas.
export function listConversations() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const id = f.slice(0, -5);
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8"));
      const st = fs.statSync(path.join(SESSIONS_DIR, f));
      const history = Array.isArray(raw) ? raw : raw.history || [];
      out.push({
        id,
        name: Array.isArray(raw) ? id : raw.name || id,
        model: Array.isArray(raw) ? null : raw.model,
        updatedAt: Array.isArray(raw) ? st.mtimeMs : raw.updatedAt || st.mtimeMs,
        messages: history.filter((m) => m.role === "user").length,
      });
    } catch { /* archivo ilegible: se ignora */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteConversation(id) {
  fs.rmSync(fileOf(id), { force: true });
  fs.rmSync(assetsDir(id), { recursive: true, force: true });
}

// ---------------------------------------------------------------- espacio de trabajo (pestañas abiertas)
export function saveWorkspace(ws) {
  ensureDir();
  writeJsonAtomic(WORKSPACE_FILE, ws);
}

export function loadWorkspace() {
  try { return JSON.parse(fs.readFileSync(WORKSPACE_FILE, "utf8")); }
  catch { return { open: [], active: null }; }
}

// ---------------------------------------------------------------- API vieja (la usa src/index.js, la versión de consola)
export const saveSession = (history, name) => saveConversation({ id: name, name, model: null, history });
export const loadSession = (name) => loadConversation(name)?.history ?? null;
export const listSessions = () => listConversations().map((c) => c.id);
