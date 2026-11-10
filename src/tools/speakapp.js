// Transcripción de notas de voz vía SpeakApp (https://speakapp.com).
// Cómo funciona: abrimos su página en una pestaña de fondo, y desde esa página evaluamos
// un script que decodifica el audio (decodeAudioData), lo resamplea a WAV mono 16 kHz /
// 16-bit PCM y hace POST al endpoint /t/api/transcribe-demo. El window.fetch de esa página
// está parcheado por su propio JS para agregar los headers del challenge anti-bot, así que
// el POST sólo pasa si sale desde adentro de la página. La pestaña se abre en background y
// se cierra al terminar.
//
// Límites del endpoint tools-default (el que usa la página):
//   - 80 segundos de audio por nota (más largo → error duration_exceeded).
//   - 5 solicitudes/hora (headers x-ratelimit-*). Al pasarse devuelve 429.
//   - El audio sale de la PC hacia speakapp.com.

import { cdpEval, cdpList, cdpCallRaw, CDP_HOST, CDP_PORT } from "./browser.js";

const SPEAKAPP_URL = "https://speakapp.com/t/tools/es/transcripcion-mensaje-voz-whatsapp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildScript(base64, mime) {
  return `(async () => {
    try {
      const b64 = ${JSON.stringify(base64)};
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: ${JSON.stringify(mime || "audio/ogg")} });
      const ab = await blob.arrayBuffer();
      const ctx = new AudioContext();
      let buf;
      try { buf = await ctx.decodeAudioData(ab); } catch (e) { await ctx.close(); return { error: "decode: " + e.message }; }
      const targetSR = 16000;
      const len = Math.max(1, Math.ceil(buf.duration * targetSR));
      const off = new OfflineAudioContext(1, len, targetSR);
      const s = off.createBufferSource();
      s.buffer = buf;
      s.connect(off.destination);
      s.start();
      const rendered = await off.startRendering();
      const ch = rendered.getChannelData(0);
      const pcm = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const x = Math.max(-1, Math.min(1, ch[i]));
        pcm[i] = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      }
      const dataBytes = pcm.buffer.byteLength;
      const out = new ArrayBuffer(44 + dataBytes);
      const v = new DataView(out);
      const wstr = (o, str) => { for (let j = 0; j < str.length; j++) v.setUint8(o + j, str.charCodeAt(j)); };
      wstr(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); wstr(8, "WAVE"); wstr(12, "fmt ");
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      wstr(36, "data"); v.setUint32(40, dataBytes, true);
      new Uint8Array(out, 44).set(new Uint8Array(pcm.buffer));
      const wav = new Blob([out], { type: "audio/wav" });
      const res = await fetch("/t/api/transcribe-demo?pageId=tools-default", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      });
      const body = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      const text = parsed && typeof parsed.text === "string" ? parsed.text : "";
      const language = parsed && typeof parsed.language === "string" ? parsed.language : "";
      await ctx.close();
      return { status: res.status, text, language, rawBody: body.slice(0, 2000) };
    } catch (e) { return { error: String(e) }; }
  })()`;
}

async function browserWebSocketUrl() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(5_000) });
  const v = await res.json();
  return v.webSocketDebuggerUrl;
}

async function createBackgroundTab() {
  const wsUrl = await browserWebSocketUrl();
  if (!wsUrl) throw new Error("SpeakApp: sin webSocketDebuggerUrl del navegador (¿Brave abrió con --remote-debugging-port?).");
  const created = await cdpCallRaw({ webSocketDebuggerUrl: wsUrl }, "Target.createTarget", { url: SPEAKAPP_URL, background: true });
  const id = created?.targetId;
  if (!id) throw new Error("SpeakApp: no se pudo crear la pestaña en background.");
  // Esperar a que aparezca en /json/list
  for (let i = 0; i < 40; i++) {
    const targets = await cdpList();
    const t = targets.find((x) => x.id === id || (x.webSocketDebuggerUrl || "").includes(id));
    if (t?.webSocketDebuggerUrl) return { id, target: t };
    await sleep(250);
  }
  try { await closeTab(id); } catch {}
  throw new Error("SpeakApp: la pestaña no cargó en /json/list.");
}

async function closeTab(id) {
  try {
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${id}`, { method: "PUT", signal: AbortSignal.timeout(5_000) });
    return true;
  } catch { return false; }
}

// Recibe { base64, mime } — devuelve { text, language }.
export async function speakappTranscribe({ base64, mime } = {}) {
  if (!base64) throw new Error("SpeakApp: sin audio.");
  const { id, target } = await createBackgroundTab();
  try {
    // Esperar readyState complete y un settle de 1s (la página aún puede terminar navegación interna)
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      const r = await cdpEval(target, "document.readyState", 5_000);
      if (r?.result?.value === "complete") ready = true; else await sleep(300);
    }
    if (!ready) throw new Error("SpeakApp: la página no terminó de cargar en 20s.");
    await sleep(1000);
    let r = await cdpEval(target, buildScript(base64, mime), 90_000);
    // Retry único: la navegación puede haber destruido el contexto entre la espera y la evaluación
    if (r?.error?.message?.includes("Execution context was destroyed")) {
      await sleep(1500);
      r = await cdpEval(target, buildScript(base64, mime), 90_000);
    }
    const out = r?.result?.value;
    if (!out) throw new Error("SpeakApp: respuesta vacía (¿CDP roto?).");
    if (out.error) throw new Error("SpeakApp: " + out.error);
    if (out.status === 429) throw new Error("SpeakApp: límite de 5 solicitudes/hora alcanzado. Reintentá en un rato.");
    if (out.status !== 200) throw new Error(`SpeakApp: HTTP ${out.status} — ${out.rawBody || ""}`);
    return { text: out.text || "", language: out.language || "" };
  } finally {
    await closeTab(id);
  }
}
