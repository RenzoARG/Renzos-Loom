const { contextBridge, ipcRenderer, webUtils } = require("electron");

const on = (channel, cb) => ipcRenderer.on(channel, (_, data) => cb(data));
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("loom", {
  // estado y pestañas
  getState: call("get-state"),
  newTab: call("new-tab"),
  closeTab: call("close-tab"),
  activateTab: call("activate-tab"),
  renameTab: call("rename-tab"),
  // conversaciones guardadas (pestañas cerradas)
  listSaved: call("list-saved"),
  openSaved: call("open-saved"),
  deleteSaved: call("delete-saved"),
  shareTab: call("share-tab"),
  // modelos y mensajes (siempre por pestaña)
  getModels: call("get-models"),
  setModel: call("set-model"),
  // skills (Agent Skills estándar: src/skills/<nombre>/SKILL.md)
  listSkills: call("list-skills"),
  readSkill: call("read-skill"),
  reloadSkills: call("reload-skills"),
  getSkillsDirs: call("get-skills-dirs"),
  openSkillsFolder: call("open-skills-folder"),
  getApiKey: call("get-api-key"),
  setApiKey: call("set-api-key"),
  listApiKeys: call("list-api-keys"),
  addApiKey: call("add-api-key"),
  deleteApiKey: call("delete-api-key"),
  testApiKey: call("test-api-key"),
  stopTab: call("stop-tab"),
  sendMessage: (tabId, text, attachments = []) => ipcRenderer.invoke("send-message", tabId, text, attachments),
  // archivos
  readFile: call("read-file"),
  writeFile: call("write-file"),
  pickFile: call("pick-file"),
  pickFolder: call("pick-folder"),
  // Electron >= 32 quitó File.path: para drag & drop hay que usar webUtils
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  // eventos (todos llevan tabId)
  onTabUpdated: (cb) => on("tab-updated", cb),
  onAssistantMessage: (cb) => on("assistant-message", cb),
  onToolCall: (cb) => on("tool-call", cb),
  onToolResult: (cb) => on("tool-result", cb),
  onProgress: (cb) => on("progress", cb),
  onError: (cb) => on("error", cb),
  onShortcut: (cb) => on("shortcut", cb),
});
