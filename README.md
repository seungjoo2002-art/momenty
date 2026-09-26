# MOMENTY — 좋아하는 사람의 하루를 구독하다

크리에이터가 원하는 순간에 남긴 **Moment**가 모여 **Today**가 되고, 팬은 그 하루를 따라가며
오늘의 기록을 바탕으로 한 **Creator AI(Persona)**, 그리고 때때로 **실제 크리에이터(Human)**와 대화합니다.

> 현재 단계: Moment · Today · Reaction은 Supabase(Postgres + RLS + Storage) 기반. 실제 AI · 결제 · 채팅 · Fan Memory는 아직 Mock.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000 → /onboarding
```

`.env.local`이 없으면 **로컬 개발 모드**(localStorage + Mock seed)로 동작한다. Supabase 연결은 아래 [Supabase](#supabase) 참고.

- 팬 모드 시작: `/today`
- 크리에이터 모드 시작: `/studio` (로그인 화면 하단 "크리에이터로 로그인 (데모)" 또는 My → 크리에이터 모드로 전환)

## 기술 스택

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · lucide-react

## 구조

```
src/
├─ app/                         라우트 (화면)
│  ├─ (auth)/                   onboarding · login · signup
│  ├─ (fan)/                    팬 화면 + 팬 BottomNavigation
│  │  ├─ today/                 Today Home
│  │  ├─ discover/              Discover
│  │  ├─ creators/[id]/         Creator Profile
│  │  ├─ creators/[id]/today/   Creator Today (세로 Timeline)
│  │  ├─ moments/[id]/          Moment Detail
│  │  ├─ subscribe/[id]/        Subscription
│  │  ├─ chat/ · chat/[id]/     Chat 목록 · 대화방
│  │  ├─ archive/               Archive
│  │  └─ my/ · my/memory/       My Page · Fan Memory
│  └─ studio/                   Creator Mode + 크리에이터 BottomNavigation
│     ├─ record/ · record/preview/   Moment 기록 · 미리보기 + 공개범위
│     ├─ fans/ · fans/[id]/          Fans · Fan Manager
│     ├─ records/ · analytics/
│     └─ settings/ (persona · boundary · safeshare)
├─ components/                  공통 UI (도메인별)
│  ├─ ui/        Avatar, Photo, Button, TopBar, BottomSheet, Toggle, Field, RelativeTime, primitives(Card·PageHeader·SectionHeader·Chip·Segmented·ListGroup·ListRow)
│  ├─ badges/    SubscriptionBadge, VisibilityBadge, SafetyBadge, AIBadge, HumanBadge
│  ├─ moment/    MomentTimeline, MomentCard, MomentMedia, MomentDots, MomentActions, ReactionButton, ReactionBar, VoicePlayer, DailyCard
│  ├─ creator/   CreatorScreen, CreatorTabs, CreatorStoryRow, TodayHero, TodayTile, CreatorCard, FollowButton
│  ├─ chat/      AIMessage, CreatorMessage, FanMessage, SystemNotice, ChatRoom
│  ├─ studio/    VisibilitySelector, LineChart
│  └─ layout/    AppFrame, BottomNavigation
└─ lib/
   ├─ types.ts   도메인 타입 (Supabase 스키마 초안)
   ├─ mock/      Mock Data — 화면에서 직접 import 금지 (seed · 로컬 개발 모드에서만 사용)
   ├─ services/  데이터 접근 레이어 (async) — 화면은 여기만 호출
   │  └─ backends/  moments.supabase.ts (Supabase) · moments.local.ts (localStorage fallback)
   ├─ supabase/  클라이언트 · 역할별 세션 (services에서만 import)
   ├─ hooks/     useMomentData — 서비스 호출 + 변경 시 다시 불러오기 + 오류 상태
   ├─ ai/        Creator AI 인터페이스 (현재 Mock 응답)
   └─ utils/     format(KST 시간), access(공개범위 권한), cn
