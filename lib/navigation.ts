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

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: Home, primary: true },
  { href: '/map', label: 'Map', icon: MapIcon, primary: true },
  { href: '/family', label: 'Family', icon: Users, primary: true },
  { href: '/alerts', label: 'Alerts', icon: Bell, primary: true },
  { href: '/profile', label: 'Profile', icon: User, primary: true },
  { href: '/chat', label: 'Chat', icon: MessageCircle, primary: false },
  { href: '/places', label: 'Places', icon: MapPin, primary: false },
  { href: '/history', label: 'My history', icon: History, primary: false },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((i) => i.primary);

/** Longest-prefix match so /family/settings still highlights "Family". */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
