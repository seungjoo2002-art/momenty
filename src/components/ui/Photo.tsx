"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

interface PhotoProps {
  src?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  children?: React.ReactNode;
}

/**
 * 크리에이터 사진/영상 썸네일.
 * 이미지 로드 실패(오프라인 등) 시 연한 라벤더 placeholder가 그대로 보인다.
 */
export function Photo({ src, alt, className, imgClassName, children }: PhotoProps) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn("relative overflow-hidden bg-brand-soft", className)}>
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className={cn("absolute inset-0 h-full w-full object-cover", imgClassName)}
        />
      )}
      {children}
    </div>
  );
}
