import type { Metadata } from 'next';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/feedback';
import { Users2 } from 'lucide-react';
import { listUsers } from '@/lib/admin/service';
import { getPlatformAdmin } from '@/lib/admin/guard';
import { timeAgo } from '@/lib/time';
import { AdminSearch } from '../search';
import { UserActions } from './user-actions';

export const metadata: Metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const [{ rows, total }, viewer] = await Promise.all([
    listUsers({ search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getPlatformAdmin(),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <p className="text-sm text-muted mt-1">
          {total.toLocaleString()} account{total === 1 ? '' : 's'}
          {search ? ` matching “${search}”` : ''}
        </p>
      </div>

      <AdminSearch placeholder="Search by name or email" />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Users2}
            title="Nobody here"
            description={search ? 'No account matches that search.' : 'No accounts yet.'}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((user) => (
              <li key={user.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                <Avatar name={user.name} userId={user.id} image={user.image} size="sm" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{user.name}</p>
                    {user.isPlatformAdmin && (
                      <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-tint-brand text-on-tint-brand">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted truncate">{user.email}</p>
                </div>

                <dl className="hidden sm:flex items-center gap-5 shrink-0 text-xs text-muted tabular-nums">
                  <div className="text-right">
                    <dt className="text-[11px] text-subtle">Families</dt>
                    <dd>{user.families}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[11px] text-subtle">Sessions</dt>
                    <dd>{user.activeSessions}</dd>
                  </div>
                  <div className="text-right w-20">
                    <dt className="text-[11px] text-subtle">Joined</dt>
                    <dd className="truncate">{timeAgo(user.createdAt)}</dd>
                  </div>
                  <div className="text-right w-16">
                    <dt className="text-[11px] text-subtle">Sign-in</dt>
                    <dd className="truncate">
                      {user.providers.includes('google') ? 'Google' : 'Password'}
                    </dd>
                  </div>
                </dl>

                <UserActions
                  userId={user.id}
                  name={user.name}
                  isPlatformAdmin={user.isPlatformAdmin}
                  activeSessions={user.activeSessions}
                  isSelf={user.id === viewer?.id}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pages > 1 && <Pager page={page} pages={pages} search={search} />}
    </div>
  );
}

function Pager({ page, pages, search }: { page: number; pages: number; search?: string }) {
  const href = (p: number) =>
    `/admin/users?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(p) })}`;

  return (
    <div className="flex items-center justify-between text-sm">
      <a
        href={page > 1 ? href(page - 1) : undefined}
        aria-disabled={page <= 1}
        className={page > 1 ? 'text-brand-600 hover:underline' : 'text-subtle cursor-default'}
      >
        Previous
      </a>
      <span className="text-muted tabular-nums">
        Page {page} of {pages}
      </span>
      <a
        href={page < pages ? href(page + 1) : undefined}
        aria-disabled={page >= pages}
        className={page < pages ? 'text-brand-600 hover:underline' : 'text-subtle cursor-default'}
      >
        Next
      </a>
    </div>
  );
}
