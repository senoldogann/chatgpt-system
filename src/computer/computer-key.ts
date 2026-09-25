export const COMPUTER_CANONICAL_KEYS = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "return", "tab", "space", "delete", "forward_delete", "escape",
  "left", "right", "up", "down", "home", "end", "page_up", "page_down",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
] as const;

export type ComputerKeyName = typeof COMPUTER_CANONICAL_KEYS[number];

export const COMPUTER_KEY_ALIASES = {
  enter: "return",
  esc: "escape",
  backspace: "delete",
  forwarddelete: "forward_delete",
  pageup: "page_up",
  pagedown: "page_down",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
} as const satisfies Record<string, ComputerKeyName>;

const canonicalSet = new Set<string>(COMPUTER_CANONICAL_KEYS);

export function normalizeComputerKey(value: string): ComputerKeyName | null {
  const normalized = value.toLowerCase();
  if (canonicalSet.has(normalized)) return normalized as ComputerKeyName;
  return COMPUTER_KEY_ALIASES[normalized as keyof typeof COMPUTER_KEY_ALIASES] ?? null;
}

const titleCaseAliases = [
  "Enter", "Esc", "Backspace", "ForwardDelete", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
] as const;
const uppercaseLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const uppercaseFunctionKeys = Array.from({ length: 12 }, (_, index) => `F${index + 1}`);

export const COMPUTER_KEY_INPUT_VALUES = Array.from(new Set<string>([
  ...COMPUTER_CANONICAL_KEYS,
  ...Object.keys(COMPUTER_KEY_ALIASES),
  ...titleCaseAliases,
  ...uppercaseLetters,
  ...uppercaseFunctionKeys,
])) as [string, ...string[]];
