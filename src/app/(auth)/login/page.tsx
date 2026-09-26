import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TopBar } from "@/components/ui/TopBar";

/** 프로토타입 로그인: 실제 인증 없이 Today Home으로 이동 (Supabase Auth 연결 예정) */
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar backHref="/onboarding" />
      <div className="flex flex-1 flex-col px-6 pb-8">
        <h1 className="mt-4 text-title leading-snug font-bold">
          다시 만나서 반가워요.
          <br />
          <span className="text-muted">오늘도 함께하는 하루.</span>
        </h1>

        <div className="mt-10 space-y-4">
          <Field label="이메일" type="email" placeholder="you@momenty.app" defaultValue="dawn.walk@momenty.app" />
          <Field label="비밀번호" type="password" placeholder="••••••••" defaultValue="password" />
        </div>

        <div className="mt-8 space-y-2.5">
          <ButtonLink href="/today" size="lg" block>
            로그인
          </ButtonLink>
          <div className="my-5 flex items-center gap-3 text-meta text-faint">
            <span className="h-px flex-1 bg-line-strong" />
            또는
            <span className="h-px flex-1 bg-line-strong" />
          </div>
          <ButtonLink href="/today" variant="secondary" size="lg" block>
            카카오로 계속하기
          </ButtonLink>
          <ButtonLink href="/today" variant="secondary" size="lg" block>
            Apple로 계속하기
          </ButtonLink>
        </div>

        <div className="mt-auto pt-8 text-center text-caption text-muted">
          처음이신가요?{" "}
          <Link href="/signup" className="font-semibold text-ink">
            회원가입
          </Link>
          <div className="mt-3">
            <Link href="/studio" className="text-meta text-faint underline underline-offset-2">
              크리에이터 모드 둘러보기
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
