/**
 * 이미지 추상화 레이어.
 *
 * 모든 이미지 URL은 여기서만 만든다. 크리에이터마다 "한 사람의 사진"처럼 보이도록
 * 프로필 · 커버 · Moment · 지난 하루 이미지를 크리에이터 단위로 묶어 두었다.
 *
 * 실제 서비스에서는 이 파일을 Supabase Storage 경로로 바꾸면 된다.
 *   예) avatar → storage/creators/{id}/avatar.jpg
 *       moment → storage/moments/{momentId}/media.jpg
 */

const picsum = (id: number, w: number, h: number) => `https://picsum.photos/id/${id}/${w}/${h}`;

export const avatar = (n: number) => `https://i.pravatar.cc/300?img=${n}`;

interface CreatorImageSet {
  avatar: number;
  cover: number;
  /** momentId → 사진 */
  moments: Record<string, number>;
  /** 지난 하루 커버 (최근 → 과거) */
  dailies: number[];
}

/** 크리에이터별 사진 세트 — 직업/분위기에 맞게 고른 사진 */
const CREATOR_IMAGES: Record<string, CreatorImageSet> = {
  // 한하린 · 필름 사진작가 — 바다, 빛
  c1: { avatar: 45, cover: 16, moments: { m101: 13, m103: 57, m105: 77, m106: 213 }, dailies: [171, 147, 131, 12, 26, 42] },
  // 이도윤 · 싱어송라이터 — 악기, 레코드
  c2: { avatar: 12, cover: 158, moments: { m203: 145, m204: 39 }, dailies: [24, 195, 17, 60, 208] },
  // 윤서아 · 발레 — 무대 조명, 슈즈
  c3: { avatar: 26, cover: 152, moments: { m301: 153, m303: 137, m304: 21 }, dailies: [140, 25, 159, 195, 134, 36] },
  // 박지호 · 셰프 — 시장, 과일, 테이블
  c4: { avatar: 53, cover: 42, moments: { m401: 163, m403: 75, m404: 42, m406: 192 }, dailies: [19, 164, 63, 30] },
  // 정유나 · 일러스트레이터 — 고양이, 작업 책상
  c5: { avatar: 20, cover: 180, moments: { m501: 40, m502: 20 }, dailies: [134, 143, 36, 60, 17] },
  // 강민재 · 트레일 러너 — 산
  c6: { avatar: 60, cover: 29, moments: { m601: 11 }, dailies: [191, 18, 177, 197] },
  // 오소희 · 책방 — 책, 창가
  c7: { avatar: 44, cover: 192, moments: { m701: 24 }, dailies: [195, 36, 171, 0] },
  // 서태오 · 바리스타 — 커피
  c8: { avatar: 59, cover: 30, moments: {}, dailies: [225, 10, 63] },
};

export const creatorAvatar = (creatorId: string) => avatar(CREATOR_IMAGES[creatorId].avatar);

export const creatorCover = (creatorId: string) => picsum(CREATOR_IMAGES[creatorId].cover, 1200, 900);

export const momentMedia = (creatorId: string, momentId: string) => {
  const set = CREATOR_IMAGES[creatorId];
  return picsum(set.moments[momentId] ?? set.cover, 900, 1125);
};

export const dailyCover = (creatorId: string, index: number) => {
  const list = CREATOR_IMAGES[creatorId].dailies;
  return picsum(list[index % list.length], 600, 750);
};

/** seed 전용: 채워 넣는 지난 하루의 사진 */
export const seedPhoto = (creatorId: string, n: number) => {
  const set = CREATOR_IMAGES[creatorId];
  const pool = [...Object.values(set.moments), ...set.dailies];
  return picsum(pool[n % pool.length], 900, 1125);
};
