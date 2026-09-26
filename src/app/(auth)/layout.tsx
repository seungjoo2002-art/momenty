import { AppFrame } from "@/components/layout/AppFrame";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
