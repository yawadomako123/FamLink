import { cn } from '@/lib/utils';

/**
 * FamLink mark: a heart whose lower point doubles as a map-pin tip — family
 * and place in one shape.
 *
 * The geometry here is the same union of two lobes and a triangle that
 * `scripts/generate-icons.mjs` rasterises for the PWA icons, so the SVG and
 * the app icon stay identical.
 */
export function Logo({
  className,
  showWordmark = true,
  /**
   * Drops the teal tile and draws the glyph in the current text colour. Use on
   * brand-coloured surfaces, where a teal tile on teal reads as a smudge.
   */
  mono = false,
}: {
  className?: string;
  showWordmark?: boolean;
  mono?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" role="img" aria-label="FamLink">
        {!mono && (
          <>
            <defs>
              <linearGradient id="famlink-mark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1ea58c" />
                <stop offset="100%" stopColor="#12695d" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="9" fill="url(#famlink-mark)" />
          </>
        )}
        {/* Union of a downward triangle and two lobes. */}
        <g
          fill={mono ? 'currentColor' : '#fff'}
          // Without the tile the glyph needs the full canvas to stay legible.
          transform={mono ? 'translate(16 16) scale(1.34) translate(-16 -16)' : undefined}
        >
          <path d="M16 26.4 7.75 13.9h16.5z" />
          <circle cx="12.4" cy="13" r="4.7" />
          <circle cx="19.6" cy="13" r="4.7" />
        </g>
      </svg>
      {showWordmark && (
        <span className="font-semibold text-[17px] tracking-tight text-fg">FamLink</span>
      )}
    </span>
  );
}
