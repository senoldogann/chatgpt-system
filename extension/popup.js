// Popup: durum rozeti, bağlam özeti, akış ve eşleşme ayarları. Token
// yalnızca service worker üzerinden köprüye gider; bu dosya ağa kendisi
// istek yapmaz.
'use strict';

const $ = (id) => document.getElementById(id);

const send = (message) => new Promise((resolve) => {
  chrome.runtime.sendMessage(message, (response) => {
    resolve(response && typeof response === 'object' ? response : { ok: false, error: 'YANIT_YOK' });
  });
});

const ask = (path) => send({ type: 'cs-bridge', path });

const textRow = (parent, label, value) => {
  const row = document.createElement('div');
  row.className = 'row';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = label;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = value;
  row.appendChild(name);
  row.appendChild(meta);
  parent.appendChild(row);
};

const paintDot = (stateName) => {
  $('dot').setAttribute('data-state', stateName);
};

const paintAlert = (message) => {
  const alert = $('alert');
  if (!message) {
    alert.hidden = true;
    alert.textContent = '';
    return;
  }
  alert.hidden = false;
  alert.textContent = message;
};

// Hata kodu nesne olarak da gelebilir (sürüm karışımı); içinden okunur,
// ham nesne popup'a asla basılmaz.
const errorText = (code) => {
  if (typeof code === 'string') return code;
  if (code && typeof code === 'object') {
    const inner = code.error ?? code.message ?? null;
    if (typeof inner === 'string' && inner !== '') return inner;
    try {
      const json = JSON.stringify(code);
      if (typeof json === 'string' && json !== '' && json !== '{}') return json.slice(0, 200);
    } catch { /* genel mesaja düş */ }
  }
  return '';
};

const friendlyError = (code) => {
  const text = errorText(code);
  if (/fetch|network|ECONNREFUSED|Failed to fetch/i.test(text)) {
    return 'Köprüye ulaşılamadı: sunucu kapalı olabilir.';
  }
  if (/invalid origin/i.test(text)) {
    return 'Köprü isteği reddedildi (eski sunucu): sunucuyu yeniden başlat.';
  }
  switch (text) {
    case 'TOKEN_YOK': return 'Önce Eşleşme bölümüne token gir.';
    case 'alias_required':
    case 'ALIAS_YOK': return 'Henüz kayıtlı proje yok: sohbette project_register çağır, panel otomatik bulur.';
    case 'alias_not_found': return 'Seçili proje kayıtta yok: listeden başka proje seç ya da otomatik bırak.';
    case 'unauthorized': return 'Token reddedildi: tokenı kontrol et.';
    case 'invalid_origin': return 'Köprü isteği reddedildi (eski sunucu): sunucuyu yeniden başlat.';
    case 'invalid_body': return 'Köprü isteği bozuk: uzantıyı yeniden yükle.';
    case 'not_found': return 'Köprü ucu bulunamadı: sunucu eski sürüm olabilir.';
    case 'bridge_failed': return 'Köprü sunucusunda hata: sunucu kaydına bak.';
    case 'busy': return 'Sunucu meşgul: birazdan yeniden denenecek.';
    case 'ZAMAN_ASIMI': return 'Köprü yanıt vermedi: birkaç saniye sonra yeniden dene.';
    case 'YANIT_YOK':
    case 'MESAJ_HATA':
    case 'BRIDGE_HATA': return 'Uzantı arka planı yanıt vermiyor: uzantıyı yeniden yükle.';
    default: return `Köprü hatası: ${text || 'BAĞLANTI_YOK'}`;
  }
};

// Proje listesi köprüden gelir: "Otomatik" varsayılandır ve sohbette en son
// dokunulan projeyi izler; belirli bir proje seçilirse panel ona sabitlenir.
const fillProjects = (projects, savedAlias) => {
  const select = $('alias');
  const entries = Array.isArray(projects && projects.aliases) ? projects.aliases : [];
  const known = new Set();
  select.textContent = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Otomatik (sohbeti takip et)';
  select.appendChild(auto);
  for (const entry of entries) {
    if (!entry || typeof entry.alias !== 'string' || entry.alias === '' || known.has(entry.alias)) continue;
    known.add(entry.alias);
    const option = document.createElement('option');
    option.value = entry.alias;
    option.textContent = `${entry.alias} · v${entry.recordVersion}`;
    select.appendChild(option);
  }
  // Kayıtlı alias listede yoksa (eski/silinmiş kayıt) seçim kaybolmasın.
  if (savedAlias !== '' && !known.has(savedAlias)) {
    const option = document.createElement('option');
    option.value = savedAlias;
    option.textContent = `${savedAlias} (listede yok)`;
    select.appendChild(option);
  }
  select.value = savedAlias;
  const hint = $('aliasHint');
  const active = projects && typeof projects.activeAlias === 'string' ? projects.activeAlias : '';
  hint.textContent = active === ''
    ? 'Otomatik: sohbette project_resume/checkpoint çağrılan projeyi izler.'
    : `Otomatik seçim şu an: ${active}. Sohbet başka projeye geçince kendiliğinden değişir.`;
};

