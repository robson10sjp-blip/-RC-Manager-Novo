const MINUTE_MS = 60 * 1000;
const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;

export function createMemoryStore() {
  const values = new Map();
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
  };
}

// The store only keeps counters (no Firebase writes). The check happens before
// any OpenAI call, so a blocked user costs nothing.
export function createRateLimiter({ store, perMinute = 5, perDay = 60 }) {
  return {
    async consume(uid, nowMs = Date.now()) {
      const minute = Math.floor(nowMs / MINUTE_MS);
      const day = new Date(nowMs - BRAZIL_OFFSET_MS).toISOString().slice(0, 10);
      const minuteKey = `m:${uid}:${minute}`;
      const dayKey = `d:${uid}:${day}`;
      const [minuteCount, dayCount] = await Promise.all([
        store.get(minuteKey),
        store.get(dayKey),
      ]);
      const usedMinute = Number(minuteCount || 0);
      const usedDay = Number(dayCount || 0);

      if (usedDay >= perDay) {
        const endOfDay = new Date(nowMs - BRAZIL_OFFSET_MS);
        endOfDay.setUTCHours(24, 0, 0, 0);
        return {
          allowed: false,
          reason: "daily",
          retryAfterSeconds: Math.max(
            Math.ceil((endOfDay.getTime() + BRAZIL_OFFSET_MS - nowMs) / 1000),
            1
          ),
        };
      }
      if (usedMinute >= perMinute) {
        return {
          allowed: false,
          reason: "minute",
          retryAfterSeconds: Math.max(
            Math.ceil(((minute + 1) * MINUTE_MS - nowMs) / 1000),
            1
          ),
        };
      }

      await Promise.all([
        store.set(minuteKey, usedMinute + 1),
        store.set(dayKey, usedDay + 1),
      ]);
      return { allowed: true, remainingToday: perDay - usedDay - 1 };
    },
  };
}
