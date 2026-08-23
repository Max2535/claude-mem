/**
 * Sidebar destinations. `id` doubles as the URL hash (#/home), so renaming one
 * breaks bookmarks — add rather than rename.
 */
export type RouteId = 'home' | 'recall' | 'explorer' | 'burn' | 'chat' | 'system';

export interface NavItem {
  id: RouteId;
  label: string;
  /** Rendered as an inline <path>/<circle> set inside a 24x24 stroke icon. */
  icon: string;
  /** Destinations without a screen yet render the ComingSoon panel. */
  built: boolean;
  /** Shown by ComingSoon so a dead nav item still says what it will hold. */
  planned?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5',
    built: true,
  },
  {
    id: 'recall',
    label: 'Recall',
    icon: 'M4 6h16M4 12h16M4 18h10',
    built: true,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: 'M12 3v6m0 0-5 4m5-4 5 4M7 13v4m10-4v4M4 20h6m4 0h6',
    built: true,
  },
  {
    id: 'burn',
    label: 'Token Burn',
    icon: 'M12 3c.5 3 3 4.2 3 7a3 3 0 0 1-6 0c0-1 .4-1.8 1-2.5M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-4-9',
    built: true,
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: 'M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z',
    built: true,
  },
  {
    id: 'system',
    label: 'System',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    built: true,
  },
];

export const DEFAULT_ROUTE: RouteId = 'home';
