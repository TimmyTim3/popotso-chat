/** Tiny haptic helper. Works on Android browsers; iPhone Safari ignores it silently. */
const PATTERNS = {
  light: 8,
  medium: 16,
  success: [10, 40, 14],
  warning: [24, 60, 24],
} as const;

export function haptic(kind: keyof typeof PATTERNS = "light") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[kind] as number | number[]);
  } catch {
    /* unsupported */
  }
}
