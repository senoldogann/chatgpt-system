// Service worker: uygulamayla konuşan tek parça. Eşleşme tokenı yalnızca
// burada ve chrome.storage.local içindedir; content-script tokenı hiç
// görmez, yalnızca bu worker üzerinden veri ister. Gözlem günlüğü tarayıcı
// kapanınca silinen session depoda durur; hassas çıktı yazılmaz, yalnızca
// sayaç ve hata kodu tutulur.
'use strict';

const DEFAULT_PORT = 4312;
const REQUEST_TIMEOUT_MS = 15_000;
const POLL_ALARM = 'cs-bridge-poll';
const MAX_JOURNAL = 100;

const baseUrl = (port) => `http://127.0.0.1:${port}`;

// Köprüden nesne hata gelse bile panele her zaman string gider;
// "[object Object]" panele asla düşmez.
function errorText(value, fallback) {
  if (typeof value === 'string' && value !== '') return value;
  if (value && typeof value === 'object') {
    if (typeof value.error === 'string' && value.error !== '') return value.error;
    if (typeof value.message === 'string' && value.message !== '') return value.message;
  }
  return fallback;
}

async function settings() {
  const stored = await chrome.storage.local.get(['bridgePort', 'bridgeToken', 'alias']);
  return {
    port: Number(stored.bridgePort) || DEFAULT_PORT,
    token: typeof stored.bridgeToken === 'string' ? stored.bridgeToken : '',
    alias: typeof stored.alias === 'string' ? stored.alias : '',
  };
}

async function fetchBridge(path, { method = 'GET', body = null, auth = true } = {}) {
  const { port, token } = await settings();
  if (auth && !token) throw new Error('TOKEN_YOK');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl(port)}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== null ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    });
    // Gövde önce metin olarak okunur: eski sunucu ya da bir ara katman
    // JSON olmayan hata dönerse mesaj kaybolmaz; panele "HTTP_403"
    // yerine gerçek hata metni ulaşır.
    const raw = await response.text().catch(() => '');
    let data = {};
    if (raw !== '') {
      try {
        data = JSON.parse(raw);
      } catch {
        data = response.ok ? {} : { error: raw.slice(0, 200) };
      }
    }
    return { status: response.status, data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('ZAMAN_ASIMI');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Günlüğe yalnızca sayaç ve sonuç kodu yazılır; brif ve çıktı yazılmaz.
async function journal(entry) {
  try {
    const stored = await chrome.storage.session.get(['journal']);
    const journal = Array.isArray(stored.journal) ? stored.journal : [];
    journal.push({ at: Date.now(), ...entry });
    await chrome.storage.session.set({ journal: journal.slice(-MAX_JOURNAL) });
  } catch {
    // Günlük yazılamazsa akış durmaz.
  }
}

// Kimliksiz yoklama: sunucu ayakta mı, hangi sürüm? Eşleşme yoksa bile
// "uygulama bulundu / bulunamadı" ayrımı için kullanılır.
async function probeHello() {
  const { port } = await settings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl(port)}/bridge/hello`, { signal: controller.signal });
    if (!response.ok) return { found: false, port };
    const data = await response.json().catch(() => null);
    if (!data || data.app !== 'chatgpt-system') return { found: false, port };
    return { found: true, port, version: typeof data.version === 'string' ? data.version : null };
  } catch {
    return { found: false, port };
  } finally {
    clearTimeout(timer);
  }
}

async function handleBridgeMessage(message) {
  const { port, alias } = await settings();
  const withAlias = (path) => {
    if (!alias) return path;
    if (
      path.startsWith('/bridge/status')
      || path.startsWith('/bridge/context')
      || path.startsWith('/bridge/activity')
    ) {
      const separator = path.includes('?') ? '&' : '?';
      return `${path}${separator}alias=${encodeURIComponent(alias)}`;
    }
    return path;
  };
  if (message.path === '/bridge/handoff/prepare') {
    // Alias seçilmediyse sunucu aktif projeyi kendisi çözer; burada
    // engellemek yerine isteği olduğu gibi geçir.
    const result = await fetchBridge(message.path, {
      method: 'POST',
      body: {
        ...(alias ? { alias } : {}),
        ...(message.sessionId ? { sessionId: message.sessionId } : {}),
      },
    });
    await journal({ route: 'handoff/prepare', status: result.status });
    if (result.status !== 200) return { ok: false, error: errorText(result.data?.error, `HTTP_${result.status}`) };
    return { ok: true, data: result.data, port };
  }
  const result = await fetchBridge(withAlias(message.path), { method: message.method || 'GET' });
  await journal({ route: message.path, status: result.status });
  if (result.status !== 200) return { ok: false, error: errorText(result.data?.error, `HTTP_${result.status}`) };
  return { ok: true, data: result.data, port };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'cs-probe') {
    probeHello().then(respond).catch(() => respond({ found: false }));
    return true;
  }
  if (message.type === 'cs-settings') {
    settings().then((current) => respond({
      port: current.port,
      hasToken: current.token !== '',
      hasAlias: current.alias !== '',
    })).catch(() => respond({ port: DEFAULT_PORT, hasToken: false, hasAlias: false }));
    return true;
  }
  if (message.type !== 'cs-bridge') return false;
  handleBridgeMessage(message).then(respond).catch((error) => {
    respond({ ok: false, error: error instanceof Error ? error.message : 'BRIDGE_HATA' });
  });
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  try {
    const { alias } = await settings();
    const path = alias ? `/bridge/status?alias=${encodeURIComponent(alias)}` : '/bridge/status';
    const result = await fetchBridge(path);
    await journal({ route: 'poll/status', status: result.status });
  } catch (error) {
    await journal({ route: 'poll/status', status: 0, error: error instanceof Error ? error.message : 'HATA' });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['bridgePort']);
  if (!stored.bridgePort) await chrome.storage.local.set({ bridgePort: DEFAULT_PORT });
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
});
