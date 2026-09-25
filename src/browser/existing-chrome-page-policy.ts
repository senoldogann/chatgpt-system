export function isExistingChromePageEligible(url: string): boolean {
  if (url === "about:blank") return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
