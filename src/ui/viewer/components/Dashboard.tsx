import React from 'react';
import { StatTiles } from './StatTiles';
import { ActivityTimeline } from './ActivityTimeline';
import { Observation, Summary, UserPrompt, WorkerStats } from '../types';
import { RouteId } from '../constants/nav';

interface DashboardProps {
  stats: WorkerStats | null;
  statsError: boolean;
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
  currentFilter: string;
  onNavigate: (next: RouteId) => void;
}

export function Dashboard({
  stats,
  statsError,
  observations,
  summaries,
  prompts,
  currentFilter,
  onNavigate,
}: DashboardProps) {
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Today</h1>
        <p className="page-subtitle">
          {currentFilter ? `Project: ${currentFilter}` : 'Across all projects'}
        </p>
      </header>

      <StatTiles stats={stats} error={statsError} />

      <ActivityTimeline
        observations={observations}
        summaries={summaries}
        prompts={prompts}
      />

      <button type="button" className="recall-cta" onClick={() => onNavigate('recall')}>
        <span className="recall-cta-text">
          <span className="recall-cta-title">Browse your memory</span>
          <span className="recall-cta-sub">Every observation, summary, and prompt as a live feed</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