```

### 데이터 흐름

```
화면(Client Component) ─ useMomentData ─▶ lib/services/moments.ts ─┬─▶ backends/moments.supabase.ts ─▶ Supabase
                                                                    └─▶ backends/moments.local.ts    ─▶ localStorage (env 없을 때)
```

- UI 컴포넌트는 Supabase · localStorage를 직접 호출하지 않는다.
- Moment를 읽는 화면(Today Home · Creator Today · Detail · Archive · Records · Studio Timeline · Chat 방)은 로그인 세션이 필요하므로 클라이언트에서 불러온다.
- Today = `created_at`의 **KST 날짜** 범위(`kstDayRange`)로 조회한다. Daily(지난 하루)는 테이블 없이 Moment를 날짜별로 묶어 계산한다.

## Supabase

### 1. 환경 변수

`.env.example`을 `.env.local`로 복사해서 채운다 (`.env.local`은 git에 올라가지 않는다).

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (또는 예전 `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **seed 스크립트 전용** 서버 키. `NEXT_PUBLIC_` 금지 |
| `NEXT_PUBLIC_DEMO_FAN_EMAIL` / `_PASSWORD` | 데모 팬 자동 로그인 |
| `NEXT_PUBLIC_DEMO_CREATOR_EMAIL` / `_PASSWORD` | 데모 크리에이터(한하린 · c1) 자동 로그인 |

> 데모 계정 값은 브라우저 번들에 포함된다. 로그인 화면을 Supabase Auth에 연결하기 전까지의 **데모 전용** 장치이며, 실제 서비스에서는 비워 둔다.
> 팬 모드와 `/studio`는 서로 다른 세션(storageKey)을 쓴다 — `src/lib/supabase/client.ts`.

### 2. Migration 적용

스키마는 `supabase/migrations/*.sql`로 버전 관리한다. 변경은 **새 migration 파일을 추가**하고, 이미 적용된 파일은 고치지 않는다.

**A. Supabase CLI (권장)**

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push          # supabase/migrations 를 순서대로 적용
```

**B. SQL Editor**: Dashboard → SQL Editor에서 아래 파일을 **순서대로** 각각 전체 실행한다.

1. `supabase/migrations/20260927000000_init_moments.sql` — 스키마 · RLS · view · Storage 정책
2. `supabase/migrations/20260927010000_grant_api_access.sql` — Data API 권한(GRANT). 새 프로젝트는 테이블을 anon/authenticated에 자동으로 열지 않으므로 필요하다.
3. `supabase/migrations/20260927020000_grant_service_role.sql` — service_role 테이블 권한 (seed · 서버 전용 작업용).

### 3. 개발용 seed (선택)

기존 Mock 데이터(크리에이터 8명 · 데모 팬 · 구독 · 지난 하루 · 오늘 지난 시각까지의 Moment)를 넣는다.

```bash
npm run db:seed -- --confirm-dev           # 여러 번 실행해도 중복되지 않는다
npm run db:seed -- --reset --confirm-dev   # seed로 만든 사용자와 연결된 데이터만 삭제
```

seed가 만든 사용자는 `app_metadata.momenty_seed = true`로 표시되고, `--reset`은 그 사용자만 지운다(cascade). 운영 프로젝트에는 실행하지 않는다.

### 4. 스키마

```
auth.users ─1:1─ profiles ─1:0..1─ creators ─1:N─ moments ─1:N─ moment_reactions
                    │                  │
                    └──1:N─ subscriptions ─N:1──┘            moment_reactions.user_id → profiles
