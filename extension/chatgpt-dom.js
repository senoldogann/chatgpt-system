// Sayfa şeklini bilen tek dosya: ChatGPT değişirse yalnızca burası değişir.
// Her işlev güvenli boş değer döner; sayfayı asla bozmaz, istisna fırlatmaz.
(() => {
  'use strict';

  const COMPOSER = [
    '#prompt-textarea',
    '[data-testid="composer-text-input"]',
    'form[data-chatgpt-composer] [contenteditable="true"]',
    'form div.ProseMirror',
    'form textarea',
    'form [contenteditable="true"]',
  ].join(', ');
  const USER_MSG = '[data-message-author-role="user"]';
  const ASSISTANT_MSG = '[data-message-author-role="assistant"]';

  const safe = (fn, fallback) => {
    try {
      const value = fn();
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  };

  // Yazma alanını bulur; yoksa null döner.
  const findComposer = () => safe(() => document.querySelector(COMPOSER), null);

  // Yazma alanının o anki metni; doğrulama için okunur.
  const readComposerText = () => safe(() => {
    const composer = findComposer();
    if (!composer) return '';
    if ('value' in composer) return String(composer.value ?? '');
    return String(composer.textContent ?? '');
  }, '');

  // Composer alanına metin yazar ve React girişi için gerekli olayları üretir.
  // Geri okuma yazılanı içermiyorsa false döner; sessiz başarı yoktur.
  const setComposerText = (text) => safe(() => {
    const composer = findComposer();
    if (!composer) return false;
    const capped = String(text).slice(0, 12_000);
    if (capped === '') return false;
    composer.focus();
    let inserted = false;
    try {
      if ('value' in composer) composer.select?.();
      else {
        try { document.execCommand('selectAll', false, null); } catch { /* seçim yoksa ekleme denenecek */ }
      }
      inserted = document.execCommand('insertText', false, capped);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      if ('value' in composer) composer.value = capped;
      else composer.textContent = capped;
      try {
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: capped }));
      } catch {
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const probe = capped.slice(0, Math.min(64, capped.length));
    return readComposerText().includes(probe);
  }, false);

  // Sayfa sohbetinin boyutu: yalnızca sayı ve toplam karakter sayılır,
  // metin toplanmaz ve dışarı gönderilmez. ~4 karakter = 1 token sayılır.
  // chat: yazma alanı varsa bu sayfa sohbet sayfasıdır.
  const readPageStats = () => safe(() => {
    const chat = findComposer() !== null;
    const users = document.querySelectorAll(USER_MSG);
    const assistants = document.querySelectorAll(ASSISTANT_MSG);
    const BUDGET = 500_000;
    let chars = 0;
    const add = (node) => {
      if (chars >= BUDGET) return;
      chars += Math.min((node.textContent || '').length, BUDGET - chars);
    };
    users.forEach(add);
    assistants.forEach(add);
    return {
      chat,
      user: users.length,
      assistant: assistants.length,
      chars,
      estTokens: Math.round(chars / 4),
    };
  }, { chat: false, user: 0, assistant: 0, chars: 0, estTokens: 0 });

  // Composer üstü panel kökü: varsa aynısını, yoksa oluşturup döner.
  const ensureStage = () => safe(() => {
    const existing = document.querySelector('[data-cs-stage]');
    if (existing && existing.isConnected) return existing;
    const composer = findComposer();
    if (!composer) return null;
    const form = composer.closest('form') || composer.parentElement;
    if (!form || !form.parentElement) return null;
    const stage = document.createElement('section');
    stage.setAttribute('data-cs-stage', '');
    stage.className = 'cs-stage';
    stage.hidden = true;
    form.parentElement.insertBefore(stage, form);
    return stage;
  }, null);

  globalThis.CS_DOM = { findComposer, readPageStats, setComposerText, ensureStage };
})();
