export function isAppleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export async function copyText(text: string): Promise<"copied" | "fallback"> {
  if (!text) return "fallback";
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // iOS Safari and some embedded browsers reject clipboard writes.
  }
  return "fallback";
}

export async function shareOrCopy(url: string, title: string): Promise<"shared" | "copied" | "fallback"> {
  try {
    if (typeof navigator.share === "function" && isAppleTouch()) {
      await navigator.share({ title, url, text: title });
      return "shared";
    }
  } catch {
    // User cancelled or share is unavailable — fall through to copy.
  }
  const copied = await copyText(url);
  return copied === "copied" ? "copied" : "fallback";
}
