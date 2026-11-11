// Tool única de WhatsApp Web: concentra todas las interacciones con la página
// (chats, mensajes, notas de voz, multimedia y acciones genéricas).
// Delega en browser.js, que es quien conoce el DOM y el protocolo CDP.

import { browserTool } from "./browser.js";

// Acción del modelo -> acción interna de browser.js
const ACTIONS = {
  list: "whatsapp-list",
  open: "whatsapp-chat",
  read: "whatsapp-read",
  message: "whatsapp-read-last",
  "read-last": "whatsapp-read-last",
  send: "whatsapp-send",
  "send-to": "whatsapp-send-to",
  transcribe: "whatsapp-transcribe",
  "extract-audio": "whatsapp-extract-audio",
  search: "whatsapp-search",
  scroll: "whatsapp-scroll",
  status: "whatsapp-status",
  // Genéricas (por si el modelo necesita algo puntual de la página)
  snapshot: "snapshot",
  click: "click",
  fill: "fill",
  navigate: "navigate",
  reload: "reload",
};

export async function whatsappWebTool(args, signal) {
  const action = ACTIONS[args.action];
  if (!action) return `Error: acción desconocida "${args.action}". Usá: ${Object.keys(ACTIONS).join(", ")}.`;
  const { action: _omit, ...rest } = args;
  return browserTool({ ...rest, action }, signal);
}
