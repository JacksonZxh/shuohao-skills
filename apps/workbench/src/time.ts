export function nowEpochMs(): number {
  return Date.now();
}

export function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
