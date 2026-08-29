'use client';

import * as React from 'react';
import { MessageCircle, MoreVertical, SendHorizontal, SmilePlus, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { useRealtime } from '@/hooks/useRealtime';
import { api, errorMessage } from '@/lib/api/client';
import { formatClock, formatDayLabel } from '@/lib/time';
import { avatarColor, cn } from '@/lib/utils';
import { TypingIndicator, VoiceNote, VoiceRecorder } from './voice';

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

/** Mirrors ALLOWED_REACTIONS on the server; the API rejects anything else. */
const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'] as const;

/** How long a typing indicator survives without a fresh hint. */
const TYPING_TTL_MS = 6000;

/** The floor between outgoing typing hints, whatever the typing speed. */
const TYPING_PING_MS = 3000;



export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderImage: string | null;
  content: string;
  /** Present on a voice note. */
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  deleted: boolean;
  createdAt: string;
  reactions?: MessageReactionSummary[];
  /** Set on messages shown before the server has confirmed them. */
  pending?: boolean;
  failed?: boolean;
}

/**
 * Family chat.
 *
 * Messages are sent optimistically — a chat that waits for a round trip before
 * showing your own words feels broken — but an unconfirmed message is visibly
 * marked, and a failed one offers a retry rather than vanishing.
 */
