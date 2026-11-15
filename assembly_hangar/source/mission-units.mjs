export const DAY_S = 86400;

export function finite(value, label, min, max, optional = false) {
  if (optional && value == null) return null;
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}: allowed range ${min}–${max}`);
  return value;
}
