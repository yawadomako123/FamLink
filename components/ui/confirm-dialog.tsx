'use client';

import * as React from 'react';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirmation for destructive or irreversible actions, built on the native
 * <dialog> element so focus trapping, Escape and the top layer come for free.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] max-w-sm p-0 bg-transparent',
        'backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
      )}
    >
      <div className="bg-card border border-line rounded-2xl shadow-lift p-5 text-left">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <div className="mt-1.5 text-sm text-muted leading-relaxed">{description}</div>}
        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
