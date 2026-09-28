import { LoginForm } from "./LoginForm";

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, deleted } = await props.searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} deleted={deleted === "1"} />;
}
