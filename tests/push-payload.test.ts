import { describe, expect, it } from 'vitest';
import { buildPushMessage } from '@/lib/firebase/message';
import { isDeadTokenError } from '@/lib/firebase/server';

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

/**
 * Deciding that a token is finished.
 *
 * The asymmetry is the whole design: a token kept by mistake costs a wasted
 * FCM call, and a token deleted by mistake costs somebody their alerts —
 * including, on this product, an SOS. So this errs towards keeping, and only
 * the two codes that unambiguously describe the token itself count.
 */
describe('dead push tokens', () => {
  it('retires a token FCM says is no longer registered', () => {
    // What an uninstall or cleared site data produces.
    expect(isDeadTokenError({ code: 'messaging/registration-token-not-registered' })).toBe(true);
  });

  it('retires a token FCM rejects as invalid', () => {
    expect(isDeadTokenError({ code: 'messaging/invalid-registration-token' })).toBe(true);
  });

  it('keeps the token when the argument was the problem', () => {
    /*
     * The important negative. FCM uses invalid-argument for a malformed
     * *payload* as well as a malformed token, so treating it as a dead token
     * would let one bad payload silently unsubscribe every device it reached.
     */
    expect(isDeadTokenError({ code: 'messaging/invalid-argument' })).toBe(false);
  });

  it('keeps the token through a transient failure', () => {
    expect(isDeadTokenError({ code: 'messaging/server-unavailable' })).toBe(false);
    expect(isDeadTokenError({ code: 'messaging/internal-error' })).toBe(false);
    expect(isDeadTokenError({ code: 'messaging/quota-exceeded' })).toBe(false);
  });

  it('keeps the token for anything that is not a recognisable FCM error', () => {
    expect(isDeadTokenError(new Error('socket hang up'))).toBe(false);
    expect(isDeadTokenError(null)).toBe(false);
    expect(isDeadTokenError(undefined)).toBe(false);
    expect(isDeadTokenError('messaging/registration-token-not-registered')).toBe(false);
    expect(isDeadTokenError({ code: 42 })).toBe(false);
  });
});
