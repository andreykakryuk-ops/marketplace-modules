import { redirect } from "next/navigation";
import { SetupForm } from "@/app/setup/SetupForm";
import { AuthShell } from "@/components/AuthShell";
import { hasLoginAccounts, isAuthRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (!isAuthRequired()) redirect("/");
  if (hasLoginAccounts()) redirect("/login");

  return (
    <AuthShell title="Склад" hint="Создайте вход владельца. После сохранения эта страница будет отключена.">
      <SetupForm />
    </AuthShell>
  );
}
