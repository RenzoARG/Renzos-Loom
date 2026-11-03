import fs from "fs";
import path from "path";
import { execSync, execFileSync } from "child_process";

export const tools = [
  { type: "function", function: { name: "read_file", description: "Lee un archivo del proyecto", parameters: { type: "object", properties: { path: { type: "string", description: "Ruta del archivo" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Escribe o sobrescribe un archivo", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "bash", description: "Ejecuta un comando en la terminal", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "list_dir", description: "Lista archivos de un directorio", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "grep", description: "Busca texto en archivos", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern", "path"] } } },
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

