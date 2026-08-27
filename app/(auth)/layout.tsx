import type { ReactNode } from 'react';
import { MapPin, ShieldCheck, MessageCircle } from 'lucide-react';
import { Logo } from '@/components/layout/logo';

/**
 * Split layout: a brand panel that states what FamLink is (and, importantly,
 * what it will not do with your location) beside the form. The panel collapses
 * away below lg so the mobile experience is a plain, fast form.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden lg:flex flex-col justify-between bg-brand-700 text-white p-12">
        <Logo showWordmark={false} mono className="[&_svg]:size-11 text-white" />

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight leading-tight text-balance">
            Know where your family is. Know they&rsquo;re safe.
          </h2>
          <p className="mt-4 text-brand-100 leading-relaxed">
            A private space for the people you actually live your life with — no public
            profiles, no feed, no strangers.
          </p>

          <ul className="mt-10 space-y-5">
            <Feature icon={MapPin} title="One map, everyone on it">
              See your family&rsquo;s current locations at a glance, with an honest &ldquo;last
              seen&rdquo; when a location isn&rsquo;t fresh.
            </Feature>
            <Feature icon={ShieldCheck} title="Sharing is always your choice">
              Location sharing is off until you turn it on, and one tap turns it back off.
              FamLink never tracks you silently.
            </Feature>
            <Feature icon={MessageCircle} title="Stay in touch">
              Family chat, arrival alerts and an emergency SOS that reaches everyone at once.
            </Feature>
          </ul>
        </div>

        <p className="text-xs text-brand-200">
          FamLink alerts your family only. It does not contact emergency services.
        </p>
      </aside>

      <main
        id="main"
        className="flex flex-col justify-center min-h-dvh px-5 py-10 sm:px-10 bg-surface"
      >
        <div className="w-full max-w-sm mx-auto">
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-0.5 size-9 shrink-0 rounded-xl bg-white/12 flex items-center justify-center">
        <Icon aria-hidden className="size-4.5" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-brand-100/90 mt-0.5 leading-relaxed">{children}</p>
      </div>
    </li>
  );
}
