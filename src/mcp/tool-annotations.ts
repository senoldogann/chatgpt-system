// MCP araç annotation ön ayarları. ChatGPT onay ve güvenlik kararlarını bu
// ipuçlarına göre verir; her araç buradaki adlandırılmış bir ön ayarı kullanır.
// readOnly: yalnızca okur. destructive: mevcut veriyi değiştirir/siler.
// idempotent: aynı girdiyle tekrar çağrı ek etki yaratmaz.
// openWorld: yerel çalışma alanı dışına (ağ, masaüstü, tarayıcı) etki eder.

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

function preset(readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean): ToolAnnotations {
  return Object.freeze({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
}

export const READ_ONLY = preset(true, false, true, false);
export const READ_ONLY_OPEN_WORLD = preset(true, false, true, true);
export const WRITE = preset(false, false, false, false);
export const WRITE_IDEMPOTENT = preset(false, false, true, false);
export const WRITE_OPEN_WORLD = preset(false, false, false, true);
export const WRITE_IDEMPOTENT_OPEN_WORLD = preset(false, false, true, true);
export const DESTRUCTIVE = preset(false, true, false, false);
export const DESTRUCTIVE_IDEMPOTENT = preset(false, true, true, false);
export const DESTRUCTIVE_OPEN_WORLD = preset(false, true, false, true);
export const DESTRUCTIVE_IDEMPOTENT_OPEN_WORLD = preset(false, true, true, true);
