"use client";

import { Camera, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Chip } from "@/components/ui/primitives";
import { JOB_MAX, JOB_PRESETS } from "@/lib/avatar";
import { CATEGORY_LABEL } from "@/lib/constants";
import { HANDLE_RULE, isHandleAvailable, validateCreatorProfile, type CreatorProfileInput } from "@/lib/services/creators";
import { checkFile, MEDIA_RULES } from "@/lib/services/media";
import type { CategoryKey } from "@/lib/types";

export interface CreatorProfileValues {
  name: string;
  handle: string;
  job: string;
  bio: string;
  category: CategoryKey | "";
  avatarUrl: string;
}

const OTHER = "기타";

/**
 * 크리에이터 프로필 입력 — 가입 후 만들기(/setup/creator)와 Studio 프로필 편집이 함께 쓴다.
 * 필수: 프로필 사진 · 활동명 · 아이디(@handle) · 직업/활동 분야(고르기 + 직접 입력) · 소개 · 카테고리.
 * 프로필 사진은 고르는 즉시 미리보기(기기 안), 저장할 때 Storage에 올린다.
 */
export function CreatorProfileForm({
  initial,
  creatorId,
  submitLabel,
  onSubmit,
}: {
  initial: CreatorProfileValues;
  /** 수정일 때 — 내 아이디는 "사용 중"으로 보지 않는다 */
  creatorId?: string;
  submitLabel: string;
  onSubmit: (input: CreatorProfileInput) => Promise<void>;
}) {
  const presetJob = (JOB_PRESETS as readonly string[]).includes(initial.job);
  const [values, setValues] = useState(initial);
  const [jobChoice, setJobChoice] = useState<string>(presetJob ? initial.job : initial.job ? OTHER : "");
  const [customJob, setCustomJob] = useState(presetJob ? "" : initial.job);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const set = <K extends keyof CreatorProfileValues>(k: K, v: CreatorProfileValues[K]) => setValues((s) => ({ ...s, [k]: v }));
  const job = jobChoice === OTHER ? customJob.trim() : jobChoice;

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const invalid = checkFile("image", f);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !values.avatarUrl) {
      setError("프로필 사진을 골라 주세요.");
      return;
    }
    const data = { name: values.name, handle: values.handle.trim().toLowerCase(), job, bio: values.bio, category: values.category as CategoryKey };
    const invalid = validateCreatorProfile(data);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (!(await isHandleAvailable(data.handle, creatorId))) {
        setError("이미 사용 중인 아이디예요.");
        setPending(false);
        return;
      }
      await onSubmit({ ...data, avatarFile: file });
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했어요.");
      setPending(false);
    }
  }

  const handleOk = !values.handle || HANDLE_RULE.test(values.handle);

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-col items-center">
        <button type="button" onClick={() => input.current?.click()} className="pressable relative" aria-label="프로필 사진 고르기">
          <Avatar src={preview ?? (values.avatarUrl || undefined)} name={values.name || "프로필"} size="2xl" />
          <span className="absolute right-0 bottom-0 grid size-7 place-items-center rounded-full bg-ink text-white ring-2 ring-canvas">
            <Camera className="size-3.5" />
          </span>
        </button>
        <input ref={input} type="file" accept={MEDIA_RULES.image.types.join(",")} hidden onChange={pick} />
        <p className="mt-2 text-meta text-muted">프로필 사진 (필수) · {MEDIA_RULES.image.label}</p>
      </div>

      <div className="mt-7 space-y-4">
        <Field label="활동명" maxLength={40} placeholder="팬에게 보일 이름" value={values.name} onChange={(e) => set("name", e.target.value)} />
        <div>
          <Field
            label="아이디"
            autoCapitalize="none"
            autoCorrect="off"
            maxLength={30}
            placeholder="my.name"
            value={values.handle}
            onChange={(e) => set("handle", e.target.value.toLowerCase().replace(/\s/g, ""))}
          />
          <p className={`mt-1.5 text-meta ${handleOk ? "text-muted" : "text-danger"}`}>@아이디로 보여요 · 영문 소문자 · 숫자 · 마침표 · 밑줄, 2~30자</p>
        </div>
        <div>
          <span className="mb-1.5 block text-caption font-medium text-ink-2">직업 / 활동 분야</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="직업 / 활동 분야">
            {[...JOB_PRESETS, OTHER].map((j) => (
              <Chip key={j} active={jobChoice === j} onClick={() => setJobChoice(j)}>
                {j}
              </Chip>
            ))}
          </div>
          {jobChoice === OTHER && (
            <input
              value={customJob}
              maxLength={JOB_MAX}
              onChange={(e) => setCustomJob(e.target.value)}
              placeholder="직접 입력 (예: 요리 연구가)"
              aria-label="직업 / 활동 분야 직접 입력"
              className="mt-2 h-11 w-full rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10"
            />
          )}
          <p className="mt-1.5 text-meta text-muted">프로필에 공개돼요.</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-caption font-medium text-ink-2">소개</span>
          <textarea
            value={values.bio}
            maxLength={300}
            rows={3}
            onChange={(e) => set("bio", e.target.value)}
            placeholder="어떤 하루를 나누고 싶은지 한두 줄로"
            className="w-full resize-none rounded-tile border border-line-strong bg-surface px-4 py-3 text-body outline-none placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10"
          />
        </label>
        <div>
          <span className="mb-1.5 block text-caption font-medium text-ink-2">카테고리</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((k) => (
              <Chip key={k} active={values.category === k} onClick={() => set("category", k)}>
                {CATEGORY_LABEL[k]}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-meta text-muted">Discover에서 이 카테고리로 찾을 수 있어요.</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-caption text-danger">
          {error}
        </p>
      )}
      <div className="mt-auto pt-8">
        <Button type="submit" size="lg" block disabled={pending}>
          {pending && <Loader2 className="size-5 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