export function ChatView({
  familyId,
  viewerId,
  canModerate,
  voiceNotesEnabled,
  initialMessages,
}: {
  familyId: string;
  viewerId: string;
  canModerate: boolean;
  /** False when blob storage is not configured for this deployment. */
  voiceNotesEnabled: boolean;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Who is composing right now, by user id, with the moment last heard from. */
  const [typing, setTyping] = React.useState<Record<string, { name: string; at: number }>>({});

  const bottomRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const latestAtRef = React.useRef<string | null>(
    initialMessages[initialMessages.length - 1]?.createdAt ?? null,
  );

  /* ------------------------------------------------------------ realtime -- */

  const appendNew = React.useCallback(async () => {
    try {
      const since = latestAtRef.current;
      const query = since ? `?since=${encodeURIComponent(since)}` : '';

      const result = await api.get<{ messages: ChatMessage[] }>(
        `/api/v1/families/${familyId}/messages${query}`,
      );

      if (result.messages.length === 0) return;

      setMessages((current) => {
        const seen = new Set(current.map((m) => m.id));
        const additions = result.messages.filter((m) => !seen.has(m.id));
        if (additions.length === 0) return current;

        const next = [...current, ...additions];
        latestAtRef.current = next[next.length - 1]?.createdAt ?? since;
        return next;
      });
    } catch {
      // A missed append is not worth surfacing; the next hint or reload fixes it.
    }
  }, [familyId]);

  const onEvent = React.useCallback(
    (type: string, event?: { actorId?: string; actorName?: string }) => {
      if (type === 'message') {
        void appendNew();

        // Their message arrived, so they have stopped composing.
        const sender = event?.actorId;
        if (sender) {
          setTyping((current) => {
            const { [sender]: _gone, ...rest } = current;
            return rest;
          });
        }
        return;
      }

      if (type === 'typing' && event?.actorId && event.actorId !== viewerId) {
        const { actorId, actorName } = event;
        setTyping((current) => ({
          ...current,
          [actorId]: { name: actorName ?? 'Someone', at: Date.now() },
        }));
      }
    },
    [appendNew, viewerId],
  );

  const { status } = useRealtime({ familyId, onEvent });

  /*
   * Indicators expire on their own. There is no "stopped typing" event and
   * there should not be: somebody who closes the tab mid-sentence would never
   * send one, and their name would sit there for the rest of the day.
   */
  React.useEffect(() => {
    if (Object.keys(typing).length === 0) return;

    const timer = setInterval(() => {
      const cutoff = Date.now() - TYPING_TTL_MS;
      setTyping((current) => {
        const next = Object.fromEntries(
          Object.entries(current).filter(([, v]) => v.at > cutoff),
        );
        // Same object when nothing expired, so this does not re-render forever.
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [typing]);

  /*
   * Announcing is throttled hard. It is a courtesy, not data: one hint every
   * few seconds says everything a dozen a second would, and the endpoint does
   * a single NOTIFY per call.
   */
  const lastAnnounced = React.useRef(0);
  const announceTyping = React.useCallback(() => {
    const now = Date.now();
    if (now - lastAnnounced.current < TYPING_PING_MS) return;
    lastAnnounced.current = now;
    void api.post(`/api/v1/families/${familyId}/typing`).catch(() => {
      // A dropped hint costs a missing indicator for a second. Not worth surfacing.
    });
  }, [familyId]);

  /* Poll as a fallback whenever the stream is not carrying updates. */
  React.useEffect(() => {
    if (status === 'live') return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void appendNew();
    }, 15_000);

    return () => clearInterval(timer);
  }, [status, appendNew]);

  /* Mark read on arrival and whenever new messages land while visible. */
  React.useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      void api.post(`/api/v1/families/${familyId}/messages/read`).catch(() => {
        // Read state is a convenience; failing to record it is not an error
        // worth interrupting the conversation for.
      });
    };

    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [familyId, messages.length]);

  /* Keep the newest message in view. */
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  /* -------------------------------------------------------------- send -- */

  const send = React.useCallback(
    async (content: string, replacingId?: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const tempId = replacingId ?? `pending-${crypto.randomUUID()}`;

      setMessages((current) => {
        const optimistic: ChatMessage = {
          id: tempId,
          senderId: viewerId,
          senderName: 'You',
          senderImage: null,
          content: trimmed,
          deleted: false,
          createdAt: new Date().toISOString(),
          pending: true,
        };

        return replacingId
          ? current.map((m) => (m.id === replacingId ? optimistic : m))
          : [...current, optimistic];
      });

      setSending(true);
      setError(null);

      try {
        const result = await api.post<{ message: ChatMessage }>(
          `/api/v1/families/${familyId}/messages`,
          { content: trimmed },
        );

        setMessages((current) =>
          current.map((m) => (m.id === tempId ? { ...result.message, pending: false } : m)),
        );
        latestAtRef.current = result.message.createdAt;
      } catch (err) {
        // Mark it failed in place rather than dropping it — losing what
        // somebody typed is worse than showing that it did not send.
        setMessages((current) =>
          current.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
        );
        setError(errorMessage(err));
      } finally {
        setSending(false);
      }
    },
    [familyId, viewerId],
  );

  const react = React.useCallback(
    async (messageId: string, emoji: string) => {
      /*
       * Applied locally first so the tap feels instant, then reconciled from
       * the server's own count on the next refresh.
       */
      setMessages((current) =>
        current.map((m) => {
          if (m.id !== messageId) return m;

          const existing = m.reactions ?? [];
          const mine = existing.find((r) => r.userIds.includes(viewerId));
          const removing = mine?.emoji === emoji;

          const withoutMine = existing
            .map((r) => ({ ...r, userIds: r.userIds.filter((id) => id !== viewerId) }))
            .map((r) => ({ ...r, count: r.userIds.length }))
            .filter((r) => r.count > 0);

          if (removing) return { ...m, reactions: withoutMine };

          const target = withoutMine.find((r) => r.emoji === emoji);
          if (target) {
            target.userIds = [...target.userIds, viewerId];
            target.count += 1;
            return { ...m, reactions: [...withoutMine] };
          }

          return {
            ...m,
            reactions: [...withoutMine, { emoji, count: 1, userIds: [viewerId] }],
          };
        }),
      );

      try {
        await api.post(`/api/v1/families/${familyId}/messages/${messageId}/reactions`, {
          emoji,
        });
      } catch (err) {
        setError(errorMessage(err));
        void appendNew();
      }
    },
    [familyId, viewerId, appendNew],
  );

  async function remove(messageId: string) {
    setError(null);
    try {
      await api.delete(`/api/v1/families/${familyId}/messages/${messageId}`);
      setMessages((current) =>
        current.map((m) => (m.id === messageId ? { ...m, deleted: true, content: '' } : m)),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const grouped = React.useMemo(() => groupByDay(messages), [messages]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {error && (
        <div className="px-4 pt-3">
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="ghost" onClick={() => setError(null)}>
                Dismiss
              </Button>
            }
          >
            {error}
          </Alert>
        </div>
      )}

      {status === 'polling' && (
        <p className="text-center text-xs text-muted py-1.5 bg-raised border-b border-line">
          Live updates unavailable — refreshing periodically.
        </p>
      )}
      {status === 'offline' && (
        <p className="text-center text-xs text-on-tint-warn py-1.5 bg-tint-warn border-b border-line-warn">
          You&rsquo;re offline. New messages will appear when you reconnect.
        </p>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No messages yet"
            description="Say hello — everyone in the family will see it."
            className="py-16"
          />
        ) : (
          grouped.map(([day, dayMessages]) => (
            <section key={day} aria-label={day}>
              <div className="flex items-center gap-3 my-4">
                <span className="flex-1 h-px bg-line" />
                {/*
                  Formatted in the viewer's timezone, so the server's render
                  legitimately differs from the client's. This is the case
                  suppressHydrationWarning exists for.
                */}
                <span suppressHydrationWarning className="text-xs font-medium text-subtle">
                  {day}
                </span>
                <span className="flex-1 h-px bg-line" />
              </div>

              <ul className="space-y-1">
                {dayMessages.map((message, index) => {
                  const previous = dayMessages[index - 1];
                  // Collapse the avatar and name for consecutive messages from
                  // the same person, the way every chat people already use does.
                  const grouped =
                    previous?.senderId === message.senderId &&
                    new Date(message.createdAt).getTime() -
                      new Date(previous.createdAt).getTime() <
                      5 * 60 * 1000;

                  return (
                    <MessageRow
                      key={message.id}
                      message={message}
                      isOwn={message.senderId === viewerId}
                      grouped={grouped}
                      canDelete={message.senderId === viewerId || canModerate}
                      viewerId={viewerId}
                      onRetry={() => void send(message.content, message.id)}
                      onDelete={() => void remove(message.id)}
                      onReact={(emoji) => void react(message.id, emoji)}
                    />
                  );
                })}
              </ul>
            </section>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <TypingIndicator typing={typing} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const content = draft;
          setDraft('');
          void send(content);
        }}
        className="shrink-0 border-t border-line bg-card px-3 py-3 pb-safe"
      >
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Message your family
          </label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) announceTyping();
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const content = draft;
                setDraft('');
                void send(content);
              }
            }}
            placeholder="Message your family…"
            rows={1}
            maxLength={2000}
            className="flex-1 resize-none max-h-32 px-3.5 py-2.5 rounded-xl bg-inset text-fg border border-line-strong placeholder:text-subtle outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
          />

          {/*
            The recorder replaces the send button only while there is nothing
            typed. A half-written message plus a recording is two messages, and
            deciding which one "send" means is a choice nobody should have to
            make mid-sentence.
          */}
          {draft.trim() ? (
            <Button
              type="submit"
              aria-label="Send message"
              disabled={sending}
              className="size-11 rounded-xl p-0 shrink-0"
            >
              <SendHorizontal aria-hidden className="size-5" />
            </Button>
          ) : (
            <VoiceRecorder
              familyId={familyId}
              enabled={voiceNotesEnabled}
              disabled={sending}
              onSent={() => void appendNew()}
              onError={setError}
            />
          )}
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MessageRow({
  message,
  isOwn,
  grouped,
  canDelete,
  viewerId,
  onRetry,
  onDelete,
  onReact,
}: {
  message: ChatMessage;
  isOwn: boolean;
  grouped: boolean;
  canDelete: boolean;
  viewerId: string;
  onRetry: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  if (message.deleted) {
    return (
      <li className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
        <p className="text-xs text-subtle italic px-3 py-1.5">Message deleted</p>
      </li>
    );
  }

  return (
    <li className={cn('flex gap-2 group', isOwn ? 'justify-end' : 'justify-start')}>
      {!isOwn && (
        <div className="w-8 shrink-0">
          {!grouped && (
            <Avatar
              name={message.senderName}
              userId={message.senderId}
              image={message.senderImage}
              size="sm"
            />
          )}
        </div>
      )}

      <div className={cn('max-w-[75%] min-w-0', isOwn && 'flex flex-col items-end')}>
        {!isOwn && !grouped && (
          <p
            className="text-xs font-medium mb-0.5"
            style={{ color: avatarColor(message.senderId) }}
          >
            {message.senderName}
          </p>
        )}

        <div className="flex items-end gap-1.5">
          {/* Actions for own messages (appear on the left) */}
          {isOwn && (
            <div className={cn("flex items-center gap-1", message.pending && "invisible")}>
              <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Add a reaction"
                  aria-expanded={pickerOpen}
                  className="size-7 rounded-lg flex items-center justify-center text-subtle hover:text-fg"
                >
                  <SmilePlus aria-hidden className="size-3.5" />
                </button>

                {pickerOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-full mb-1 left-0 flex gap-0.5 p-1 bg-card border border-line rounded-xl shadow-lift z-20"
                  >
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        aria-label={`React with ${emoji}`}
                        onClick={() => {
                          setPickerOpen(false);
                          onReact(emoji);
                        }}
                        className="size-8 rounded-lg text-base leading-none hover:bg-raised transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {canDelete && (
                <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="Message options"
                    className="size-7 rounded-lg flex items-center justify-center text-subtle hover:text-fg"
                  >
                    <MoreVertical aria-hidden className="size-3.5" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 bottom-full mb-1 w-40 bg-card border border-line rounded-xl shadow-lift p-1 z-10">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete();
                        }}
                        className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-sm text-danger-600 hover:bg-tint-danger"
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              'px-3.5 py-2 rounded-2xl text-sm leading-relaxed break-words',
              // A voice note lays out its own controls; only text needs the
              // newline handling.
              !message.audioUrl && 'whitespace-pre-wrap',
              isOwn
                ? 'bg-brand-600 text-white rounded-br-md'
                : 'bg-card border border-line text-fg rounded-bl-md',
              message.pending && 'opacity-60',
              message.failed && 'ring-1 ring-danger-500',
            )}
          >
            {message.audioUrl ? (
              <VoiceNote
                url={message.audioUrl}
                durationMs={message.audioDurationMs ?? null}
                mine={isOwn}
              />
            ) : (
              message.content
            )}
          </div>

          {/* Actions for received messages (appear on the right) */}
          {!isOwn && (
            <div className={cn("flex items-center gap-1", message.pending && "invisible")}>
              <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Add a reaction"
                  aria-expanded={pickerOpen}
                  className="size-7 rounded-lg flex items-center justify-center text-subtle hover:text-fg"
                >
                  <SmilePlus aria-hidden className="size-3.5" />
                </button>

                {pickerOpen && (
                  <div
                    role="menu"
                    className="absolute bottom-full mb-1 right-0 flex gap-0.5 p-1 bg-card border border-line rounded-xl shadow-lift z-20"
                  >
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        role="menuitem"
                        aria-label={`React with ${emoji}`}
                        onClick={() => {
                          setPickerOpen(false);
                          onReact(emoji);
                        }}
                        className="size-8 rounded-lg text-base leading-none hover:bg-raised transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {message.reactions && message.reactions.length > 0 && (
          <div className={cn('flex flex-wrap gap-1 mt-1', isOwn && 'justify-end')}>
            {message.reactions.map((reaction) => {
              const mine = reaction.userIds.includes(viewerId);

              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  onClick={() => onReact(reaction.emoji)}
                  aria-pressed={mine}
                  aria-label={`${reaction.emoji}, ${reaction.count}${mine ? ', including you' : ''}`}
                  className={cn(
                    'inline-flex items-center gap-1 h-6 px-1.5 rounded-full border text-xs transition-colors tabular-nums',
                    mine
                      ? 'border-brand-500 bg-tint-brand text-on-tint-brand'
                      : 'border-line bg-card text-muted hover:bg-raised',
                  )}
                >
                  <span aria-hidden>{reaction.emoji}</span>
                  {reaction.count > 1 && reaction.count}
                </button>
              );
            })}
          </div>
        )}

        <p
          suppressHydrationWarning
          className={cn(
            'text-[11px] text-subtle mt-0.5 tabular-nums',
            isOwn ? 'text-right' : 'text-left',
          )}
        >
          {message.failed ? (
            <button type="button" onClick={onRetry} className="text-danger-600 hover:underline">
              Not sent — tap to retry
            </button>
          ) : message.pending ? (
            'Sending…'
          ) : (
            formatClock(message.createdAt)
          )}
        </p>
      </div>
    </li>
  );
}

/** Groups messages under Today / Yesterday / a date. */
function groupByDay(messages: ChatMessage[]): [string, ChatMessage[]][] {
  const groups = new Map<string, ChatMessage[]>();

  for (const message of messages) {
    const label = formatDayLabel(message.createdAt);
    const bucket = groups.get(label);
    if (bucket) bucket.push(message);
    else groups.set(label, [message]);
  }

  return [...groups.entries()];
}
