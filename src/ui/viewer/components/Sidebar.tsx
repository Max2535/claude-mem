import React from 'react';
import { NAV_ITEMS, RouteId } from '../constants/nav';
import { ThemeToggle } from './ThemeToggle';
import { ThemePreference } from '../hooks/useTheme';
import { useSpinningFavicon } from '../hooks/useSpinningFavicon';

interface SidebarProps {
  route: RouteId;
  onNavigate: (next: RouteId) => void;
  isProcessing: boolean;
  queueDepth: number;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onSettingsToggle: () => void;
  onLogsToggle: () => void;
  logsOpen: boolean;
}

export function Sidebar({
  route,
  onNavigate,
  isProcessing,
  queueDepth,
  themePreference,
  onThemeChange,
  onSettingsToggle,
  onLogsToggle,
  logsOpen,
}: SidebarProps) {
  // The logomark lives here now, so the favicon it mirrors is driven from here too.
  useSpinningFavicon(isProcessing);

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar-brand">
        <div className="sidebar-logomark-wrap">
          <img
            src="claude-mem-logomark.webp"
            alt=""
            className={`logomark ${isProcessing ? 'spinning' : ''}`}
          />
          {queueDepth > 0 && <div className="queue-bubble">{queueDepth}</div>}
        </div>
        <span className="sidebar-brand-text">claude-mem</span>
      </div>

      <ul className="sidebar-nav">
        {NAV_ITEMS.map(item => {
          const isCurrent = item.id === route;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`sidebar-nav-item ${isCurrent ? 'is-current' : ''}`}
                onClick={() => onNavigate(item.id)}
                aria-current={isCurrent ? 'page' : undefined}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={item.icon} />
                </svg>
                <span className="sidebar-nav-label">{item.label}</span>
                {/* Marks a destination that routes to ComingSoon, so the nav does
                    not promise a screen that is not there yet. */}
                {!item.built && <span className="sidebar-nav-soon">soon</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sidebar-footer">
        <ThemeToggle preference={themePreference} onThemeChange={onThemeChange} />
        <button
          type="button"
          className="settings-btn"
          onClick={onSettingsToggle}
          title="Settings"
          aria-label="Settings"
        >
          <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
        {/* The console used to float over this row and cover the theme
            toggle. It is a global control like its neighbours, so it stands
            with them. The open drawer covers this whole row, so the pressed
            state is carried by aria-pressed alone — a highlight here could
            never be seen. */}
        <button
          type="button"
          className="console-toggle-btn"
          onClick={onLogsToggle}
          title="Toggle Console"
          aria-label="Toggle Console"
          aria-pressed={logsOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
        </button>
      </div>
    </nav>
  );
}
