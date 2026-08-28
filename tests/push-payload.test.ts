import { describe, expect, it } from 'vitest';
import { buildPushMessage } from '@/lib/firebase/message';

/**
 * The shape of an outgoing push.
 *
 * These exist because of a bug that was invisible from the server: every push
 * arrived on the phone twice. The database was right — one notification row,
 * one token, one send — but a message carrying a `notification` block is
 * displayed by the Firebase service worker automatically *and* handed to
 * `onBackgroundMessage`, which drew a second one.
 *
 * Nothing about that is observable from a service-level test, so the payload
 * shape is asserted directly.
 */
describe('push payload', () => {
  const base = { token: 'tok-1', title: 'Nana', body: 'Heyaaa' };

  it('carries no notification block, so only the worker displays it', () => {
    const message = buildPushMessage(base);

    expect(
      'notification' in message,
      'a notification block makes the SDK draw a second notification',
    ).toBe(false);
  });

  it('moves title and body into data, where the worker reads them', () => {
    const message = buildPushMessage(base);

    expect(message.data).toMatchObject({ title: 'Nana', body: 'Heyaaa' });
  });

  it('keeps the caller data alongside them', () => {
    const message = buildPushMessage({
      ...base,
      data: { familyId: 'fam-1', messageId: '42' },
    });

    expect(message.data).toMatchObject({
      familyId: 'fam-1',
      messageId: '42',
      title: 'Nana',
      body: 'Heyaaa',
    });
  });

  it('passes the tag through so a busy thread collapses to one entry', () => {
    const message = buildPushMessage({ ...base, tag: 'chat:fam-1' });

    expect(message.data?.tag).toBe('chat:fam-1');
    expect(message.android?.collapseKey).toBe('chat:fam-1');
  });

  it('omits the tag entirely when there is none to group by', () => {
    const message = buildPushMessage(base);

    expect(message.data?.tag).toBeUndefined();
    expect(message.android).toBeUndefined();
  });

  it('sends at high urgency, so a family alert is not batched', () => {
    const message = buildPushMessage(base);

    expect(message.webpush?.headers?.Urgency).toBe('high');
  });

  it('keeps every data value a string, as FCM requires', () => {
    const message = buildPushMessage({
      ...base,
      data: { familyId: 'fam-1', messageId: '42' },
      tag: 'chat:fam-1',
    });

    for (const [key, value] of Object.entries(message.data ?? {})) {
      expect(typeof value, `${key} must be a string`).toBe('string');
    }
  });
});
