import fs from "fs";
import path from "path";
import { execSync, execFileSync, spawn } from "child_process";

export const tools = [
  { type: "function", function: { name: "read_file", description: "Lee un archivo del proyecto", parameters: { type: "object", properties: { path: { type: "string", description: "Ruta del archivo" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Escribe o sobrescribe un archivo", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "bash", description: "Ejecuta un comando en la terminal", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "list_dir", description: "Lista archivos de un directorio", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "grep", description: "Busca texto en archivos", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern", "path"] } } },
  { type: "function", function: { name: "browser", description: "Controla el navegador Brave/Chrome de la PC vía CDP (list, activate, snapshot, click, fill, send). Orden explícita = confirmación; modo pregunta/inferida = preguntar antes de enviar.", parameters: { type: "object", properties: { action: { type: "string", description: "list | activate | snapshot | click | fill | send" }, tabId: { type: "string", description: "id de pestaña (opcional, default primera)" }, selector: { type: "string", description: "selector CSS para click/fill/send" }, text: { type: "string", description: "texto para fill/send" }, sendSelector: { type: "string", description: "selector del botón enviar (opcional)" } }, required: ["action"] } } },
  { type: "function", function: { name: "whatsapp_web", description: "Controla WhatsApp Web (pestaña abierta en Brave vía CDP): listar y abrir chats, leer mensajes, enviar texto, transcribir notas de voz y extraer audio. Ojo: la transcripción usa SpeakApp (5/hora, notas de hasta 80 s); el audio sale de la PC.", parameters: { type: "object", properties: { action: { type: "string", description: "list | open | read | send | send-to | transcribe | extract-audio | search | scroll | status | snapshot | click | fill" }, chatName: { type: "string", description: "nombre del chat (open/search/send-to)" }, text: { type: "string", description: "texto a enviar (send/send-to) o rellenar (fill)" }, limit: { type: "number", description: "cuántos mensajes/notas (read/transcribe; default 10 y 1)" }, index: { type: "number", description: "0 = la última nota, 1 = la anterior… (transcribe/extract-audio)" }, selector: { type: "string", description: "selector CSS (click/fill)" }, dy: { type: "number", description: "píxeles de scroll (scroll; default 600)" }, tabId: { type: "string" } }, required: ["action"] } } },
];

export function executeTool(name, args) {
  try {
    switch (name) {
      case "read_file": {
        const ext = path.extname(args.path).toLowerCase();
        const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
        if (imageExts.includes(ext)) {
          const buf = fs.readFileSync(args.path);
          const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/bmp";
          return "__IMAGE_BASE64__:" + mime + ";base64," + buf.toString("base64");
        }
        return fs.readFileSync(args.path, "utf8");
      }
      case "write_file":
        fs.mkdirSync(path.dirname(args.path), { recursive: true });
        fs.writeFileSync(args.path, args.content);
        return "OK: archivo escrito";
      case "bash":
        return execSync(args.command, { encoding: "utf8", maxBuffer: 1024 * 1024 });
      case "list_dir":
        return fs.readdirSync(args.path).join("\n");
      case "grep": {
        return execFileSync("grep", ["-rn", args.pattern, args.path], { encoding: "utf8" });
      }
      default:
        return "Herramienta desconocida: " + name;
    }
  } catch (e) {
    return "Error: " + e.message;
  }
}


// bash para la app de escritorio: asíncrono (no congela el proceso principal ni las otras pestañas),
// sin stdin (un comando que pregunta algo no queda esperando) y con timeout que mata TODO el árbol de procesos.
export const BASH_TIMEOUT_MS = 120_000;
export function runBashAsync(command, timeoutMs = BASH_TIMEOUT_MS, signal) {
  return new Promise((resolve) => {
    if (typeof command !== "string" || !command.trim()) return resolve("Error: falta el comando");
    const win = process.platform === "win32";
    const child = spawn(command, { shell: true, windowsHide: true, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const MAX = 1024 * 1024;
    let out = "", err = "", done = false;
    child.stdout.on("data", (d) => { if (out.length < MAX) out += d; });
    child.stderr.on("data", (d) => { if (err.length < MAX) err += d; });
    const finish = (text) => { if (done) return; done = true; clearTimeout(timer); resolve(text); };
    const killTree = () => {
      try {
        if (win) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else process.kill(-child.pid, "SIGKILL");
      } catch { try { child.kill("SIGKILL"); } catch { /* ya terminó */ } }
    };
    const timer = setTimeout(() => {
      killTree();
      const partial = (out || err).slice(-2000);
      finish(`Error: el comando superó ${timeoutMs / 1000}s y fue cancelado. Si es un servidor o algo que no termina, no lo ejecutes en primer plano.` + (partial ? `\nÚltima salida:\n${partial}` : ""));
    }, timeoutMs);
    const onAbort = () => {
      killTree();
      const partial = (out || err).slice(-2000);
      finish("Error: comando cancelado por el usuario." + (partial ? `\nÚltima salida:\n${partial}` : ""));
    };
    if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => finish("Error: " + e.message));
    child.on("close", (code) => finish(code === 0 ? (out || err || "(sin salida)") : `Error: Command failed (código ${code}): ${command}\n${err || out}`));
  });
}
