import { describe, it, expect, mock } from 'bun:test';
import { SearchManager, parseBoundedInt } from '../../src/services/worker/SearchManager.js';

describe('SearchManager platform-scoped Chroma hydration', () => {
  it('normalizes date_from/date_to filters into dateRange for worker search', async () => {
    const searchObservations = mock(() => []);
    const manager = new SearchManager(
      {
        searchObservations,
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {} as any,
      null,
      {} as any,
      {} as any,
    );

    await manager.search({
      type: 'observations',
      date_from: '2025-01-01',
      date_to: '2025-01-31',
      format: 'json',
    });

    expect(searchObservations).toHaveBeenCalledWith(undefined, expect.objectContaining({
      dateRange: {
        start: '2025-01-01',
        end: '2025-01-31',
      },
    }));
  });

  it('passes platformSource into Chroma observation where filter and SQLite hydration', async () => {
    const observation = {
      id: 5,
      memory_session_id: 'cursor-memory-id',
      project: 'search-project',
      text: null,
      type: 'discovery',
      title: 'cursor overlap observation',
      subtitle: null,
      facts: '[]',
      narrative: 'cursor overlap narrative',
      concepts: '[]',
      files_read: '[]',
      files_modified: '[]',
      prompt_number: 1,
      discovery_tokens: 0,
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const getObservationsByIds = mock(() => [observation]);
    const queryChroma = mock(() => Promise.resolve({
      ids: [observation.id],
      distances: [0.1],
      metadatas: [{
        sqlite_id: observation.id,
        doc_type: 'observation',
        project: 'search-project',
        platform_source: 'cursor',
        created_at_epoch: Date.now(),
      }],
    }));

    const manager = new SearchManager(
      {
        searchObservations: mock(() => []),
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {
        getObservationsByIds,
        getSessionSummariesByIds: mock(() => []),
        getUserPromptsByIds: mock(() => []),
      } as any,
      { queryChroma } as any,
      {} as any,
      {} as any,
    );

    const result = await manager.search({
      query: 'overlap',
      type: 'observations',
      project: 'search-project',
      platformSource: 'cursor',
      format: 'json',
      limit: 10,
    });

    expect(queryChroma).toHaveBeenCalledWith('overlap', 100, {
      $and: [
        { doc_type: 'observation' },
        { $or: [{ project: 'search-project' }, { merged_into_project: 'search-project' }] },
        { platform_source: 'cursor' },
      ],
    });
    expect(getObservationsByIds).toHaveBeenCalledWith([observation.id], expect.objectContaining({
      platformSource: 'cursor',
      project: 'search-project',
    }));
    expect(result.observations).toEqual([observation]);
  });

  it('passes platformSource into Chroma session where filter and SQLite hydration', async () => {
    const session = {
      id: 6,
      memory_session_id: 'cursor-memory-id',
      project: 'search-project',
      request: 'cursor overlap session',
      investigated: null,
      learned: null,
      completed: null,
      next_steps: null,
      files_read: null,
      files_edited: null,
      notes: null,
      prompt_number: 1,
      discovery_tokens: 0,
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const getSessionSummariesByIds = mock(() => [session]);
    const queryChroma = mock(() => Promise.resolve({
      ids: [session.id],
      distances: [0.1],
      metadatas: [{
        sqlite_id: session.id,
        doc_type: 'session_summary',
        project: 'search-project',
        platform_source: 'cursor',
        created_at_epoch: Date.now(),
      }],
    }));

    const manager = new SearchManager(
      {
        searchObservations: mock(() => []),
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {
        getObservationsByIds: mock(() => []),
        getSessionSummariesByIds,
        getUserPromptsByIds: mock(() => []),
      } as any,
      { queryChroma } as any,
      {} as any,
      {} as any,
    );

    const result = await manager.search({
      query: 'overlap',
      type: 'sessions',
      project: 'search-project',
      platformSource: 'cursor',
      format: 'json',
      limit: 10,
    });

    expect(queryChroma).toHaveBeenCalledWith('overlap', 100, {
      $and: [
        { doc_type: 'session_summary' },
        { $or: [{ project: 'search-project' }, { merged_into_project: 'search-project' }] },
        { platform_source: 'cursor' },
      ],
    });
    expect(getSessionSummariesByIds).toHaveBeenCalledWith([session.id], {
      orderBy: 'date_desc',
      limit: 10,
      project: 'search-project',
      platformSource: 'cursor',
    });
    expect(result.sessions).toEqual([session]);
  });

  it('passes platformSource into Chroma prompt SQLite hydration', async () => {
    const prompt = {
      id: 7,
      content_session_id: 'shared-raw-id',
      prompt_number: 1,
      prompt_text: 'cursor overlap prompt',
      project: 'search-project',
      platform_source: 'cursor',
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const getUserPromptsByIds = mock(() => [prompt]);
    const queryChroma = mock(() => Promise.resolve({
      ids: [prompt.id],
      distances: [0.1],
      metadatas: [{
        sqlite_id: prompt.id,
        doc_type: 'user_prompt',
        project: 'search-project',
        platform_source: 'cursor',
        created_at_epoch: Date.now(),
      }],
    }));

    const manager = new SearchManager(
      {
        searchObservations: mock(() => []),
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {
        getObservationsByIds: mock(() => []),
        getSessionSummariesByIds: mock(() => []),
        getUserPromptsByIds,
      } as any,
      { queryChroma } as any,
      {} as any,
      {} as any,
    );

    const result = await manager.search({
      query: 'overlap',
      type: 'prompts',
      project: 'search-project',
      platformSource: 'cursor',
      format: 'json',
      limit: 10,
    });

    expect(getUserPromptsByIds).toHaveBeenCalledWith([prompt.id], {
      orderBy: 'date_desc',
      limit: 10,
      project: 'search-project',
      platformSource: 'cursor',
    });
    expect(result.prompts).toEqual([prompt]);
  });

  it('passes platformSource into getTimelineByQuery auto-mode hydration', async () => {
    const observation = {
      id: 8,
      memory_session_id: 'cursor-memory-id',
      project: 'search-project',
      text: null,
      type: 'discovery',
      title: 'cursor timeline anchor',
      subtitle: null,
      facts: '[]',
      narrative: 'cursor timeline narrative',
      concepts: '[]',
      files_read: '[]',
      files_modified: '[]',
      prompt_number: 1,
      discovery_tokens: 0,
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const searchObservations = mock(() => [observation]);
    const getTimelineAroundObservation = mock(() => ({
      observations: [],
      sessions: [],
      prompts: [],
    }));

    const manager = new SearchManager(
      {
        searchObservations,
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {
        getObservationsByIds: mock(() => []),
        getSessionSummariesByIds: mock(() => []),
        getUserPromptsByIds: mock(() => []),
        getTimelineAroundObservation,
      } as any,
      null,
      {} as any,
      { filterByDepth: mock(() => []) } as any,
    );

    await manager.getTimelineByQuery({
      query: 'timeline',
      mode: 'auto',
      project: 'search-project',
      platform_source: 'cursor',
    });

    expect(searchObservations).toHaveBeenCalledWith('timeline', {
      project: 'search-project',
      platformSource: 'cursor',
      limit: 1,
    });
    expect(getTimelineAroundObservation).toHaveBeenCalledWith(
      observation.id,
      observation.created_at_epoch,
      10,
      10,
      'search-project',
      'cursor',
    );
  });

  it('falls back to scoped SQLite/FTS when platform-scoped Chroma returns zero matches', async () => {
    const observation = {
      id: 9,
      memory_session_id: 'cursor-memory-id',
      project: 'search-project',
      text: null,
      type: 'discovery',
      title: 'cursor fallback observation',
      subtitle: null,
      facts: '[]',
      narrative: 'cursor fallback narrative',
      concepts: '[]',
      files_read: '[]',
      files_modified: '[]',
      prompt_number: 1,
      discovery_tokens: 0,
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const session = {
      id: 10,
      memory_session_id: 'cursor-memory-id',
      project: 'search-project',
      request: 'cursor fallback session',
      investigated: null,
      learned: null,
      completed: null,
      next_steps: null,
      files_read: null,
      files_edited: null,
      notes: null,
      prompt_number: 1,
      discovery_tokens: 0,
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const prompt = {
      id: 11,
      content_session_id: 'shared-raw-id',
      prompt_number: 1,
      prompt_text: 'cursor fallback prompt',
      project: 'search-project',
      platform_source: 'cursor',
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    };
    const searchObservations = mock(() => [observation]);
    const searchSessions = mock(() => [session]);
    const searchUserPrompts = mock(() => [prompt]);
    const queryChroma = mock(() => Promise.resolve({
      ids: [],
      distances: [],
      metadatas: [],
    }));

    const manager = new SearchManager(
      {
        searchObservations,
        searchSessions,
        searchUserPrompts,
      } as any,
      {
        getObservationsByIds: mock(() => []),
        getSessionSummariesByIds: mock(() => []),
        getUserPromptsByIds: mock(() => []),
      } as any,
      { queryChroma } as any,
      {} as any,
      {} as any,
    );
    const telemetry = {};

    const result = await manager.search({
      query: 'legacy metadata',
      project: 'search-project',
      platformSource: 'cursor',
      format: 'json',
      limit: 10,
    }, telemetry);

    expect(searchObservations).toHaveBeenCalledWith('legacy metadata', expect.objectContaining({
      project: 'search-project',
      platformSource: 'cursor',
    }));
    expect(searchSessions).toHaveBeenCalledWith('legacy metadata', expect.objectContaining({
      project: 'search-project',
      platformSource: 'cursor',
    }));
    expect(searchUserPrompts).toHaveBeenCalledWith('legacy metadata', expect.objectContaining({
      project: 'search-project',
      platformSource: 'cursor',
    }));
    expect(result).toEqual(expect.objectContaining({
      observations: [observation],
      sessions: [session],
      prompts: [prompt],
      totalResults: 3,
    }));
    expect(telemetry).toEqual(expect.objectContaining({
      result_count: 3,
      search_strategy: 'fts',
      chroma_available: true,
      fallback_reason: 'chroma_error',
    }));
  });

  it('keeps unscoped Chroma zero matches final without SQLite/FTS fallback', async () => {
    const searchObservations = mock(() => []);
    const searchSessions = mock(() => []);
    const searchUserPrompts = mock(() => []);
    const queryChroma = mock(() => Promise.resolve({
      ids: [],
      distances: [],
      metadatas: [],
    }));

    const manager = new SearchManager(
      {
        searchObservations,
        searchSessions,
        searchUserPrompts,
      } as any,
      {
        getObservationsByIds: mock(() => []),
        getSessionSummariesByIds: mock(() => []),
        getUserPromptsByIds: mock(() => []),
      } as any,
      { queryChroma } as any,
      {} as any,
      {} as any,
    );
    const telemetry = {};

    const result = await manager.search({
      query: 'legacy metadata',
      format: 'json',
    }, telemetry);

    expect(searchObservations).not.toHaveBeenCalled();
    expect(searchSessions).not.toHaveBeenCalled();
    expect(searchUserPrompts).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      observations: [],
      sessions: [],
      prompts: [],
      totalResults: 0,
    }));
    expect(telemetry).toEqual(expect.objectContaining({
      result_count: 0,
      search_strategy: 'chroma',
      chroma_available: true,
      fallback_reason: 'none',
    }));
  });
});

describe('SearchManager internal search options', () => {
  function managerWith(searchObservations: any): SearchManager {
    return new SearchManager(
      {
        searchObservations,
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {} as any,
      null,
      {} as any,
      {} as any,
    );
  }

  // args on these paths are HTTP query params (SearchRoutes.ts:177) or MCP tool
  // input, and they are spread straight into SessionSearch.searchObservations.
  // allowUnfiltered turns off the guard that stops a full-table read, so a
  // caller must not be able to hand it to itself.
  it('drops caller-supplied allowUnfiltered from a filter-only search', async () => {
    const searchObservations = mock(() => []);
    await managerWith(searchObservations).search({
      type: 'observations',
      allowUnfiltered: true,
      format: 'json',
    });

    expect(searchObservations).toHaveBeenCalled();
    const options = (searchObservations as any).mock.calls[0][1];
    expect(options.allowUnfiltered).toBeUndefined();
  });

  it('drops it from searchObservations too, including the string form a query param arrives as', async () => {
    const searchObservations = mock(() => []);
    await managerWith(searchObservations).searchObservations({
      query: 'restart',
      allowUnfiltered: 'true',
      excludeObserverSessions: 'false',
    });

    expect(searchObservations).toHaveBeenCalled();
    const options = (searchObservations as any).mock.calls[0][1];
    expect(options.allowUnfiltered).toBeUndefined();
    expect(options.excludeObserverSessions).toBeUndefined();
  });

  it('leaves real filters alone while stripping the internal ones', async () => {
    const searchObservations = mock(() => []);
    await managerWith(searchObservations).search({
      type: 'observations',
      project: 'walk-project',
      allowUnfiltered: true,
      format: 'json',
    });

    const options = (searchObservations as any).mock.calls[0][1];
    expect(options.project).toBe('walk-project');
    expect(options.allowUnfiltered).toBeUndefined();
  });
});

describe('pagination numbers off the wire', () => {
  // `?limit=abc` used to become NaN and travel to `LIMIT ?`, so the search came
  // back empty — indistinguishable from having no matching memories.
  it('rejects values that are not numbers instead of producing NaN', () => {
    for (const bad of ['abc', '', '  ', 'NaN', 'Infinity', {}, [], null, undefined, true]) {
      expect(parseBoundedInt(bad as unknown, 1)).toBeUndefined();
    }
  });

  it('rejects a limit below the minimum but keeps offset 0', () => {
    expect(parseBoundedInt(0, 1)).toBeUndefined();
    expect(parseBoundedInt(-5, 1)).toBeUndefined();
    expect(parseBoundedInt(0, 0)).toBe(0);
    expect(parseBoundedInt('0', 0)).toBe(0);
  });

  it('accepts the string form a query param arrives as, and truncates fractions', () => {
    expect(parseBoundedInt('25', 1)).toBe(25);
    expect(parseBoundedInt(25, 1)).toBe(25);
    expect(parseBoundedInt('25.9', 1)).toBe(25);
    expect(parseBoundedInt(25.9, 1)).toBe(25);
  });

  it('drops an unusable limit so the caller default applies, rather than passing it on', async () => {
    const searchObservations = mock(() => []);
    const manager = new SearchManager(
      {
        searchObservations,
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {} as any,
      null,
      {} as any,
      {} as any,
    );

    await manager.search({ type: 'observations', project: 'p', limit: 'abc', format: 'json' });

    const options = (searchObservations as any).mock.calls[0][1];
    expect('limit' in options).toBe(false);
  });

  it('passes a usable limit through as a number', async () => {
    const searchObservations = mock(() => []);
    const manager = new SearchManager(
      {
        searchObservations,
        searchSessions: mock(() => []),
        searchUserPrompts: mock(() => []),
      } as any,
      {} as any,
      null,
      {} as any,
      {} as any,
    );

    await manager.search({ type: 'observations', project: 'p', limit: '7', format: 'json' });

    expect((searchObservations as any).mock.calls[0][1].limit).toBe(7);
  });
});
