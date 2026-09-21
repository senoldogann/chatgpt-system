// Sayfadaki panel: bağlam, daraltma brifi ve terminal akışı. Gözlem
// sohbeti değiştirmez; yazma yalnızca Daralt düğmesine basılınca composer
// alanına yapılır. Token bu dosyaya hiç girmez.
(() => {
  'use strict';

  if (globalThis.__CS_CONTENT_ACTIVE__ === true) return;
  globalThis.__CS_CONTENT_ACTIVE__ = true;

  const POLL_MS = 3000;
  const dom = () => globalThis.CS_DOM || null;

  // Panel başlığında gösterilen sürüm: popup altındaki sürümle aynı
  // olmalı. Böylece "yeni kod yüklendi mi?" sorusu tahmine kalmaz.
  const EXT_VERSION = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return '';
    }
  })();

  const state = {
    booted: false,
    busy: false,
    probe: null,
    settings: null,
    status: null,
    context: null,
    activity: null,
    page: null,
    error: '',
    notice: '',
    noticeAt: 0,
  };

  // Arka plana istek gönderir; kimlik bilgileri bu dosyaya hiç girmez.
  const send = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response && typeof response === 'object' ? response : { ok: false, error: 'YANIT_YOK' });
      });
    } catch {
      resolve({ ok: false, error: 'MESAJ_HATA' });
    }
  });

  const ask = (path, extra) => send({ type: 'cs-bridge', path, ...extra });

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // Daralt: brifi hazırlar, yazma alanına yazar, olmazsa panoya
  // kopyalar. Üç yolun üçünde de panelde tek cümlelik sonuç gösterilir;
  // sessiz tıklama olmaz. busy her durumda finally ile sıfırlanır.
  const onCompact = async () => {
    if (state.busy) return;
    const api = dom();
    if (!api) return;
    state.busy = true;
    state.notice = '';
    state.noticeAt = 0;
    try {
      paint();
      const response = await ask('/bridge/handoff/prepare');
      if (!response.ok) {
        state.error = friendlyError(response.error);
      } else {
        state.error = '';
        const bootstrap = String(response.data.bootstrap || '');
        if (bootstrap === '') {
          state.error = 'Brif üretilemedi: önce sohbet içinde project_checkpoint yazılmalı.';
        } else {
          const written = api.setComposerText(bootstrap);
          if (written) {
            state.notice = 'Hazır. Metin aşağıdaki yazma alanına yazıldı — Gönder’e basman yeterli.';
            state.noticeAt = Date.now();
          } else {
            const copied = await copyText(bootstrap);
            state.notice = copied
              ? 'Yazma alanına yazılamadı, metin panoya kopyalandı — yeni sohbette yapıştırman yeterli.'
              : 'Metin ne alana yazılabildi ne panoya kopyalanabildi — sayfayı yenileyip tekrar dene.';
            state.noticeAt = Date.now();
          }
        }
      }
    } catch {
      state.error = 'Panel güncellenemedi; bir sonraki yoklamada denenecek.';
    } finally {
      state.busy = false;
    }
    // refresh() kendi hatasını yazar; Daralt'ın taze hatası varsa onu koru.
    const keptErr = state.error;
    await refresh();
    if (keptErr !== '') state.error = keptErr;
    paint();
  };

  // Pano yedeği: yalnızca Daralt tıklaması gibi kullanıcı hareketiyle
  // çağrılır; sessizce okuma yapılmaz, yalnızca yazılır.
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text).slice(0, 12_000));
      return true;
    } catch {
      return false;
    }
  };

  // Hata kodu her zaman string gelmez (sürüm karışımında nesne
  // gelebilir); ham nesne asla panele basılmaz.
  const errorText = (code) => {
    if (typeof code === 'string') return code;
    if (code && typeof code === 'object') {
      const inner = code.error ?? code.message ?? null;
      if (typeof inner === 'string' && inner !== '') return inner;
      try {
        const json = JSON.stringify(code);
        if (typeof json === 'string' && json !== '' && json !== '{}') return json.slice(0, 200);
      } catch { /* aynen düş, genel mesaja git */ }
      return '';
    }
    return '';
  };

  const friendlyError = (code) => {
    const text = errorText(code);
    // Bağlantı koptuğunda fetch hata metni ham gelir; teknik metni gösterme.
    if (/fetch|network|ECONNREFUSED|Failed to fetch/i.test(text)) {
      return 'Köprüye ulaşılamadı: sunucu kapalı olabilir. Terminalde setup:extension-bridge status ile bak.';
    }
    if (/invalid origin/i.test(text)) {
      return 'Köprü isteği reddedildi (eski sunucu): sunucuyu yeniden başlat.';
    }
    switch (text) {
      case 'TOKEN_YOK': return 'Eşleşme eksik: popup üzerinden token gir.';
      case 'alias_required':
      case 'ALIAS_YOK': return 'Kayıtlı proje yok: sohbette project_register çağır; panel aktif projeyi otomatik bulur.';
      case 'alias_not_found': return 'Seçili alias kayıtta yok: popup üzerinden farklı proje seç ya da otomatik bırak.';
      case 'unauthorized': return 'Token reddedildi: popup üzerindeki tokenı kontrol et.';
      case 'handoff_unavailable': return 'Brif üretilemedi: önce project_checkpoint ile brif yaz.';
      case 'invalid_origin': return 'Köprü isteği reddedildi (eski sunucu): sunucuyu yeniden başlat.';
      case 'invalid_body': return 'Köprü isteği bozuk: uzantıyı yeniden yükle.';
      case 'not_found': return 'Köprü ucu bulunamadı: sunucu eski sürüm olabilir, yeniden kur.';
      case 'bridge_failed': return 'Köprü sunucusunda hata: sunucu kaydına bak.';
      case 'busy': return 'Sunucu meşgul: birkaç saniye sonra yeniden denenecek.';
      case 'ZAMAN_ASIMI': return 'Köprü yanıt vermedi (zaman aşımı): birkaç saniye sonra yeniden dene.';
      case 'YANIT_YOK':
      case 'MESAJ_HATA':
      case 'BRIDGE_HATA': return 'Uzantı arka planı yanıt vermiyor: chrome://extensions üzerinden uzantıyı yeniden yükle.';
      default:
        try { console.warn('[chatgpt-system] bilinmeyen köprü hatası:', code); } catch { /* günlük yazılamazsa akış durmaz */ }
        return `Köprü hatası: ${text || 'BAĞLANTI_YOK'}`;
    }
  };

  // Panel iskeleti bir kez kurulur; sonrası yalnızca içerik boyanır.
  const ensurePanel = () => {
    const api = dom();
    if (!api) return null;
    const stage = api.ensureStage();
    if (!stage) return null;
    if (!stage.firstChild) {
      const head = el('div', 'cs-head');
      const dot = el('span', 'cs-dot');
      dot.setAttribute('data-cs-dot', '');
      const title = el('span', 'cs-title', 'chatgpt-system');
      const meta = el('span', 'cs-meta', '');
      const action = el('button', 'cs-action', '◐ Daralt');
      action.type = 'button';
      action.setAttribute('data-cs-action', '');
      action.addEventListener('click', onCompact);
      const toggle = el('button', 'cs-toggle', 'gizle');
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        stage.classList.toggle('cs-collapsed');
        toggle.textContent = stage.classList.contains('cs-collapsed') ? 'göster' : 'gizle';
      });
      head.appendChild(dot);
      head.appendChild(title);
      head.appendChild(meta);
      head.appendChild(action);
      head.appendChild(toggle);
      stage.appendChild(head);
      stage.appendChild(el('div', 'cs-body'));
    }
    return stage;
  };

  const dotState = () => {
    if (state.error !== '' || (state.status === null && state.booted)) return 'error';
    if (state.context) return 'ok';
    if (state.settings && !state.settings.hasToken) return 'warn';
    return 'idle';
  };

  const headerMeta = () => {
    const suffix = EXT_VERSION === '' ? '' : ` · uzantı v${EXT_VERSION}`;
    if (state.context) {
      // Popup'ta alias seçilmediyse proje sunucudan otomatik gelir; bunu
      // başlıkta belli et ki kullanıcı "hangi proje?" diye sormasın.
      const auto = state.settings && !state.settings.hasAlias ? ' (otomatik)' : '';
      return `${state.context.alias}${auto} · v${state.context.recordVersion} · ${state.context.status}${suffix}`;
    }
    if (state.probe && state.probe.found) {
      // Token yolunda probe portsuz kurulur; portu ayarlardan al.
      const port = state.settings?.port ?? state.probe.port;
      return `köprü ${port} portunda bulundu${suffix}`;
    }
    return `bağlantı bekleniyor${suffix}`;
  };

  const paint = () => {
    const stage = ensurePanel();
    if (!stage) return;
    const dot = stage.querySelector('[data-cs-dot]');
    if (dot) dot.setAttribute('data-state', dotState());
    const meta = stage.querySelector('.cs-meta');
    if (meta) meta.textContent = headerMeta();
    const action = stage.querySelector('[data-cs-action]');
    if (action) {
      action.disabled = state.busy;
      action.textContent = state.busy ? '… Hazırlanıyor' : '◐ Daralt';
    }
    const glyph = document.querySelector('[data-cs-compact]');
    if (glyph) glyph.remove();
    const body = stage.querySelector('.cs-body');
    if (!body) return;
    body.textContent = '';
    // Bildirim 2 dakika sonra eskir; panelde sonsuza dek durmaz.
    if (state.notice !== '' && Date.now() - state.noticeAt > 120_000) {
      state.notice = '';
      state.noticeAt = 0;
    }
    // Bildirim her durumda en üstte: Daralt sonucu tek cümleyle burada.
    if (state.notice !== '') body.appendChild(el('div', 'cs-notice', state.notice));
    if (!state.settings || !state.settings.hasToken) {
      paintOnboarding(body);
      if (state.error !== '') paintError(body, state.error);
    } else if (state.error !== '' && !state.context) {
      paintError(body, state.error);
    } else {
      if (state.error !== '') paintError(body, state.error);
      if (state.context) {
        paintBox(body, 'Bağlam', paintContext);
        paintBox(body, 'Daraltma', paintHandoff);
      }
      if (state.page && state.page.chat) paintBox(body, 'Bu sohbet', paintPage);
      if (state.activity) paintBox(body, 'Akış', paintFlow);
    }
    stage.hidden = false;
  };

  const paintBox = (body, label, builder) => {
    const box = el('section', 'cs-card');
    box.appendChild(el('h3', 'cs-card-title', label));
    const inner = el('div', 'cs-card-body');
    builder(inner);
    box.appendChild(inner);
    body.appendChild(box);
  };

  // Eşleşme yokken kurulum adımları; probe sonucu hangi adımda olunduğunu söyler.
  const paintOnboarding = (body) => {
    const card = el('div', 'cs-onboard');
    card.appendChild(el('div', 'cs-onboard-title', 'Kurulum gerekli'));
    const found = state.probe && state.probe.found;
    const steps = found
      ? [
        'Köprü sunucusu bulundu. Sıradaki adım eşleşme.',
        'Uzantı simgesine tıkla, Eşleşme bölümüne token gir.',
        'Proje seçimi otomatiktir: sohbette project_resume/checkpoint çağrılınca panel o projeyi izler.',
      ]
      : [
        'Önce köprü sunucusunu başlat. Terminalde proje dizininde çalıştır:',
        'npm run setup:extension-bridge -- install --root <proje-yolun>',
        'Ardından uzantı simgesine tıkla, yazdırılan tokenı Eşleşme bölümüne gir.',
      ];
    const list = el('ol', 'cs-steps');
    for (const step of steps) list.appendChild(el('li', 'cs-step-line', step));
    card.appendChild(list);
    const retry = el('button', 'cs-retry', 'Tekrar dene');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      state.booted = false;
      void refresh();
    });
    card.appendChild(retry);
    body.appendChild(card);
  };

  const paintError = (body, message) => {
    body.appendChild(el('div', 'cs-error-card', message));
  };

  const line = (parent, label, value) => {
    const row = el('div', 'cs-row');
    row.appendChild(el('span', 'cs-k', `${label}`));
    row.appendChild(el('span', 'cs-v', value));
    parent.appendChild(row);
  };

  const paintContext = (body) => {
    const context = state.context;
    if (!context || typeof context !== 'object') return;
    line(body, 'Proje', `${context.alias} · v${context.recordVersion} · ${context.status}`);
    if (context.goal) line(body, 'Hedef', context.goal);
    if (context.nextStep) line(body, 'Sonraki', context.nextStep);
    const tree = context.worktree;
    line(body, 'Ağaç', tree ? tree.canonicalPath : '—');
    line(body, 'Dal', tree
      ? `${tree.branch || '—'} · ${String(tree.headSha).slice(0, 8)} · +${tree.staged} ~${tree.unstaged} ?${tree.untracked}`
      : '—');
  };

  const paintHandoff = (body) => {
    const context = state.context;
    if (!context || typeof context !== 'object') return;
    body.appendChild(el('div', 'cs-brief', context.brief || 'Kayıtlı brif yok — Daralt düğmesi mevcut malzemeden taslak üretir.'));
    const steps = Array.isArray(context.planSteps) ? context.planSteps.slice(0, 20) : [];
    if (steps.length > 0) {
      const list = el('ul', 'cs-plan');
      for (const step of steps) list.appendChild(el('li', 'cs-plan-step', `[${step.status}] ${step.step}`));
      body.appendChild(list);
    }
  };

  // Sayfa sayacı yerelde hesaplanır; sohbet metni hiçbir yere
  // gönderilmez, yalnızca sayı ve tahmin panelde gösterilir.
  const readPage = (api) => {
    try {
      if (!api || typeof api.readPageStats !== 'function') return null;
      return api.readPageStats();
    } catch {
      return null;
    }
  };

  const paintPage = (body) => {
    const page = state.page;
    if (!page || !page.chat) {
      body.appendChild(el('div', 'cs-empty', 'Bu sayfada sohbet yok.'));
      return;
    }
    if (page.user === 0 && page.assistant === 0) {
      body.appendChild(el('div', 'cs-empty', 'Henüz mesaj yok — yazıştıkça sayaç burada belirir.'));
      return;
    }
    line(body, 'Mesaj', `${page.user} sen · ${page.assistant} asistan`);
    line(body, 'Büyüklük', `~${Number(page.estTokens).toLocaleString('tr-TR')} token (tahmin)`);
  };

  const paintFlow = (body) => {
    const items = state.activity.items || [];
    if (items.length === 0) {
      body.appendChild(el('div', 'cs-empty', 'Akış boş.'));
      return;
    }
    for (const item of items.slice(-30)) {
      const details = el('details', 'cs-flow');
      details.appendChild(el('summary', 'cs-flow-label', `[${item.kind}] ${item.label}`));
      details.appendChild(el('pre', 'cs-flow-text', item.text));
      body.appendChild(details);
    }
  };

  const refresh = async () => {
    try {
      const api = dom();
      state.page = readPage(api);
      const settings = await send({ type: 'cs-settings' });
      state.settings = {
        port: Number(settings.port) || 4312,
        hasToken: settings.hasToken === true,
        hasAlias: settings.hasAlias === true,
      };
      if (!state.settings.hasToken) {
        const probe = await send({ type: 'cs-probe' });
        state.probe = probe && typeof probe.found === 'boolean' ? probe : { found: false };
        state.error = '';
        paint();
        return;
      }
      const statusResponse = await ask('/bridge/status');
      if (!statusResponse.ok) {
        if (statusResponse.error === 'busy') {
          paint();
          return;
        }
        state.error = friendlyError(statusResponse.error);
        paint();
        return;
      }
      state.status = statusResponse.data;
      state.probe = { found: true };
      state.error = '';
      const contextResponse = await ask('/bridge/context');
      if (contextResponse.ok) {
        state.context = contextResponse.data;
      } else if (contextResponse.error === 'busy') {
        // Bir sonraki yoklamada yeniden denenecek.
      } else {
        state.context = null;
        state.error = friendlyError(contextResponse.error);
      }
      const activityResponse = await ask('/bridge/activity?limit=30');
      if (activityResponse.ok) state.activity = activityResponse.data;
      state.booted = true;
    } catch {
      state.error = 'Panel güncellenemedi; bir sonraki yoklamada denenecek.';
    }
    paint();
  };

  // ChatGPT tek sayfa uygulaması: sohbet değişince içerik betiği
  // yeniden yüklenmez. Sekme görünürken her yoklamada tazele ki panel
  // yeni sohbette de belirsin; gizli sekmede işlem yapma.
  const tick = async () => {
    try {
      if (document.hidden) return;
      await refresh();
    } catch {
      // Gözlem döngüsü sayfayı asla bozmaz.
    }
  };

  setInterval(tick, POLL_MS);
  setTimeout(tick, 500);
})();
