import React from 'react';
import { NavItem } from '../constants/nav';

/**
 * Stands in for a nav destination whose screen is not built yet. It names what
 * the destination will hold rather than showing a bare "coming soon", so the
 * sidebar entry is honest instead of decorative.
 */
export function ComingSoon({ item }: { item: NavItem }) {
  return (
    <div className="page page-centered">
      <div className="coming-soon">
        <h2 className="coming-soon-title">{item.label}</h2>
        <p className="coming-soon-body">{item.planned}</p>
        <p className="coming-soon-note">Not built yet.</p>
      </div>
    </div>
  );
}
