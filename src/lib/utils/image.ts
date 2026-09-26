/**
 * 기기에서 고른 사진을 FileReader로 읽어, localStorage에 들어갈 크기의 JPEG data URL로 줄인다.
 * (localStorage는 보통 5MB 한도 — 원본을 그대로 넣으면 몇 장 만에 가득 찬다)
 * Supabase 연결 시: 원본 File을 Storage에 업로드하고 이 함수는 미리보기 용도로만 쓴다.
 */
export async function readPhotoAsDataUrl(file: File, maxSide = 1080, quality = 0.8): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("이미지를 읽을 수 없어요"));
    el.src = original;
  });

  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}
