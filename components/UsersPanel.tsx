"use client";

import { useState } from "react";
import { addEmployeeAction, removeEmployeeAction, saveUserAction } from "@/app/actions";
import { PageHint } from "@/components/PageHint";
import type { AppUser } from "@/lib/types";
import { useSessionDraft } from "@/lib/ui-session";

async function run(action: (data: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, data: FormData) {
  const result = await action(data);
  if (!result.ok) window.alert(result.error);
}

type AccountSummary = {
  userId: string;
  email: string;
  configured: boolean;
  mustChangePassword: boolean;
};

type AddEmployeeDraft = { name: string; email: string };
const EMPTY_ADD_EMPLOYEE: AddEmployeeDraft = { name: "", email: "" };

export function UsersPanel({ users, accounts }: { users: AppUser[]; accounts: AccountSummary[] }) {
  const accountByUserId = new Map(accounts.map((account) => [account.userId, account]));
  const [add, setAdd] = useSessionDraft<AddEmployeeDraft>("users.add", EMPTY_ADD_EMPLOYEE);
  const [password, setPassword] = useState("");

  return (
    <div className="page-flow" style={{ padding: 16, maxWidth: 980 }}>
      <PageHint>
        <p className="hint">
          Каждый сотрудник входит по своей почте и паролю. Сотрудник не может править склад, удалять строки, скрывать
          товары и отменять чужие действия. Передайте временный пароль лично: при первом входе сотрудник обязательно
          заменит его своим.
        </p>
      </PageHint>
      <table className="sheet-table mobile-cards" style={{ width: "100%" }}>
        <thead>
          <tr className="headers">
            <th>Имя</th>
            <th>Почта для входа</th>
            <th>Новый пароль</th>
            <th>Роль</th>
            <th>Вход</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const account = accountByUserId.get(user.id);
            const formId = `user-${user.id}`;
            return (
              <tr key={user.id}>
                <td data-label="Имя">
                  <input form={formId} name="name" defaultValue={user.name} required />
                </td>
                <td data-label="Почта для входа">
                  <input
                    form={formId}
                    name="email"
                    type="email"
                    defaultValue={account?.email ?? ""}
                    placeholder="name@example.com"
                    required
                  />
                </td>
                <td data-label="Новый пароль">
                  <input
                    form={formId}
                    name="password"
                    type="password"
                    minLength={10}
                    maxLength={256}
                    autoComplete="new-password"
                    placeholder={account ? "не менять" : "минимум 10 символов"}
                  />
                </td>
                <td data-label="Роль">{user.role === "admin" ? "Администратор" : "Сотрудник"}</td>
                <td data-label="Вход">
                  {account?.configured
                    ? account.mustChangePassword
                      ? "Ожидает смены пароля"
                      : "Настроен"
                    : "Не настроен"}
                </td>
                <td data-label="Действия">
                  <div className="qty-form">
                    <form id={formId} action={(data) => run(saveUserAction, data)}>
                      <input type="hidden" name="id" value={user.id} />
                      <button type="submit">Сохранить</button>
                    </form>
                    {user.role === "employee" ? (
                      <form
                        action={(data) => {
                          if (window.confirm(`Удалить «${user.name}»?`)) return run(removeEmployeeAction, data);
                        }}
                      >
                        <input type="hidden" name="id" value={user.id} />
                        <button type="submit">Удалить</button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form
        className="add-row employee-add-row"
        action={async (data) => {
          const result = await addEmployeeAction(data);
          if (!result.ok) {
            window.alert(result.error);
            return;
          }
          setAdd(EMPTY_ADD_EMPLOYEE);
          setPassword("");
        }}
      >
        <input
          name="name"
          placeholder="Имя сотрудника"
          required
          value={add.name}
          onChange={(event) => setAdd((current) => ({ ...current, name: event.target.value }))}
        />
        <input
          name="email"
          type="email"
          placeholder="Почта"
          required
          value={add.email}
          onChange={(event) => setAdd((current) => ({ ...current, email: event.target.value }))}
        />
        <input
          name="password"
          type="password"
          minLength={10}
          maxLength={256}
          autoComplete="new-password"
          placeholder="Временный пароль"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit">Добавить</button>
      </form>
    </div>
  );
}
