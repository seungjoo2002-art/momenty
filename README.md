# MOMENTY — 좋아하는 사람의 하루를 구독하다

크리에이터가 원하는 순간에 남긴 **Moment**가 모여 **Today**가 되고, 팬은 그 하루를 따라가며
오늘의 기록을 바탕으로 한 **Creator AI(Persona)**, 그리고 때때로 **실제 크리에이터(Human)**와 대화합니다.

> 현재 단계(v0.4): 실제 가입 사용자가 Fan / Creator로 사용하는 앱. Supabase Auth · Postgres(RLS) · Storage 기반.
> Creator AI(Persona) · Fan Memory · AI Fan Manager · 결제는 아직 열지 않았다 — 화면에서는 "준비 중"으로 보인다.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000 → /onboarding
```

Supabase 환경 변수가 필요하다 (localStorage 대체 모드는 없다). 아래 [Supabase](#supabase) 참고.

- 회원가입(`/signup`)에서 **팬으로 시작** 또는 **크리에이터로 시작**을 고른다.
  - 팬: 관심 카테고리 → Discover → 팔로우 → Today
  - 크리에이터: 크리에이터 프로필(활동명 · 사용자 이름 · 사진 · 소개 · 카테고리) → Studio
- 역할은 잠기지 않는다. 팬도 My → "크리에이터로 시작하기"로 크리에이터 프로필을 만들 수 있고, 크리에이터도 다른 크리에이터를 팔로우한다.
  "크리에이터인지"는 `creators` 행이 있는지로만 판단한다.

## 기술 스택

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · lucide-react

## 구조

```
src/
├─ app/                         라우트 (화면)
│  ├─ (auth)/                   onboarding · login · signup · forgot-password · reset-password · auth/callback
│  │  └─ setup/                 가입 직후 단계 (로그인 필요): interests(팬) · creator(크리에이터 프로필)
│  ├─ (fan)/                    팬 화면 + 팬 BottomNavigation
│  │  ├─ today/                 Today Home
│  │  ├─ discover/              Discover
│  │  ├─ creators/[id]/         Creator Profile
│  │  ├─ creators/[id]/today/   Creator Today (세로 Timeline)
│  │  ├─ moments/[id]/          Moment Detail
│  │  ├─ subscribe/[id]/        Subscription
│  │  ├─ chat/ · chat/[id]/     Creator AI 대화 — 준비 중 (v0.5)
│  │  ├─ archive/               Archive
│  │  └─ my/ · my/memory/       My Page · Fan Memory(준비 중)
│  └─ studio/                   Creator Mode + 크리에이터 BottomNavigation
│     ├─ record/ · record/preview/   Moment 기록 · 미리보기 + 공개범위
│     ├─ fans/ · fans/[id]/          실제 팔로워 목록 · Fan Manager(준비 중)
│     ├─ records/ · analytics/       내 기록 · 반응 통계(실제 데이터)
│     └─ settings/ · settings/profile/   설정 · 프로필 편집 (persona · boundary · safeshare는 준비 중)
├─ components/                  공통 UI (도메인별)
│  ├─ ui/        Avatar, Photo, Button, TopBar, BottomSheet, Toggle, Field, RelativeTime, primitives(Card·PageHeader·SectionHeader·Chip·Segmented·ListGroup·ListRow)
│  ├─ badges/    SubscriptionBadge, VisibilityBadge, SafetyBadge, AIBadge, HumanBadge
│  ├─ moment/    MomentTimeline, MomentCard, MomentMedia, MomentDots, MomentActions, ReactionButton, ReactionBar, VoicePlayer, DailyCard
│  ├─ auth/      AuthProvider(로그인 상태 · 세션 복원), Gates(RequireAuth · FanGate · CreatorGate)
│  ├─ creator/   CreatorScreen, CreatorTabs, CreatorStoryRow, TodayHero, TodayTile, CreatorCard, FollowButton, CreatorProfileForm
│  ├─ chat/      AIMessage, CreatorMessage, FanMessage, SystemNotice, ChatRoom
│  ├─ studio/    VisibilitySelector, LineChart
│  └─ layout/    AppFrame, BottomNavigation
└─ lib/
   ├─ types.ts   도메인 타입 (Supabase 스키마 초안)
   ├─ mock/      seed 데이터 — 화면에서 import 금지 (seed 스크립트 · 온보딩 소개 그림(예시 표시)에서만)
   ├─ services/  데이터 접근 레이어 (async) — 화면은 여기만 호출
   │  ├─ auth.ts       가입 · 로그인 · 로그아웃 · 비밀번호 재설정 · 계정 상태
   │  ├─ creators.ts   크리에이터 조회 · 프로필 생성/수정 (프로필 사진 교체 시 예전 파일 삭제)
   │  ├─ media.ts      Storage 업로드 (형식 · 크기 검사, uuid 경로)
   │  ├─ moments.ts    Moment · Today · Daily · 반응 → backends/moments.supabase.ts
   │  ├─ fan.ts        팔로우 · Today feed · 보관함
   │  ├─ studio.ts     팔로워 목록 · 통계 (크리에이터 본인)
   │  └─ drafts.ts     작성 중인 Moment (기기 로컬 — 공개하는 순간에만 업로드)
   ├─ supabase/  client.ts(브라우저 쿠키 세션 · 서버 공개 anon) · server.ts(server-only, 요청 쿠키 세션) · proxy.ts(세션 갱신 · 서버 라우트 보호)
   ├─ hooks/     useMomentData — 서비스 호출 + 변경 시 다시 불러오기 + 오류 상태
   ├─ ai/        Persona AI 기반 (server-only): config(키) · schema(zod) · policy(권한) · context(Context Builder) · rateLimit · audit
   │             persona.ts는 v0.4 이전 프로토타입 (화면 미연결)
   └─ utils/     format(KST 시간), access(공개범위 권한), cn
