import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';

/**
 * Placeholder for a destination that navigation already points at but whose
 * feature lands in a later phase.
 *
 * It names the phase rather than saying "coming soon", so the state is
 * informative instead of evasive — and so it is obvious when one has been left
 * behind after its phase shipped.
 */
export function PhasePlaceholder({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="px-4 md:px-6 py-6 max-w-3xl">
      <Card>
        <EmptyState icon={icon} title={title} description={description} className="py-14" />
      </Card>
    </div>
  );
}
