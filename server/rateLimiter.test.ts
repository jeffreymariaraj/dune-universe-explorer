import { describe, expect, it } from 'vitest';
import { RateLimiter, STRICT_POLICY } from './rateLimiter';

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let time = start;
  return { now: () => time, advance: (ms) => (time += ms) };
}

describe('RateLimiter', () => {
  it('allows a burst up to the per-minute limit, then refuses with a retry time', () => {
    const c = clock(1_000_000);
    const limiter = new RateLimiter(STRICT_POLICY, c.now);
    for (let i = 0; i < 4; i++) expect(limiter.take('1.2.3.4').allowed).toBe(true);
    const refused = limiter.take('1.2.3.4');
    expect(refused).toMatchObject({ allowed: false, reason: 'per-caller' });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('lets the caller back in once the burst window has passed', () => {
    const c = clock(1_000_000);
    const limiter = new RateLimiter(STRICT_POLICY, c.now);
    for (let i = 0; i < 4; i++) limiter.take('a');
    expect(limiter.take('a').allowed).toBe(false);
    c.advance(61_000);
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('caps one caller per hour even when they pace themselves', () => {
    const c = clock(1_000_000);
    const limiter = new RateLimiter(STRICT_POLICY, c.now);
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
      if (limiter.take('patient').allowed) allowed++;
      c.advance(61_000); // never trips the burst limit
    }
    expect(allowed).toBe(20);
  });

  it('does not let one caller block another', () => {
    const c = clock(1_000_000);
    const limiter = new RateLimiter(STRICT_POLICY, c.now);
    for (let i = 0; i < 4; i++) limiter.take('noisy');
    expect(limiter.take('noisy').allowed).toBe(false);
    expect(limiter.take('quiet').allowed).toBe(true);
  });

  it('enforces the global hourly cap across many callers', () => {
    const c = clock(1_000_000);
    const limiter = new RateLimiter(STRICT_POLICY, c.now);
    let allowed = 0;
    for (let i = 0; i < 200; i++) if (limiter.take(`visitor-${i}`).allowed) allowed++;
    expect(allowed).toBe(80);
    expect(limiter.take('late').reason).toBe('global');
  });

  it('forgets callers whose requests have all expired', () => {
    const c = clock(1_000_000);
    const limiter = new RateLimiter(STRICT_POLICY, c.now);
    limiter.take('x');
    c.advance(2 * 60 * 60_000);
    limiter.take('y');
    expect(limiter.size).toBe(2); // y, plus x until it is touched again
    limiter.take('x');
    expect(limiter.take('x').allowed).toBe(true);
  });
});
