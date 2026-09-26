import type { Moment, MomentType, Reactions, Visibility } from "@/lib/types";
import { daysAgoDate, kstIso } from "@/lib/utils/format";
import { dailyCover, draftPhoto, momentMedia } from "./images";

const r = (love: number, cheer = 0, touched = 0, smile = 0): Reactions => ({ love, cheer, touched, smile });

type Extra = Partial<Omit<Moment, "id" | "creatorId" | "type" | "createdAt" | "content">>;

function m(
  id: string,
  creatorId: string,
  type: MomentType,
  /** 기록한 시각 HHMM (예: 920 = 09:20) */
  at: number,
  content: string,
  visibility: Visibility,
  reactions: Reactions,
  extra: Extra = {},
): Moment & { minute: number } {
  return {
    id,
    creatorId,
    type,
    content,
    createdAt: "",
    minute: Math.floor(at / 100) * 60 + (at % 100),
    visibility,
    reactions,
    aiContextEnabled: true,
    ...(type === "photo" || type === "video" ? { mediaUrl: momentMedia(creatorId, id) } : {}),
    ...extra,
  };
}

/**
 * Mock 크리에이터들이 하루 동안 남기는 Moment.
 * 정해진 시간 슬롯이 없다. 크리에이터가 실제로 남긴 순간만 존재하므로
 * 크리에이터마다 개수도(0~7개), 간격도 제각각이다.
 *
 * date(KST) 하루에 놓고, 지금 시각이 지난 것만 돌려준다 — 미래의 Moment는 생기지 않고,
 * 데모를 켜둔 채 시간이 지나면 크리에이터들의 하루가 차례로 쌓인다.
 * idSuffix: 첫날 이후의 하루는 id가 겹치지 않도록 붙인다.
 */
export function buildMockDay(date: string, idSuffix = "", now = Date.now()): Moment[] {
  return MOCK_DAY.map(({ minute, ...rest }) => ({
    ...rest,
    id: rest.id + idSuffix,
    createdAt: kstIso(date, minute),
  })).filter((m) => new Date(m.createdAt).getTime() <= now);
}

