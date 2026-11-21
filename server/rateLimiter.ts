// Strict rate limiting for the Mentat proxy (Vercel deploy).
//
// Sliding-window logs, in memory: for each key we keep the timestamps of
// recent requests and refuse a new one if a window already holds its limit.
// Several windows are checked together (a short burst window and an hourly
// one), plus a GLOBAL hourly cap across every caller, so one person cannot
// use up the LLM quota and a burst of visitors cannot either.
//
// Caveat (README): on serverless hosting each running instance keeps its own
// memory, so these limits are per instance, not global across the platform.
// With the expected handful of users an hour, Vercel usually runs one warm
// instance; a shared store (KV/Redis) would make them exact.
//
// Pure apart from the clock, which is injectable for tests.

export interface Window {
  /** Requests allowed per window. */
  limit: number;
  /** Window length, milliseconds. */
  ms: number;
}

export interface RateLimitPolicy {
  /** Limits per caller (IP address). All must pass. */
  perKey: Window[];
  /** Limits on everyone together. All must pass. */
  global: Window[];
}

export interface RateDecision {
  allowed: boolean;
  /** When refused: seconds until a slot frees up. */
  retryAfterSeconds: number;
  /** When refused: which limit was hit. */
  reason: 'per-caller' | 'global' | null;
}

/** Defaults sized for "a few people an hour" (Jeff, Day 10 follow-up). */
export const STRICT_POLICY: RateLimitPolicy = {
  perKey: [
    { limit: 4, ms: 60_000 }, // burst: 4 questions a minute
    { limit: 20, ms: 60 * 60_000 }, // 20 questions an hour per visitor
  ],
  global: [{ limit: 80, ms: 60 * 60_000 }], // 80 questions an hour in total
};

/** Most distinct callers remembered; the oldest are forgotten past this. */
const MAX_KEYS = 2000;

export class RateLimiter {
  private readonly byKey = new Map<string, number[]>();
  private readonly everyone: number[] = [];
  private readonly longest: number;

  constructor(
    private readonly policy: RateLimitPolicy = STRICT_POLICY,
    private readonly now: () => number = Date.now,
  ) {
    this.longest = Math.max(...policy.perKey.map((w) => w.ms), ...policy.global.map((w) => w.ms), 1);
  }

  /** Check and, if allowed, record one request for `key`. */
  take(key: string): RateDecision {
    const time = this.now();
    const mine = this.prune(this.byKey.get(key) ?? [], time);
    this.prune(this.everyone, time);

    const perKey = this.check(mine, this.policy.perKey, time);
    if (perKey > 0) {
      this.store(key, mine);
      return { allowed: false, retryAfterSeconds: perKey, reason: 'per-caller' };
    }
    const global = this.check(this.everyone, this.policy.global, time);
    if (global > 0) {
      this.store(key, mine);
      return { allowed: false, retryAfterSeconds: global, reason: 'global' };
    }

    mine.push(time);
    this.everyone.push(time);
    this.store(key, mine);
    return { allowed: true, retryAfterSeconds: 0, reason: null };
  }

  /** Callers currently remembered (tests, debugging). */
  get size(): number {
    return this.byKey.size;
  }

  /** 0 if every window has room, else seconds until the tightest one frees a slot. */
  private check(log: number[], windows: Window[], time: number): number {
    let wait = 0;
    for (const window of windows) {
      if (window.limit <= 0) {
        wait = Math.max(wait, Math.ceil(window.ms / 1000)); // a closed window
        continue;
      }
      const inWindow = log.filter((t) => t > time - window.ms);
      if (inWindow.length >= window.limit) {
        // The oldest request in the window leaves it first.
        const oldest = inWindow[inWindow.length - window.limit]!;
        wait = Math.max(wait, Math.ceil((oldest + window.ms - time) / 1000));
      }
    }
    return wait;
  }

  /** Drop timestamps older than the longest window (in place). */
  private prune(log: number[], time: number): number[] {
    const cutoff = time - this.longest;
    let drop = 0;
    while (drop < log.length && log[drop]! <= cutoff) drop++;
    if (drop > 0) log.splice(0, drop);
    return log;
  }

  private store(key: string, log: number[]): void {
    this.byKey.delete(key); // re-insert so Map order = least recently seen first
    if (log.length > 0) this.byKey.set(key, log);
    while (this.byKey.size > MAX_KEYS) {
      const oldest = this.byKey.keys().next().value;
      if (oldest === undefined) break;
      this.byKey.delete(oldest);
    }
  }
}
