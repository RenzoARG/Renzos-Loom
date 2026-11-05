import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// <raíz del proyecto>/src/skills  (este archivo vive en src/context)
export const SKILLS_DIR = path.resolve(__dirname, "../skills");
// Carpeta del proyecto (dev): <raíz>/skills — útil para probar skills sin rebuild.
export const PROJECT_SKILLS_DIR = path.resolve(__dirname, "../../skills");

// ---------------------------------------------------------------- utilidades
function parseFrontmatter(text) {
  // Frontmatter YAML simple: --- ... --- al inicio del archivo.
  // Solo necesitamos name y description (el resto del body va en markdown).
  // Sin dependencia externa: parser mínimo para que no falle si el formato es otro.
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { data: {}, body: text };
  const data = {};
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  if (end === -1) return { data: {}, body: text };
  return { data, body: lines.slice(end + 1).join("\n").trim() };
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------- loader
// Multi-raíz: bundled (src/skills) < proyecto (skills/) < usuario (%APPDATA%/Renzos Loom/skills).
// Si dos raíces tienen el mismo nombre, gana la última (usuario sobre proyecto sobre bundled).
// main.js pasa las raíces con loadSkills([PROJECT_SKILLS_DIR, USER_SKILLS_DIR]).
let cache = null; // [{ name, description, dir, file, body, raw, root }]

function scanRoot(root, byName) {
  if (!root || !fs.existsSync(root)) return;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { console.error(`loadSkills (${root}):`, e.message); return; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // cada skill es una carpeta
    const dir = path.join(root, entry.name);
    // Estándar: SKILL.md (mayúsculas). Aceptamos skill.md como fallback por si alguien lo crea en minúscula.
    const candidates = ["SKILL.md", "skill.md"];
    let file = null;
    for (const c of candidates) {
      const p = path.join(dir, c);
      if (fs.existsSync(p)) { file = p; break; }
    }
    if (!file) continue;

    try {
      const raw = fs.readFileSync(file, "utf8");
      const { data, body } = parseFrontmatter(raw);
      const folderName = entry.name;
      const name = (data.name || folderName).trim();
      // Spec: name === folder name y kebab-case. Si no coincide, usamos la carpeta como canónica para no romper routing.
      const canonical = folderName.toLowerCase();
      const safeName = NAME_RE.test(name) ? name : canonical;
      const description = (data.description || body.split(/\r?\n/).find((l) => l.trim()) || "").trim();
      if (!description) continue; // sin description la skill no es descubrible: se ignora
      byName.set(safeName, { name: safeName, description, dir, file, body: body || raw, raw, root });
    } catch (e) {
      console.error(`loadSkills (${entry.name}):`, e.message);
    }
  }
}

export function loadSkills(extraRoots = []) {
  const byName = new Map();
  scanRoot(SKILLS_DIR, byName);
  for (const r of extraRoots) scanRoot(r, byName);
  cache = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function listSkills() {
  if (!cache) loadSkills();
  return cache.map(({ name, description, dir, file, root }) => ({ name, description, dir, file, root }));
}

export function readSkillBody(name) {
  if (!cache) loadSkills();
  const s = cache.find((x) => x.name === name);
  return s ? s.body : null;
}

// Catálogo mínimo para el system prompt: solo name+description (barato en tokens).
// El cuerpo completo se carga bajo demanda leyendo SKILL.md (ver makeTab / historyForModel).
export function skillsCatalogForPrompt() {
  if (!cache) loadSkills();
  if (!cache.length) return "";
  const lines = cache.map((s) => `- ${s.name}: ${s.description}`);
  return [
    "",
    "## Skills disponibles (formato Agent Skills)",
    "Cada skill vive en `src/skills/<nombre>/SKILL.md` (o en la carpeta de usuario de Loom si la sobreescribe). Si una skill aplica, primero buscá su archivo y leélo con read_file para seguir sus instrucciones al pie de la letra. No inventes parámetros: si el SKILL.md define inputs, pedí los que falten.",
    ...lines,
  ].join("\n");
}

export function __resetCacheForTests() { cache = null; }
