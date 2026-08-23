import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ComingSoon } from './components/ComingSoon';
import { Feed } from './components/Feed';
import { Explorer } from './components/Explorer';
import { Chat } from './components/Chat';
import { TokenBurn } from './components/TokenBurn';
import { System } from './components/System';
import { ContextSettingsModal } from './components/ContextSettingsModal';
import { LogsDrawer } from './components/LogsModal';
import { WelcomeCard, getStoredWelcomeDismissed, setStoredWelcomeDismissed } from './components/WelcomeCard';
import { useSSE } from './hooks/useSSE';
import { useSettings } from './hooks/useSettings';
import { usePagination } from './hooks/usePagination';
import { useTheme } from './hooks/useTheme';
import { useRoute } from './hooks/useRoute';
import { useStats } from './hooks/useStats';
import { NAV_ITEMS } from './constants/nav';
import { Observation, Summary, UserPrompt } from './types';
import { ChatTurn } from './utils/memoryWalk';
import { mergeAndDeduplicateByProject } from './utils/data';

export function App() {
  const [currentFilter, setCurrentFilter] = useState('');
  const [contextPreviewOpen, setContextPreviewOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState<boolean>(getStoredWelcomeDismissed);
  const [paginatedObservations, setPaginatedObservations] = useState<Observation[]>([]);
  const [paginatedSummaries, setPaginatedSummaries] = useState<Summary[]>([]);
  const [paginatedPrompts, setPaginatedPrompts] = useState<UserPrompt[]>([]);
  // Held here rather than inside Chat: a route change unmounts the screen, and
  // an answer that cost an LLM subprocess should not vanish with it.
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);

  const { observations, summaries, prompts, projects, isProcessing, queueDepth } = useSSE();
  const { settings, saveSettings, isSaving, saveStatus } = useSettings();
  const { preference, setThemePreference } = useTheme();
  const pagination = usePagination(currentFilter);
  const [route, routeTail, navigate] = useRoute();
  const { stats, error: statsError } = useStats();

  const matchesSelection = useCallback((item: { project: string }) => {
    return !currentFilter || item.project === currentFilter;
  }, [currentFilter]);

  useEffect(() => {
    if (currentFilter && !projects.includes(currentFilter)) {
      setCurrentFilter('');
    }
  }, [projects, currentFilter]);

  const allObservations = useMemo(() => {
    const live = observations.filter(matchesSelection);
    const paginated = paginatedObservations.filter(matchesSelection);
    return mergeAndDeduplicateByProject(live, paginated);
  }, [observations, paginatedObservations, matchesSelection]);

  const allSummaries = useMemo(() => {
    const live = summaries.filter(matchesSelection);
    const paginated = paginatedSummaries.filter(matchesSelection);
    return mergeAndDeduplicateByProject(live, paginated);
  }, [summaries, paginatedSummaries, matchesSelection]);

  const allPrompts = useMemo(() => {
    const live = prompts.filter(matchesSelection);
    const paginated = paginatedPrompts.filter(matchesSelection);
    return mergeAndDeduplicateByProject(live, paginated);
  }, [prompts, paginatedPrompts, matchesSelection]);

  const toggleContextPreview = useCallback(() => {
    setContextPreviewOpen(prev => !prev);
  }, []);

  const toggleLogsModal = useCallback(() => {
    setLogsModalOpen(prev => !prev);
  }, []);

  const handleLoadMore = useCallback(async () => {
    try {
      const [newObservations, newSummaries, newPrompts] = await Promise.all([
        pagination.observations.loadMore(),
        pagination.summaries.loadMore(),
        pagination.prompts.loadMore()
      ]);

      if (newObservations.length > 0) {
        setPaginatedObservations(prev => [...prev, ...newObservations]);
      }
      if (newSummaries.length > 0) {
        setPaginatedSummaries(prev => [...prev, ...newSummaries]);
      }
      if (newPrompts.length > 0) {
        setPaginatedPrompts(prev => [...prev, ...newPrompts]);
      }
    } catch (error) {
      console.error('Failed to load more data:', error);
    }
  }, [pagination.observations, pagination.summaries, pagination.prompts]);

  useEffect(() => {
    setPaginatedObservations([]);
    setPaginatedSummaries([]);
    setPaginatedPrompts([]);
    handleLoadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilter]);

  const currentNavItem = NAV_ITEMS.find(item => item.id === route) ?? NAV_ITEMS[0];

  return (
    <>
      <div className="app-shell">
        <Sidebar
          route={route}
          onNavigate={navigate}
          isProcessing={isProcessing}
          queueDepth={queueDepth}
          themePreference={preference}
          onThemeChange={setThemePreference}
          onSettingsToggle={toggleContextPreview}
          onLogsToggle={toggleLogsModal}
          logsOpen={logsModalOpen}
        />

        <div className="app-main">
          <Header
            projects={projects}
            currentFilter={currentFilter}
            onFilterChange={setCurrentFilter}
            onShowHelp={() => {
              setStoredWelcomeDismissed(false);
              setWelcomeDismissed(false);
            }}
          />

          {route === 'home' && (
            <Dashboard
              stats={stats}
              statsError={statsError}
              observations={allObservations}
              summaries={allSummaries}
              prompts={allPrompts}
              currentFilter={currentFilter}
              onNavigate={navigate}
            />
          )}

          {route === 'recall' && (
            <Feed
              observations={allObservations}
              summaries={allSummaries}
              prompts={allPrompts}
              onLoadMore={handleLoadMore}
              isLoading={pagination.observations.isLoading || pagination.summaries.isLoading || pagination.prompts.isLoading}
              hasMore={pagination.observations.hasMore || pagination.summaries.hasMore || pagination.prompts.hasMore}
            />
          )}

          {route === 'explorer' && (
            <Explorer
              currentFilter={currentFilter}
              liveObservationCount={observations.length}
              selectedId={routeTail}
              onSelect={id => navigate('explorer', id)}
            />
          )}

          {route === 'burn' && <TokenBurn currentFilter={currentFilter} />}
      {route === 'chat' && (
            <Chat
              currentFilter={currentFilter}
              turns={chatTurns}
              setTurns={setChatTurns}
            />
          )}

          {route === 'system' && (
            <System
              stats={stats}
              statsError={statsError}
              isProcessing={isProcessing}
              queueDepth={queueDepth}
            />
          )}

          {!currentNavItem.built && <ComingSoon item={currentNavItem} />}
        </div>
      </div>

      {!welcomeDismissed && (
        <WelcomeCard onDismiss={() => setWelcomeDismissed(true)} />
      )}

      <ContextSettingsModal
        isOpen={contextPreviewOpen}
        onClose={toggleContextPreview}
        settings={settings}
        onSave={saveSettings}
        isSaving={isSaving}
        saveStatus={saveStatus}
      />

      <LogsDrawer
        isOpen={logsModalOpen}
        onClose={toggleLogsModal}
      />
    </>
  );
}
