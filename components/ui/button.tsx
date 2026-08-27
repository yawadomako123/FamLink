'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-soft disabled:hover:bg-brand-600',
  secondary:
    'bg-raised text-fg border border-line hover:bg-inset active:bg-inset disabled:hover:bg-raised',
  outline:
    'bg-transparent text-fg border border-line-strong hover:bg-raised disabled:hover:bg-transparent',
  ghost: 'bg-transparent text-muted hover:bg-raised hover:text-fg disabled:hover:bg-transparent',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700 shadow-soft disabled:hover:bg-danger-600',
};

/* Large touch targets: every size clears the 44px minimum on mobile. */
const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-6 text-base gap-2 rounded-xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, fullWidth, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button stays focusable but must not fire twice.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium select-none',
        'transition-colors duration-150',
        'disabled:opacity-55 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
});