const MOCK_DAY = [
  // 한하린 — 7 Moments
  m("m101", "c1", "photo", 920, "한강에서 오늘 첫 컷. 물빛이 유난히 파랬어요.", "public", r(2140, 310, 420, 88), {
    location: "서울 · 한강",
    safeShare: ["location_delayed"],
  }),
  m("m102", "c1", "text", 1050, "커피를 내리다가 문득, 좋아하는 걸 오래 좋아하는 것도 재능이라는 생각.", "public", r(1830, 120, 960, 40)),
  m("m103", "c1", "photo", 1130, "현상소 가는 길. 필름 네 롤 맡기고 왔어요. 결과는 목요일에!", "subscribers", r(1210, 402, 88, 230)),
  m("m104", "c1", "voice", 1240, "점심 먹으면서 짧게 — 요즘 찍고 있는 시리즈 이야기", "subscribers", r(980, 150, 310, 60), {
    durationSec: 94,
  }),
  m("m105", "c1", "video", 1610, "바람이 너무 좋아서 20초만 같이 봐요.", "public", r(3020, 520, 780, 140), {
    durationSec: 21,
    location: "강릉 · 안목해변",
    safeShare: ["location_delayed", "faces_blurred"],
  }),
  m("m106", "c1", "photo", 1840, "오늘의 골든아워. 이 빛 때문에 사진을 계속 찍는 것 같아요.", "premium", r(1560, 210, 640, 30), {
    safeShare: ["location_removed"],
  }),
  m("m107", "c1", "text", 2128, "숙소 도착. 오늘 찍은 것 중에 하나만 고르라면 아마 아침 한강. 다들 오늘 하루 어땠어요?", "public", r(890, 90, 210, 120)),

  // 이도윤 — 4 Moments
  m("m201", "c2", "text", 820, "밤새 쓴 가사는 아침에 보면 대부분 버리게 되는데, 이건 살아남았으면.", "public", r(1420, 330, 510, 60)),
  m("m202", "c2", "voice", 1400, "브릿지 멜로디 데모 (아직 가사 없음)", "subscribers", r(1980, 610, 420, 40), { durationSec: 48 }),
  m("m203", "c2", "photo", 1700, "합주실. 드럼 형이 오늘 컨디션 최고.", "public", r(860, 240, 30, 110), { location: "합정 · 합주실" }),
  m("m204", "c2", "video", 1930, "방금 완성한 후렴 한 소절", "premium", r(2210, 890, 700, 20), { durationSec: 32 }),

  // 윤서아 — 5 Moments
  m("m301", "c3", "photo", 1020, "클래스 전 스트레칭. 오늘도 몸이 먼저 깨어나요.", "public", r(4210, 640, 330, 90)),
  m("m302", "c3", "text", 1240, "이번 시즌 첫 리허설 날. 긴장보다 설렘이 조금 더 커요.", "public", r(3890, 1120, 540, 30)),
  m("m303", "c3", "video", 1500, "리허설 쉬는 시간, 무대 뒤 풍경", "subscribers", r(5120, 890, 1020, 210), {
    durationSec: 26,
    safeShare: ["faces_blurred"],
  }),
  m("m304", "c3", "photo", 1810, "토슈즈 세 켤레째. 이번 공연 끝나면 몇 켤레가 될까요.", "public", r(2980, 220, 670, 180)),
  m("m305", "c3", "voice", 2152, "리허설 끝나고 짧은 인사", "premium", r(410, 30, 210, 10), { durationSec: 67 }),

  // 박지호 — 6 Moments
  m("m401", "c4", "photo", 800, "시장 다녀왔어요. 오늘은 전어가 좋아요.", "public", r(720, 180, 40, 90), { location: "가락시장" }),
  m("m402", "c4", "text", 1120, "오늘의 메뉴: 전어구이, 가을 버섯 리조또, 무화과 타르트.", "public", r(1030, 140, 20, 220)),
  m("m403", "c4", "video", 1250, "무화과 손질하는 중. 오늘 타르트에 들어가요.", "subscribers", r(1540, 210, 180, 330), { durationSec: 38 }),
  m("m404", "c4", "photo", 1430, "런치 마감. 스태프 밥은 제가 해요.", "public", r(890, 120, 260, 310)),
  m("m405", "c4", "voice", 1600, "무화과 타르트 레시피 포인트 세 가지", "premium", r(1320, 460, 70, 90), { durationSec: 112 }),
  m("m406", "c4", "photo", 1720, "디너 전 마지막 점검. 오늘도 잘 부탁해요.", "subscribers", r(640, 90, 30, 40)),

  // 정유나 — 3 Moments
  m("m501", "c5", "photo", 1320, "작업실 창가에 앉은 모찌. 오늘의 모델입니다.", "public", r(5230, 210, 890, 1220)),
  m("m502", "c5", "video", 1650, "러프 스케치 타임랩스", "subscribers", r(2140, 520, 110, 60), { durationSec: 45 }),
  m("m503", "c5", "text", 2025, "마감 두 개 끝! 오늘은 떡볶이 먹고 일찍 잘래요.", "public", r(1780, 640, 60, 380)),

  // 강민재 — 1 Moment
  m("m601", "c6", "photo", 1150, "북한산 러닝 18km. 안개가 산을 덮었어요.", "public", r(980, 520, 70, 30), {
    location: "북한산",
    safeShare: ["location_delayed"],
  }),

  // 오소희 — 3 Moments
  m("m701", "c7", "photo", 1450, "오늘 입고된 책들. 가을이라 시집이 많아요.", "public", r(870, 60, 190, 40)),
  m("m702", "c7", "text", 1740, "오늘의 문장 — “우리는 서로의 하루를 조금씩 나눠 가진다.”", "subscribers", r(1240, 40, 780, 20)),
  m("m703", "c7", "voice", 2105, "마감 후 낭독 한 편", "premium", r(960, 30, 610, 10), { durationSec: 150 }),

  // 서태오 — 오늘은 아직 조용한 하루 (Moment 없음)
];

