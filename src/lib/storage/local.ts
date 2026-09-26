/**
 * 브라우저 localStorage를 임시 DB처럼 쓰기 위한 최소 어댑터.
 * services/* 만 이 파일을 사용한다 — UI 컴포넌트는 localStorage를 직접 읽지 않는다.
 * Supabase 연결 시 이 파일과 함께 서비스 내부 구현만 교체하면 된다.
 */

export const isBrowser = typeof window !== "undefined";

export class StorageFullError extends Error {
  constructor() {
    super("기기의 저장 공간이 부족해요. 사진 크기를 줄이거나 지난 기록을 정리해 주세요.");
    this.name = "StorageFullError";
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22)) throw new StorageFullError();
    throw e;
  }
}

export function removeKey(key: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 비공개 모드 등 */
  }
}

/**
 * 같은 탭(emit) + 다른 탭(storage 이벤트)의 변경을 구독.
 * onExternal: 다른 탭에서 바뀌었을 때 리스너보다 먼저 실행 (메모리 캐시 무효화 등)
 */
export function createChannel(keys: string[], onExternal?: () => void) {
  const listeners = new Set<() => void>();
  let bound = false;

  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && !keys.includes(e.key)) return;
    onExternal?.();
    listeners.forEach((l) => l());
  };

  return {
    emit() {
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (isBrowser && !bound) {
        window.addEventListener("storage", onStorage);
        bound = true;
      }
      return () => {
        listeners.delete(listener);
        if (isBrowser && bound && listeners.size === 0) {
          window.removeEventListener("storage", onStorage);
          bound = false;
        }
      };
    },
  };
}