```

| 테이블 | 핵심 컬럼 |
|---|---|
| `profiles` | `id`(= auth.users.id), nickname, handle, avatar_url — 가입 시 trigger로 생성 |
| `creators` | `id`(URL용 짧은 id), `profile_id` unique FK, name, handle, category(enum), 가격, 표시용 집계 |
| `subscriptions` | `fan_id` FK, `creator_id` FK, `tier`(follow · subscriber · premium), unique(fan_id, creator_id) |
| `moments` | id, creator_id, `type`(text · photo · video · voice), content, media_url, duration_sec, `visibility`(public · subscriber · premium), ai_context_enabled, created_at, updated_at |
| `moment_reactions` | PK(moment_id, user_id, kind) — 같은 반응 중복 불가 |
| `moment_feed` (view) | 화면이 읽는 Moment. 볼 수 없는 Moment는 **행은 오되 content · media_url이 DB에서 null** (Locked State용) + 반응 수 · liked_by_me |

사진은 비공개 Storage bucket `moment-media`에 `{creator_id}/{파일}`로 저장하고 signed URL로 읽는다.

### 5. RLS 요약

모든 판단은 `can_view_moment()` · `is_creator_owner()` 두 함수에 모여 있다.

| 대상 | 규칙 |
|---|---|
| moments 조회 | public: 누구나 · subscriber: 해당 크리에이터 subscriber/premium 구독자 · premium: premium 구독자 · 크리에이터 본인은 전부 |
| moments 생성 · 수정 · 삭제 | 해당 크리에이터 본인만 (creator_id를 남의 것으로 바꾸는 수정도 거부) |
| moment_reactions | 본인 것만 조회 · 생성 · 삭제. 볼 수 없는 Moment에는 반응 불가 |
| subscriptions | 팬 본인 · 해당 크리에이터만 조회. 쓰기는 service role(결제 서버)만 |
| profiles · creators | 누구나 조회, 본인만 수정. 로그인 사용자는 자기 profile로 creators 생성 가능 |
| storage `moment-media` | 볼 수 있는 Moment의 파일만 읽기, 크리에이터 본인 폴더에만 업로드 · 삭제 |

### 6. 테스트

```bash
npm run test:db        # migration을 PGlite(WASM Postgres)에 적용해 RLS · 제약 · seed 데이터 검증
npm run test:backend   # Supabase backend가 만드는 요청(KST 범위 · 세션 · 업로드 · 반응)을 가짜 fetch로 검증
```

## 디자인 시스템

토큰은 `src/app/globals.css`의 `@theme`에 모여 있다.

| 구분 | 값 |
|---|---|
| Color | canvas `#FAF9FF` · surface `#FFF` · brand `#6C4DFF` · brand-2 `#9B87FF` · brand-soft `#EEE9FF` · line `#EEEAF8` |
| Type | `text-title` 24 · `text-section` 18 · `text-name` 16 · `text-body` 15 · `text-sub` 14 · `text-caption` 13 · `text-meta` 12 · `text-micro` 11 |
| Radius | `rounded-card` 20 · `rounded-tile` 14 |
| Motion | `pressable`(누름 scale) · `animate-fade-in` · `animate-open` · `animate-sheet-up` (150~240ms) |

Mock 이미지는 `src/lib/mock/images.ts` 한 곳에서 크리에이터 단위로 관리한다. 크리에이터가 올린 사진은 Supabase Storage(`moment-media`)에 저장된다.

## 설계 원칙

- Today에는 시간 슬롯이 없다. 실제로 기록된 Moment만 시간순으로 나타난다 (`MomentTimeline`).
  Moment 사이 간격은 실제 시간 차이와 무관하게 일정해서, 기록하지 않은 시간이 드러나지 않는다.
- Today Home은 시간 축 대신 개수만 보여주는 dot(`MomentDots`)과 "마지막 기록 n분 전"을 쓴다.
- 크리에이터에게 업로드 횟수·시간대·연속 기록을 압박하는 UI는 두지 않는다.
- Creator AI 진입점은 항상 Moment 콘텐츠보다 시각적으로 약하게 둔다.
- AI와 실제 크리에이터는 라벨 · 말풍선 색 · 아바타 링 세 가지로 구분한다.
- Creator AI는 팬이 볼 수 있고 크리에이터가 AI 참고를 허용한 오늘의 Moment만 근거로 한다.
