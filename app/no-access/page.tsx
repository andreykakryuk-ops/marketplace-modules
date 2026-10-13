import Link from 'next/link';
import {getSessionUser} from '@/lib/session';
export default async function NoAccessPage(){await getSessionUser();return <main style={{padding:24}}><h1>Нет доступа к разделу</h1><p>Администратор может выдать доступ в разделе «Сотрудники».</p><Link href="/profile">Мой профиль</Link></main>;}
