import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import { SettingsView } from '@/components/settings/settings-view';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';
import { DEFAULT_PREFERENCES, getPreferences } from '@/lib/notifications/preferences';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await requireSession('/settings');
  const { family: current, families, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  // Preferences are per family; without one there is nothing to configure yet.
  const preferences = current
    ? await getPreferences(session.user.id, current.id)
    : DEFAULT_PREFERENCES;

  return (
    <AppShell
      user={session.user}
      familyName={current?.name}
      title="Settings"
      family={current ?? undefined}
      families={families}
      alertCount={alertCount}
      unreadMessages={unreadMessages}
    >
      <SettingsView
        familyId={current?.id ?? null}
        familyName={current?.name ?? null}
        initialPreferences={preferences}
      />
    </AppShell>
  );
}
