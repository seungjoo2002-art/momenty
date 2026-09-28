/**
 * 로그인 뒤 돌아갈 주소 — 이 앱 안의 경로만. "//evil.com", "/\evil.com"(브라우저가 //로 바꾼다),
 * 제어문자 · 다른 origin으로 풀리는 값은 모두 버린다 (open redirect 방지).
 */
export function safeNext(next: string | undefined | null, fallback = ""): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || Array.from(next).some((ch) => ch.charCodeAt(0) === 92 || ch.charCodeAt(0) < 32)) return fallback;
  try {
    const base = "https://momenty.invalid";
    const u = new URL(next, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}
