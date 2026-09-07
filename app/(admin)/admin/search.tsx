'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

/**
 * The search box for the admin lists.
 *
 * Submits through the URL rather than fetching, so a search is a real address:
 * it survives a reload, it can be sent to somebody, and the page stays a
 * server component that renders the rows it was asked for.
 */
export function AdminSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = React.useState(params.get('q') ?? '');

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        // Dropping `page` on purpose: page 4 of the old results says nothing
        // about the new ones, and usually does not exist.
        router.push(query ? `${pathname}?q=${encodeURIComponent(query)}` : pathname);
      }}
      className="relative"
    >
      <Search
        aria-hidden
        className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none"
      />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-xl bg-inset text-fg border border-line-strong placeholder:text-subtle outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
      />
    </form>
  );
}
