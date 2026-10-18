// Rate limiter em memória (token bucket) — suficiente pra uma instância única
const buckets = new Map<string, { tokens: number; last: number }>();

export function rateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: maxPerMinute, last: now };
    buckets.set(key, b);
  }
  const refill = ((now - b.last) / 60_000) * maxPerMinute;
  b.tokens = Math.min(maxPerMinute, b.tokens + refill);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// Limpa entradas ocasionais pra não vazar memória
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.last > 10 * 60_000) buckets.delete(key);
  }
}, 5 * 60_000).unref();
