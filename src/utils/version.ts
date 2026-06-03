/**
 * Shared semver-ish comparison used by BOTH the extension self-update and the
 * per-asset update detection. Tolerant: a leading `v` is stripped, missing or
 * non-numeric segments count as 0 (so "1.2" === "1.2.0", "v1.0.0" === "1.0.0").
 */
function parse(v: string): [number, number, number] {
  const parts = String(v ?? '').replace(/^v/i, '').split('.');
  const n = (i: number): number => parseInt(parts[i], 10) || 0;
  return [n(0), n(1), n(2)];
}

/** -1 if a<b, 0 if equal, 1 if a>b (major → minor → patch). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
