import type { Metadata } from 'next';
import { Home } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { listFamilies } from '@/lib/admin/service';
import { timeAgo } from '@/lib/time';
import { AdminSearch } from '../search';

export const metadata: Metadata = { title: 'Families' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminFamiliesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const { rows, total } = await listFamilies({
    search,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Families</h1>
        <p className="text-sm text-muted mt-1">
          {total.toLocaleString()} famil{total === 1 ? 'y' : 'ies'}
          {search ? ` matching “${search}”` : ''} · counts only, no contents
        </p>
      </div>

      <AdminSearch placeholder="Search family names" />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Home}
            title="No families"
            description={search ? 'No family matches that search.' : 'No families yet.'}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((family) => (
              <li key={family.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">{family.name}</p>
                  <p className="text-xs text-muted truncate">
                    {family.ownerName ? `Owned by ${family.ownerName}` : 'No owner'} · created{' '}
                    {timeAgo(family.createdAt)}
                  </p>
                </div>

                <dl className="flex items-center gap-4 sm:gap-5 shrink-0 text-xs text-muted tabular-nums">
                  <div className="text-right">
                    <dt className="text-[11px] text-subtle">Members</dt>
                    <dd>{family.members}</dd>
                  </div>
                  <div className="text-right hidden sm:block">
                    <dt className="text-[11px] text-subtle">Messages</dt>
                    <dd>{family.messages.toLocaleString()}</dd>
                  </div>
                  <div className="text-right hidden sm:block">
                    <dt className="text-[11px] text-subtle">Places</dt>
                    <dd>{family.places}</dd>
                  </div>
                  <div className="text-right w-24">
                    <dt className="text-[11px] text-subtle">Last active</dt>
                    <dd className="truncate">
                      {family.lastMessageAt ? timeAgo(family.lastMessageAt) : 'never'}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <a
            href={page > 1 ? `/admin/families?page=${page - 1}` : undefined}
            className={page > 1 ? 'text-brand-600 hover:underline' : 'text-subtle'}
          >
            Previous
          </a>
          <span className="text-muted tabular-nums">
            Page {page} of {pages}
          </span>
          <a
            href={page < pages ? `/admin/families?page=${page + 1}` : undefined}
            className={page < pages ? 'text-brand-600 hover:underline' : 'text-subtle'}
          >
            Next
          </a>
        </div>
      )}
    </div>
  );
}
