/**
 * PGlite 테스트 준비 (superuser로 실행) — 크리에이터의 AI Avatar를 "준비 완료 + ON"으로 만든다.
 *
 * v0.8.5부터 AI 문답은 기본정보 · 필수 말투 문답 · Persona · Boundary 확인이 모두 끝나야 켤 수 있고,
 * 팬은 "AI 대화를 크리에이터가 볼 수 있다"는 고지를 확인해야 대화할 수 있다.
 * 예전 버전 테스트(v0.5 ~ v0.8)는 그 전제 위에서 원래 검사하던 것을 그대로 검사한다.
 *
 * 기본정보 사실은 "[기본] "으로 시작한다 (다른 사실 검사와 구분하기 위해).
 */
export function avatarReadySql(creatorId, fanIds = []) {
  if (!/^[a-z0-9_-]{1,40}$/.test(creatorId)) throw new Error("bad creator id");
  const consents = fanIds
    .map((f) => {
      if (!/^[0-9a-f-]{36}$/.test(f)) throw new Error("bad fan id");
      return `insert into public.ai_creator_view_consents (fan_id, creator_id) values ('${f}', '${creatorId}') on conflict do nothing;`;
    })
    .join("\n");
  return `
    update public.creators set job = '테스트 크리에이터' where id = '${creatorId}' and job = '';
    insert into public.creator_facts (creator_id, category, content, source, basic_key)
      select '${creatorId}', 'other', '[기본] ' || k, 'avatar_basics', k
      from unnest(array['favorite_food', 'disliked_food', 'hobby', 'interest', 'likes', 'dislikes']) as k
      on conflict do nothing;
    insert into public.creator_style_samples (creator_id, source, prompt_key, fan_message, reply)
      select '${creatorId}', 'onboarding', p.key, p.fan_message, '테스트 답변 ' || p.sort
      from public.avatar_training_prompts p
      where not exists (
        select 1 from public.creator_style_samples s
        where s.creator_id = '${creatorId}' and s.prompt_key = p.key and s.source = 'onboarding' and s.archived_at is null
      );
    insert into public.creator_personas (creator_id) values ('${creatorId}') on conflict do nothing;
    insert into public.creator_avatar_settings (creator_id, boundaries_confirmed_at) values ('${creatorId}', now())
      on conflict (creator_id) do update set boundaries_confirmed_at = now();
    update public.creators set persona_enabled = true where id = '${creatorId}';
    ${consents}
  `;
}