/** 크리에이터별 지난 하루 제목/하이라이트 (최근 → 과거 순) */
const PAST: Record<string, [title: string, highlight: string, count: number][]> = {
  c1: [
    ["비 오는 을지로", "젖은 간판에 비친 네온이 오늘의 한 컷", 5],
    ["현상 결과 공개하는 날", "지난주 필름 36장 중 살아남은 9장", 8],
    ["늦잠 잔 일요일", "오후 네 시에 시작된 하루", 3],
    ["속초 당일치기", "파도 소리만 30초 녹음했어요", 9],
    ["작업실 대청소", "10년 된 카메라를 다시 찾았어요", 4],
    ["첫 개인전 미팅", "떨려서 커피를 세 잔 마신 날", 6],
  ],
  c2: [
    ["가사 없는 하루", "멜로디만 네 개 남긴 날", 3],
    ["공연 리허설", "사운드체크 20분이 제일 떨려요", 6],
    ["산책하다 떠오른 코드", "Fmaj7 하나로 시작한 곡", 2],
    ["녹음 첫날", "보컬 테이크 23번째에서 오케이", 7],
    ["비 오는 작업실", "빗소리를 샘플로 썼어요", 4],
  ],
  c3: [
    ["휴식일", "오랜만에 발레 없는 하루", 2],
    ["의상 피팅", "이번 시즌 의상 첫 공개", 6],
    ["부상 회복 체크", "천천히, 그래도 매일", 4],
    ["갈라 공연 D-day", "커튼콜 직후의 무대 뒤", 9],
    ["드레스 리허설", "무대 조명 아래 첫 런스루", 7],
    ["팬레터 읽는 밤", "손편지는 여전히 특별해요", 3],
  ],
  c4: [
    ["송이버섯 들어온 날", "올가을 첫 송이", 5],
    ["휴무일 장보기", "남의 식당 탐방", 4],
    ["신메뉴 테스트", "실패 세 번, 성공 한 번", 7],
    ["단체 예약", "40인분 코스를 무사히", 6],
  ],
  c5: [
    ["전시 설치", "벽에 첫 그림을 건 순간", 6],
    ["고양이 병원 가는 날", "모찌는 건강합니다", 3],
    ["굿즈 샘플 도착", "색감이 생각보다 예뻐요", 4],
    ["마감 전날", "밤샘 작업 실황", 5],
    ["공원 드로잉", "벤치에서 세 장", 3],
  ],
  c6: [
    ["LSD 32km", "천천히 오래 달리기", 3],
    ["휴식 & 폼롤러", "회복도 훈련이다", 2],
    ["지리산 정찰 러닝", "대회 코스 미리 보기", 5],
    ["인터벌 데이", "숨이 턱까지", 2],
  ],
  c7: [
    ["북토크 하는 날", "작가님과 서른 명의 독자", 5],
    ["책 정리의 날", "헌 책 200권이 새 주인을 기다려요", 3],
    ["손님 없는 비 오는 오후", "그래서 책을 읽었습니다", 2],
    ["에세이 원고 마감", "3장 탈고", 4],
  ],
  c8: [
    ["에티오피아 새 생두", "첫 로스팅 프로파일", 4],
    ["제주 바람 부는 날", "창고 문이 계속 열려요", 2],
    ["커핑 세션", "여섯 가지 원두 블라인드 테스트", 5],
  ],
};

const FILLER = [
  "잠깐 쉬어가는 중",
  "오늘의 한 컷",
  "창밖이 예뻐서 남겨둬요",
  "점심은 간단하게",
  "생각보다 길었던 오후",
  "좋아하는 노래 틀어두고 작업 중",
  "하루 마무리. 오늘도 고마웠어요",
  "내일은 조금 더 일찍 일어나 볼게요",
];
const FILLER_TYPES: MomentType[] = ["photo", "text", "voice"];
const FILLER_VISIBILITY: Visibility[] = ["public", "public", "subscribers", "public", "premium", "public", "subscribers"];

/**
 * 지난 며칠의 Moment — Archive의 Daily는 이 Moment들을 날짜별로 묶어서 계산된다.
 * 하루의 첫 사진이 그날 반응이 가장 많은 대표 Moment(= Daily 제목·커버)가 되도록 만든다.
 */
export function buildPastMoments(): Moment[] {
  return Object.entries(PAST).flatMap(([creatorId, days]) =>
    days.flatMap(([title, highlight, count], dayIndex) => {
      const date = daysAgoDate(dayIndex + 1);
      const base = 900 + ((count * 1379 + dayIndex * 211) % 6000);
      return Array.from({ length: count }, (_, k): Moment => {
        // 08:30 ~ 21:30 사이에 제각각 흩어진 시각 (고정 슬롯 아님)
        const minute = 8 * 60 + 30 + Math.round((13 * 60 * k) / Math.max(count - 1, 1)) + ((dayIndex * 17 + k * 7) % 20);
        const id = `p-${creatorId}-${dayIndex + 1}-${k + 1}`;
        const createdAt = kstIso(date, Math.min(minute, 23 * 60 + 50));
        const common = { id, creatorId, createdAt, aiContextEnabled: true };

        if (k === 0) {
          return {
            ...common,
            type: "photo",
            content: title,
            mediaUrl: dailyCover(creatorId, dayIndex),
            visibility: "public",
            reactions: r(base, Math.round(base * 0.15), Math.round(base * 0.2), Math.round(base * 0.05)),
          };
        }
        if (k === 1) {
          return { ...common, type: "text", content: highlight, visibility: "public", reactions: r(Math.round(base * 0.6), 40, 90, 20) };
        }
        const type = FILLER_TYPES[(k + dayIndex) % FILLER_TYPES.length];
        return {
          ...common,
          type,
          content: type === "voice" ? "짧게 남기는 목소리" : FILLER[(k * 3 + dayIndex) % FILLER.length],
          visibility: FILLER_VISIBILITY[(k + dayIndex) % FILLER_VISIBILITY.length],
          reactions: r(Math.round(base * 0.25) + k * 13, 20, 30, 10),
          ...(type === "photo" ? { mediaUrl: draftPhoto(creatorId, dayIndex * 7 + k) } : {}),
          ...(type === "voice" ? { durationSec: 30 + ((k * 13 + dayIndex * 7) % 90) } : {}),
        };
      });
    }),
  );
}
