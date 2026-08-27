import 'server-only';

/**
 * Outbound email.
 *
 * FamLink only sends transactional mail (password resets). Rather than pretend
 * a provider is configured, this module has two honest transports:
 *
 *  - Resend, when RESEND_API_KEY is set.
 *  - A console transport in development, which prints the message (including
 *    the reset link) to the server log so the flow is testable locally.
 *
 * In production with no provider configured, sending throws rather than
 * silently dropping the mail and leaving the user waiting for a link that will
 * never arrive.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

const FROM = process.env.EMAIL_FROM ?? 'FamLink <onboarding@resend.dev>';

export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No email provider configured. Set RESEND_API_KEY so password reset emails can be delivered.',
      );
    }

    // Development transport. Never used in production — see the guard above.
    console.warn(
      [
        '',
        '─── FamLink dev email ──────────────────────────────────────────',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });

  if (!res.ok) {
    // Never log the body — it echoes the recipient address and link.
    throw new Error(`Email delivery failed with status ${res.status}`);
  }
}
