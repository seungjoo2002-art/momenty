/**
 * 브라우저에서 고른 사진 · 영상을 업로드 전에 다루는 도구.
 * (미리보기는 object URL, 업로드는 Blob — data URL로 메모리에 들고 다니지 않는다)
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("이미지를 읽을 수 없어요"));
    el.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 만들 수 없어요"))), type, quality),
  );
}

/**
 * 사진을 긴 변 maxSide 이하의 JPEG로 줄인다.
 * EXIF(위치 정보 포함)는 canvas를 거치며 사라진다 — 원본을 그대로 올리지 않는 이유.
 */
export async function resizeImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 처리할 수 없어요");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, "image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(src);
  }
}

/**
 * 영상의 길이와 포스터(첫 장면) 이미지를 만든다.
 * 모바일 브라우저가 프레임 추출을 막으면 poster는 null — 영상 업로드는 그대로 진행한다.
 */
export async function inspectVideo(file: Blob): Promise<{ durationSec: number; poster: Blob | null }> {
  const src = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("영상을 읽을 수 없어요"));
    });
    const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;

    let poster: Blob | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 4000);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      });
      const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await canvasToBlob(canvas, "image/jpeg", 0.8);
    } catch {
      poster = null;
    }
    return { durationSec, poster };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(src);
  }
}

/** 음성 파일의 길이(초). MediaRecorder로 만든 webm은 길이를 알 수 없는 경우가 있어 0을 돌려준다. */
export async function audioDuration(file: Blob): Promise<number> {
  const src = URL.createObjectURL(file);
  try {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = src;
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("음성 파일을 읽을 수 없어요"));
    });
    return Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0;
  } finally {
    URL.revokeObjectURL(src);
  }
}
