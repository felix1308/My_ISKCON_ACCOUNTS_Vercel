import { redirect } from "next/navigation";

// Root: bounce to /dashboard (which itself redirects to /login if no session).
export default function RootPage() {
  redirect("/dashboard");
}
