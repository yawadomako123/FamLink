'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Required: every switch in FamLink toggles something consequential. */
  label: string;
  describedBy?: string;
  tone?: 'brand' | 'danger';
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  describedBy,
  tone = 'brand',
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full',
        'transition-colors duration-200 outline-none',
        'disabled:opacity-55 disabled:cursor-not-allowed',
        checked ? (tone === 'danger' ? 'bg-danger-600' : 'bg-brand-600') : 'bg-line-strong',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-out-soft',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}
