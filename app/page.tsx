import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

/**
 * FamLink has no marketing surface — it is a private app. The root simply
 * routes you to where you belong.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? '/dashboard' : '/login');
}
