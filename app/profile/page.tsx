import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/app/profile/ProfileForm";
import { getLoginAccount } from "@/lib/auth";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  const user = await getSessionUser({ allowPasswordChange: true });
  const account = getLoginAccount(user.id);
  if (!account) redirect("/");
  const { changed } = await searchParams;

  return (
    <main className="profile-page">
      <section className="auth-card profile-card">
        <h1>{account.mustChangePassword ? "Смените временный пароль" : "Мой профиль"}</h1>
        {account.mustChangePassword ? (
          <p className="auth-warning">
            Это первый вход с временным паролем. Рабочие разделы откроются после установки собственного пароля.
          </p>
        ) : (
          <p className="hint">Здесь можно изменить пароль для входа в систему.</p>
        )}
        {changed === "1" ? <p className="auth-success">Пароль успешно изменён.</p> : null}
        <dl className="profile-details">
          <div>
            <dt>Имя</dt>
            <dd>{user.name}</dd>
          </div>
          <div>
            <dt>Почта</dt>
            <dd>{account.email}</dd>
          </div>
          <div>
            <dt>Роль</dt>
            <dd>{user.role === "admin" ? "Администратор" : "Сотрудник"}</dd>
          </div>
        </dl>
        <ProfileForm />
        {!account.mustChangePassword ? (
          <Link href="/" className="profile-back-link">
            Вернуться на склад
          </Link>
        ) : null}
      </section>
    </main>
  );
}
