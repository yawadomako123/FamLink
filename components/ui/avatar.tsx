import * as React from 'react';
import { avatarColor, cn, initials } from '@/lib/utils';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<Size, string> = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-20 text-2xl',
};

export interface AvatarProps {
  name: string;
  /** Stable id so the generated colour follows the person, not their name. */
  userId?: string;
  image?: string | null;
  size?: Size;
  className?: string;
}

/**
 * Avatar with a deterministic initials fallback. Uploads are optional in
 * FamLink, so the fallback is the common case rather than an error state.
 */
export function Avatar({ name, userId, image, size = 'md', className }: AvatarProps) {
  const base = cn(
    'relative shrink-0 rounded-full overflow-hidden font-semibold',
    'flex items-center justify-center select-none',
    SIZES[size],
    className,
  );

  if (image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- avatars come from
         user-supplied blob URLs of unknown dimensions; next/image adds no value. */
      <img src={image} alt="" aria-hidden className={cn(base, 'object-cover bg-inset')} />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(base, 'text-white')}
      style={{ backgroundColor: avatarColor(userId ?? name) }}
    >
      {initials(name)}
    </span>
  );
}
