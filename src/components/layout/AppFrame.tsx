/**
 * 모바일 퍼스트 앱 프레임.
 * 모바일에서는 전체 화면, 태블릿/데스크톱에서는 가운데 정렬된 앱 컬럼으로 보인다.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[430px] bg-canvas sm:shadow-frame">{children}</div>
  );
}
