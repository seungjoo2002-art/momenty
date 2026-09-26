const TZ = "Asia/Seoul";

/** KST 기준 YYYY-MM-DD */
export function kstDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Moment가 속한 하루 (KST YYYY-MM-DD).
 * createdAt(UTC ISO)을 slice하면 00~09시 KST가 전날로 묶이므로 반드시 이 함수를 쓴다.
 */
export function dateKeyOf(iso: string): string {
  return kstDate(new Date(iso));
}

export function isTodayKst(iso: string): boolean {
  return dateKeyOf(iso) === kstDate();
}

/** KST 하루의 [시작, 다음날 시작) — DB에서 created_at 범위로 Today를 조회할 때 */
export function kstDayRange(date: string): { from: string; to: string } {
  const from = new Date(`${date}T00:00:00+09:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

/** KST 날짜 + 그날 0시부터의 분 → ISO (Mock 데이터용) */
export function kstIso(date: string, minuteOfDay: number): string {
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00+09:00`).toISOString();
}

/** Mock 데이터용: 지금으로부터 n분 전의 ISO 문자열 */
export function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

/** "방금" / "32분 전" / "3시간 전" — 하루가 넘으면 시각 */
export function formatRelative(iso: string, nowMs: number): string {
  const diffMin = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  return formatTime(iso);
}

export function daysAgoDate(daysAgo: number): string {
  return kstDate(new Date(Date.now() - daysAgo * 86_400_000));
}

function toDate(dateOrIso: string): Date {
  return dateOrIso.length === 10 ? new Date(`${dateOrIso}T12:00:00+09:00`) : new Date(dateOrIso);
}

/** "오후 2:20" */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "14:20" */
export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "9월 25일 목요일" — YYYY-MM-DD 또는 ISO 모두 허용 */
export function formatDate(dateOrIso: string, withWeekday = true): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    ...(withWeekday ? { weekday: "long" } : {}),
  }).format(toDate(dateOrIso));
}

/** "9. 25." */
export function formatShortDate(dateOrIso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, month: "numeric", day: "numeric" }).format(toDate(dateOrIso));
}

/** 12400 → "1.2만" */
export function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}천`;
  return n.toLocaleString("ko-KR");
}

export function formatPrice(won: number): string {
  return `₩${won.toLocaleString("ko-KR")}`;
}

/** 받침 유무에 따라 조사 선택: josa("하린", "과", "와") → "하린과" */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return word + (hasFinal ? withFinal : withoutFinal);
}

export function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