```

### 데이터 흐름

```
화면(Client Component) ─ useMomentData ─▶ lib/services/* ─▶ supabase-js (로그인 사용자의 JWT) ─▶ Supabase (RLS · Storage 정책)
```

- UI 컴포넌트는 Supabase를 직접 호출하지 않는다.
- 로그인 사용자 기준 데이터(Today · Creator Today · Detail · Archive · My · Studio)는 클라이언트에서 불러온다. 서버 렌더링(Discover · 크리에이터 기본 정보)은 세션 없이 공개 데이터만 읽는다.
- Moment 기록: 파일은 미리보기까지 기기 안에만 있고, **공개하기**를 누르면 Storage 업로드 → `moments` insert. insert가 실패하면 올린 파일을 바로 지운다.
- Moment 삭제: DB 행을 먼저 지우고 연결된 파일(미디어 · 포스터)을 지운다. 파일 정리가 실패해 남은 파일은 `npm run db:cleanup-media`가 찾아 지운다.
- Today = `created_at`의 **KST 날짜** 범위(`kstDayRange`)로 조회한다. Daily(지난 하루)는 테이블 없이 Moment를 날짜별로 묶어 계산한다.

## Supabase

### 1. 환경 변수

`.env.example`을 `.env.local`로 복사해서 채운다 (`.env.local`은 git에 올라가지 않는다).

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (또는 예전 `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **seed · 정리 스크립트 · 테스트 준비 전용** 서버 키. `NEXT_PUBLIC_` 금지 |
| `DEMO_FAN_EMAIL` / `_PASSWORD` | seed가 만드는 데모 팬 (test:live가 권한 검사에 사용) |
| `DEMO_CREATOR_EMAIL` / `_PASSWORD` | seed가 만드는 데모 크리에이터(한하린 · c1) |

> 앱 화면은 데모 계정을 쓰지 않는다 (자동 로그인 없음). `NEXT_PUBLIC_`을 붙이지 않은 서버 · 테스트 전용 변수다.

**Supabase Dashboard 설정 (Authentication)**

- URL Configuration → Site URL / Redirect URLs에 앱 주소와 `…/auth/callback`, `…/reset-password`를 넣는다
  (예: `http://localhost:3000/**`). 가입 확인 · 비밀번호 재설정 메일의 링크가 이 주소로 돌아온다.
- Email → **Confirm email**: 켜면 가입 후 확인 메일의 링크를 눌러야 로그인된다 (앱은 두 경우 모두 처리한다).
  Supabase 기본 메일 발송은 시간당 몇 통으로 제한되므로, 켜 둔 채 실제 사용자를 받으려면 Custom SMTP를 연결한다.

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
4. `supabase/migrations/20260927030000_v04_auth_profiles_media.sql` — v0.4: 컬럼 단위 쓰기 권한, 미디어 경로 검증 trigger, 무료 팔로우, 팔로워 수 집계, avatars bucket · 파일 형식/크기 제한, 보관함, orphan 파일 조회 함수.

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
| `moment_bookmarks` | PK(user_id, moment_id) — 보관함 (볼 수 있는 Moment만) |
| `moment_feed` (view) | 화면이 읽는 Moment. 볼 수 없는 Moment는 **행은 오되 content · media_url이 DB에서 null** (Locked State용) + 반응 수 · liked_by_me |

- `moment-media` (비공개, 50MB): 사진 · 영상(+포스터) · 음성을 `{creator_id}/{uuid}.{ext}`로 저장, signed URL로 읽는다.
  사진은 업로드 전에 줄이면서 위치 정보(EXIF)를 지운다.
- `avatars` (공개, 2MB, JPG/PNG/WEBP): 프로필 사진 `{auth.uid}/{uuid}.jpg`.

### 5. RLS 요약

모든 판단은 `can_view_moment()` · `is_creator_owner()` 두 함수에 모여 있다.

| 대상 | 규칙 |
|---|---|
| moments 조회 | public: 누구나 · subscriber: 해당 크리에이터 subscriber/premium 구독자 · premium: premium 구독자 · 크리에이터 본인은 전부 |
| moments 생성 · 수정 · 삭제 | 해당 크리에이터 본인만 (creator_id를 남의 것으로 바꾸는 수정도 거부) |
| moment_reactions | 본인 것만 조회 · 생성 · 삭제. 볼 수 없는 Moment에는 반응 불가 |
| subscriptions | 팬 본인 · 해당 크리에이터만 조회. 팬은 **무료 팔로우만** 직접 만들고 취소 (자기 채널 제외). 유료 등급은 service role(결제 서버)만 |
| profiles · creators | 누구나 조회, 본인만 수정. 로그인 사용자는 자기 profile로 creators 생성 가능. verified · 팔로워 수 · 가격은 앱에서 못 바꾼다 (컬럼 권한) |
| moments 쓰기 컬럼 | created_at · creator_id는 앱에서 정하거나 바꿀 수 없다. media_url · poster_url은 **내 폴더 + 실제 업로드된 파일**만 (trigger) |
| storage `moment-media` | 볼 수 있는 Moment의 파일만 읽기, 크리에이터 본인 폴더에만 업로드 · 삭제 |
| storage `avatars` | 누구나 읽기, 본인 폴더(`{auth.uid}/`)에만 업로드 · 수정 · 삭제 |

화면 가드(로그인 필요 화면 → Login, `/studio/*` → 크리에이터만)는 `components/auth/Gates.tsx`가 하지만, 이것은 화면 표시용이다.
실제 데이터 보호는 위 RLS · Storage 정책이 한다 (팬 계정으로 Studio API를 직접 호출해도 DB가 거부한다 — test:e2e).

### 6. 테스트

```bash
npm run test:db        # migration을 PGlite(WASM Postgres)에 적용해 RLS · 제약 · seed 데이터 검증
npm run test:backend   # 서비스가 만드는 요청(KST 범위 · 로그인 토큰 · 업로드 · orphan 정리 · 반응)을 가짜 fetch로 검증
npm run test:live -- --confirm-dev   # 실제 Supabase · seed 데모 계정으로 RLS · Storage 권한 회귀 검사
npm run test:e2e  -- --confirm-dev   # 실제 Supabase에 새 Creator · Fan 가입 → 흐름 · 보안 검사 → 정리
npm run build && npm run test:ui -- --confirm-dev   # 설치된 Chrome으로 화면 E2E (가입 · 기록 · 팔로우 · 라우트 보호)
npm run build && npm run test:ai -- --confirm-dev   # 서버 라우트 보호 · /api/ai/chat 인증 · 입력 · 권한 · Context · injection · rate limit
npm run db:cleanup-media -- --dry-run --confirm-dev # 참조 없는 업로드 파일 찾기 (--dry-run 빼면 삭제)
```

test:e2e · test:ui는 Confirm email이 꺼진 프로젝트에서 실행한다 (가입 메일이 나가지 않도록 — 켜져 있으면 스스로 멈춘다).
service role은 준비 · 정리에만 쓰고, 권한 검사는 전부 테스트 사용자의 JWT로 한다.

## 서버 인증 · AI 기반 (v0.5-1)

```
브라우저 ─(쿠키 세션)─▶ src/proxy.ts ─▶ 페이지 / Route Handler ─(사용자 JWT)─▶ Supabase (RLS)
                          │ 세션 갱신 · 비로그인 → /login?next=
                          └ /studio: studio/layout.tsx(서버)가 creators 행 확인 → 아니면 Studio 대신 안내만 렌더링
```

- 세션은 `@supabase/ssr` 쿠키에 있다 → 서버도 로그인 사용자를 안다. 서버에서의 신원 확인은 `getUser()`/`getClaims()`(서명 검증)로만 하고 쿠키 값을 그대로 믿지 않는다.
- service role key는 앱 코드(페이지 · Route Handler) 어디에도 없다. seed · 정리 스크립트 · 테스트 준비에만.
- 서버 보호 경로: `/today` `/my` `/archive` `/chat` `/subscribe` `/studio` `/setup`. 클라이언트 Gate는 화면 전환용으로 남아 있다.

### POST /api/ai/chat (LLM 미연결)

| 단계 | 내용 | 실패 |
|---|---|---|
| 인증 | 쿠키 세션 → `getUser()` · 다른 Origin 요청 거부 | 401 · 403 |
| 입력 | zod strict: `creatorId` · `message`(1~1000자) · `conversationId?` · `momentId?`, 정의 밖 필드 거부, 본문 16KB | 400 |
| 권한 | 크리에이터 존재 · Persona 사용 · 본인 채널 아님 · 구독자(subscriber/premium) | 404 · 403 |
| 횟수 제한 | `RateLimiter` 인터페이스 (user × creator, user 전체, 시간 창). 지금은 프로세스 메모리 구현 | 429 + Retry-After |
| Context | `createContextBuilder(사용자 세션)` — `moments` + RLS + `ai_context_enabled = true` 만 | — |
| 응답 | `reply: null`, `meta { author: "ai", persona, generated, provider, model, context { types, momentIds, focusMomentId } }` | — |

- Persona가 볼 수 있는 칸: style · facts · boundaries · **today** · fanMemory · conversation (+ focus). v0.5-1에서는 today만 데이터가 있다.
- 메시지 내용은 권한 · Context 선택에 쓰이지 않는다 → prompt injection으로 데이터 범위가 넓어지지 않는다.
- 감사 기록은 요청 id · 크리에이터 id · 결과 · 메시지 길이 · Context 종류/개수만 (본문 · 프롬프트 · 개인정보 없음).
- AI 키는 `AI_PROVIDER` · `AI_API_KEY` · `AI_MODEL` (서버 환경 변수). `src/lib/ai/*`는 `server-only` — Client Component에서 import하면 빌드가 실패한다.

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