async function refresh() {
  const stored = await chrome.storage.local.get(['bridgeToken', 'alias']);
  const hasToken = typeof stored.bridgeToken === 'string' && stored.bridgeToken !== '';
  const savedAlias = typeof stored.alias === 'string' ? stored.alias : '';
  if (!hasToken) {
    const probe = await send({ type: 'cs-probe' });
    if (probe && probe.found) {
      paintDot('warn');
      $('state').textContent = 'Sunucu bulundu, eşleşme eksik';
      paintAlert('');
      $('pairHint').textContent = 'Köprü ayakta. Token girip Kaydet — proje seçimi otomatiktir.';
    } else {
      paintDot('error');
      $('state').textContent = 'Sunucu bulunamadı';
      paintAlert('Önce terminalde kur: npm run setup:extension-bridge -- install --root <proje-yolun>');
      $('pairHint').textContent = '';
    }
    $('snapshot').hidden = true;
    $('flowBox').hidden = true;
    $('settingsBox').open = true;
    return false;
  }
  const status = await ask('/bridge/status');
  if (!status.ok) {
    paintDot('error');
    $('state').textContent = 'Bağlı değil';
    paintAlert(friendlyError(status.error));
    return false;
  }
  fillProjects(status.data.projects, savedAlias);
  paintDot('ok');
  $('state').textContent = `Bağlı · ${status.data.projects.count} proje`;
  paintAlert('');
  const snapshot = $('snapshot');
  snapshot.hidden = false;
  snapshot.textContent = '';
  textRow(snapshot, 'Skill', String(status.data.skills.count));
  textRow(snapshot, 'Worker', `${status.data.workers.activeWorkers} aktif · ${status.data.workers.unread} okunmamış`);
  textRow(snapshot, 'Terminal', `${status.data.terminal.running}/${status.data.terminal.sessions} çalışıyor`);
  const context = await ask('/bridge/context');
  if (context.ok) {
    textRow(snapshot, 'Proje', `${context.data.alias} · v${context.data.recordVersion}`);
    if (context.data.goal) textRow(snapshot, 'Hedef', String(context.data.goal).slice(0, 80));
    if (context.data.nextStep) textRow(snapshot, 'Sonraki', String(context.data.nextStep).slice(0, 80));
  } else {
    paintAlert(friendlyError(context.error));
  }
  const activity = await ask('/bridge/activity?limit=15');
  const flowBox = $('flowBox');
  const flow = $('flow');
  flow.textContent = '';
  if (activity.ok && activity.data.items.length > 0) {
    flowBox.hidden = false;
    for (const item of activity.data.items.slice(-15)) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `[${item.kind}] ${item.label}`;
      const pre = document.createElement('pre');
      pre.textContent = item.text;
      details.appendChild(summary);
      details.appendChild(pre);
      flow.appendChild(details);
    }
  } else {
    flowBox.hidden = true;
  }
  return true;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['bridgePort', 'bridgeToken', 'alias']);
  $('port').value = stored.bridgePort || '4312';
  $('token').value = stored.bridgeToken || '';
  $('alias').value = stored.alias || '';
}

async function saveSettings() {
  const port = Number($('port').value) || 4312;
  await chrome.storage.local.set({
    bridgePort: port,
    bridgeToken: String($('token').value).trim(),
    alias: String($('alias').value).trim(),
  });
  await refresh();
}

async function boot() {
  try {
    $('version').textContent = `Companion v${chrome.runtime.getManifest().version}`;
    await loadSettings();
    await refresh();
  } catch (error) {
    paintDot('error');
    $('state').textContent = 'Popup açılamadı';
    paintAlert(`Uzantı sayfası hata verdi: ${error instanceof Error ? error.message : String(error)} — chrome://extensions üzerinden uzantıyı yeniden yükle.`);
  }
}

// Betik body sonunda çalışır; DOMContentLoaded çoktan geçmişse
// dinleyici hiç ateşlenmezdi, o yüzden iki yolu da destekle.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void boot();
    $('saveBtn').addEventListener('click', saveSettings);
    $('testBtn').addEventListener('click', refresh);
    setInterval(refresh, 5000);
  });
} else {
  void boot();
  $('saveBtn').addEventListener('click', saveSettings);
  $('testBtn').addEventListener('click', refresh);
  setInterval(refresh, 5000);
}
