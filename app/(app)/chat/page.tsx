import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { ChatView } from '@/components/chat/chat-view';
import { StartCallButtons } from '@/components/calls/call-manager';
import { requireSession } from '@/lib/auth/session';
import { isAvatarUploadEnabled } from '@/lib/env';
import { resolveShellData } from '@/lib/families/shell';
import { getReactions, listMessages } from '@/lib/chat/service';
import { getMembership } from '@/lib/permissions/family';

export const metadata: Metadata = { title: 'Chat' };

export default async function ChatPage() {
  const session = await requireSession('/chat');
  const { family: current, families, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  if (!current) {
    return (
      <AppShell user={session.user} title="Chat">
        <div className="px-4 md:px-6 py-6 max-w-2xl">
          <Card>
            <EmptyState
              icon={MessageCircle}
              title="Chat needs a family"
              description="Create or join a family and you'll get one shared conversation."
              action={
                <Link href="/family">
                  <Button>Set up a family</Button>
                </Link>
              }
            />
          </Card>
        </div>
      </AppShell>
    );
  }

  const [recent, membership] = await Promise.all([
    listMessages(session.user.id, current.id, { limit: 50 }),
    getMembership(session.user.id, current.id),
  ]);

  const reactions = await getReactions(
    session.user.id,
    current.id,
    recent.map((m) => m.id),
  );

  const canModerate = membership?.role === 'owner' || membership?.role === 'admin';

  return (
    <AppShell
      user={session.user}
      familyName={current.name}
      family={current ?? undefined}
      families={families}
      alertCount={alertCount}
      unreadMessages={unreadMessages}
      title="Chat"
      headerRight={<StartCallButtons familyId={current.id} compact />}
      fullBleed
    >
      <ChatView
        familyId={current.id}
        viewerId={session.user.id}
        canModerate={canModerate}
        // Same gate as avatar uploads: without blob storage the recorder has
        // nowhere to put the audio, so the control is hidden rather than
        // offered and then refused.
        voiceNotesEnabled={isAvatarUploadEnabled()}
        // The service returns newest-first for paging; the thread reads
        // oldest-first, so reverse once here rather than in the component.
        initialMessages={[...recent].reverse().map((m) => ({
          id: m.id,
          senderId: m.senderId,
          senderName: m.senderName,
          senderImage: m.senderImage,
          content: m.content,
          audioUrl: m.audioUrl,
          audioDurationMs: m.audioDurationMs,
          deleted: m.deleted,
          createdAt: m.createdAt.toISOString(),
          reactions: reactions.get(m.id) ?? [],
        }))}
      />
    </AppShell>
  );
}
