import {
  Home,
  Map as MapIcon,
  Users,
  Bell,
  User,
  MessageCircle,
  MapPin,
  History,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar. Capped at five for thumb reach. */
  primary: boolean;
}

/*
 * Chat is primary and Profile is not.
 *
 * Chat used to be reachable on a phone only through a card on the dashboard,
 * which meant an unread message had nowhere to show a badge and no way to
 * announce itself — you found out by going looking. Profile gives up the slot
 * because it is already one tap away in the header's account menu, and it is
 * not somewhere anyone needs to reach in a hurry.
 */

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: Home, primary: true },
  { href: '/map', label: 'Map', icon: MapIcon, primary: true },
  { href: '/family', label: 'Family', icon: Users, primary: true },
  { href: '/alerts', label: 'Alerts', icon: Bell, primary: true },
  { href: '/chat', label: 'Chat', icon: MessageCircle, primary: true },
  { href: '/profile', label: 'Profile', icon: User, primary: false },
  { href: '/places', label: 'Places', icon: MapPin, primary: false },
  { href: '/history', label: 'My history', icon: History, primary: false },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((i) => i.primary);

/** Longest-prefix match so /family/settings still highlights "Family". */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
