import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/LoginForm";
import { AuthShell } from "@/components/AuthShell";
import { hasLoginAccounts, isAuthRequired } from "@/lib/auth";
import { readSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!isAuthRequired()) redirect("/");
  if (await readSessionUser()) redirect("/");
  const configured = hasLoginAccounts();

  return (
    <AuthShell>
      {configured ? (
        <LoginForm />
      ) : (
        <p className="auth-warning">
          Администратор ещё не настроен. Откройте адрес <code>/setup</code> и введите ключ первичной настройки
          сервера.
        </p>
      )}
    </AuthShell>
  );
}
