'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full h-11 px-3.5 rounded-xl bg-card text-fg',
        'border border-line-strong placeholder:text-subtle',
        'transition-colors outline-none',
        'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        invalid && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/25',
        className,
      )}
      {...props}
    />
  );
});

export interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}

/** Label + control + error, wired up for screen readers. */
export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger-600 font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-3.5 py-2.5 rounded-xl bg-card text-fg resize-none',
        'border border-line-strong placeholder:text-subtle',
        'transition-colors outline-none',
        'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25',
        className,
      )}
      {...props}
    />
  );
});
