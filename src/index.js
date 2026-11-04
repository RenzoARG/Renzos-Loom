import "dotenv/config";
import OpenAI from "openai";
import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import { tools, executeTool } from "./tools/index.js";
import { saveSession, loadSession, listSessions } from "./context/sessions.js";

// La versión de consola (src/index.js) lee la key desde el entorno, como las herramientas CLI.
// La app de escritorio NO usa esto: sus llaves viven en Configuración ⚙️ (sessions/_api_keys.json).
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const FALLBACK_MODEL = "openai/gpt-4o-mini";

const SYSTEM_PROMPT = "Sos Renzo's Loom, un asistente de coding. Tenes herramientas para leer/escribir archivos, ejecutar comandos, listar directorios y buscar texto. Usalas para ayudar al usuario. Se conciso.";

async function getAvailableModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
    });
    const data = await res.json();
    return (data.data || [])
      .filter((m) => m.context_length && m.context_length > 0 && m.supported_parameters && m.supported_parameters.includes("tools"))
      .sort((a, b) => b.context_length - a.context_length)
      .map((m) => ({ id: m.id, name: m.name, context: m.context_length }));
  } catch (e) {
    return [];
  }
}

function print(msg, color = "white") { console.log(chalk[color](msg)); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  print("Renzo's Loom v0.2.0", "magenta");
  print("Consultando modelos disponibles...", "gray");
  const models = await getAvailableModels();
  if (models.length > 0) {
    console.log(chalk.yellow("\nModelos disponibles (ordenados por contexto):"));
    models.slice(0, 15).forEach((m, i) => {
      console.log(chalk.gray(`  ${i + 1}. ${m.id} (${Math.round(m.context / 1000)}k tokens)`));
    });
  }
  const selectedModel = await new Promise((resolve) => {
    rl.question(chalk.cyan("Elegi modelo (numero o Enter para default): "), (ans) => {
      const n = parseInt(ans.trim());
      if (n >= 1 && n <= models.length) resolve(models[n - 1].id);
      else resolve(FALLBACK_MODEL);
    });
  });
  const activeModel = selectedModel || FALLBACK_MODEL;
  print("Modelo activo: " + activeModel, "green");
  print("Comandos: /session <nombre>, /sessions, /load <nombre>, /models, exit", "gray");

  let history = [{ role: "system", content: SYSTEM_PROMPT }];
  let sessionName = null;

  function ask() {
    rl.question(chalk.cyan("> "), async (input) => {
      const trimmed = input.trim();
      if (trimmed === "exit" || trimmed === "quit") {
        if (sessionName) saveSession(history, sessionName);
        print("Sesion guardada. Chau!", "green");
        rl.close();
        return;
      }
      if (trimmed === "/models") {
        const ms = await getAvailableModels();
        ms.slice(0, 20).forEach((m, i) => print(`  ${i + 1}. ${m.id} (${Math.round(m.context / 1000)}k)`, "gray"));
        ask();
        return;
      }
      if (trimmed.startsWith("/session ")) {
        sessionName = trimmed.slice(9).trim();
        print("Sesion: " + sessionName, "yellow");
        ask();
        return;
      }
      if (trimmed === "/sessions") {
        const sessions = listSessions();
        print(sessions.length ? sessions.join(", ") : "No hay sesiones guardadas", "yellow");
        ask();
        return;
      }
      if (trimmed.startsWith("/load ")) {
        const name = trimmed.slice(6).trim();
        const loaded = loadSession(name);
        if (loaded) { history = loaded; sessionName = name; print("Sesion cargada: " + name, "green"); }
        else print("No se encontro la sesion: " + name, "red");
        ask();
        return;
      }

      history.push({ role: "user", content: trimmed });

      try {
        while (true) {
          const resp = await client.chat.completions.create({ model: activeModel, messages: history, tools });
          const msg = resp.choices[0].message;
          history.push(msg);
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              const args = JSON.parse(tc.function.arguments);
              print(`[tool] ${tc.function.name} ${JSON.stringify(args)}`, "gray");
              const result = executeTool(tc.function.name, args);
              history.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
            }
          } else {
            print(msg.content, "white");
            if (sessionName) saveSession(history, sessionName);
            break;
          }
        }
      } catch (e) {
        if (e.message.includes("No endpoints found that support tool use")) {
          print("El modelo no soporta tools. Volviendo a elegir...", "red");
          const newModel = await pickModel();
          if (newModel && newModel !== activeModel) {
            activeModel = newModel;
            print("Modelo cambiado a: " + activeModel, "green");
            history.pop();
            ask();
            return;
          }
        }
        print("Error: " + e.message, "red");
      }
      ask();
    });
  }

  ask();
}

main();
