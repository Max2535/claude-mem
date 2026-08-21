
import type { SQLQueryBindings } from 'bun:sqlite';
import { DatabaseManager } from './DatabaseManager.js';
import { logger } from '../../utils/logger.js';
import { OBSERVER_SESSIONS_PROJECT } from '../../shared/paths.js';
import { USER_PROMPT_DEDUPE_WINDOW_MS } from '../../shared/user-prompts.js';
import type { PaginatedResult, Observation, Summary, UserPrompt, ExplorerDay, ExplorerDayObservation } from '../worker-types.js';

export class PaginationHelper {
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  private stripProjectPath(filePath: string, projectName: string): string {
    const leaf = projectName.includes('/') ? projectName.split('/').pop()! : projectName;
    const marker = `/${leaf}/`;
    const index = filePath.indexOf(marker);

    if (index !== -1) {
      return filePath.substring(index + marker.length);
    }

    return filePath;
  }

  private stripProjectPaths(filePathsStr: string | null, projectName: string): string | null {
    if (!filePathsStr) return filePathsStr;

    try {
      const paths = JSON.parse(filePathsStr) as string[];

      const strippedPaths = paths.map(p => this.stripProjectPath(p, projectName));

      return JSON.stringify(strippedPaths);
    } catch (err) {
      if (err instanceof Error) {
        logger.debug('WORKER', 'File paths is plain string, using as-is', {}, err);
      } else {
        logger.debug('WORKER', 'File paths is plain string, using as-is', { rawError: String(err) });
      }
      return filePathsStr;
    }
  }

  private sanitizeObservation(obs: Observation): Observation {
    return {
      ...obs,
      files_read: this.stripProjectPaths(obs.files_read, obs.project),
      files_modified: this.stripProjectPaths(obs.files_modified, obs.project)
    };
  }

  getObservations(offset: number, limit: number, project?: string, platformSource?: string, sessionId?: string): PaginatedResult<Observation> {
    const db = this.dbManager.getSessionStore().db;
    let query = `
      SELECT
        o.id,
        o.memory_session_id,
        o.project,
        o.merged_into_project,
        COALESCE(s.platform_source, 'claude') as platform_source,
        o.type,
        o.title,
        o.subtitle,
        o.narrative,
        o.text,
        o.facts,
        o.concepts,
        o.files_read,
        o.files_modified,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    `;
    const params: SQLQueryBindings[] = [];
    const conditions: string[] = [];

    if (project) {
      conditions.push('(o.project = ? OR o.merged_into_project = ?)');
      params.push(project, project);
    } else {
      conditions.push('o.project != ?');
      params.push(OBSERVER_SESSIONS_PROJECT);
    }
    if (platformSource) {
      conditions.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }
    if (sessionId) {
      conditions.push('o.memory_session_id = ?');
      params.push(sessionId);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY o.created_at_epoch DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const results = db.prepare(query).all(...params) as Observation[];
    const result: PaginatedResult<Observation> = {
      items: results.slice(0, limit),
      hasMore: results.length > limit,
      offset,
      limit
    };

    return {
      ...result,
      items: result.items.map(obs => this.sanitizeObservation(obs))
    };
  }

  /**
   * Every observation on one local day, projected down to what the Explorer
   * graph draws. The narrative and text columns are omitted on purpose — the
   * graph shows a few hundred nodes and only needs their labels; the detail
   * pane fetches the full row for the one node that gets selected.
   *
   * `days` comes back on every call so the date stepper always knows where the
   * neighbours are without a second round trip.
   */
  getExplorerDay(day: string | undefined, project?: string, platformSource?: string): ExplorerDay {
    const db = this.dbManager.getSessionStore().db;

    const scope: string[] = [];
    const scopeParams: SQLQueryBindings[] = [];
    if (project) {
      scope.push('(o.project = ? OR o.merged_into_project = ?)');
      scopeParams.push(project, project);
    } else {
      scope.push('o.project != ?');
      scopeParams.push(OBSERVER_SESSIONS_PROJECT);
    }
    if (platformSource) {
      scope.push(`COALESCE(s.platform_source, 'claude') = ?`);
      scopeParams.push(platformSource);
    }
    const where = scope.join(' AND ');

    // localtime, not UTC: the day boundaries a person means are their own.
    const dayExpr = `date(o.created_at_epoch / 1000, 'unixepoch', 'localtime')`;

    const days = (db.prepare(`
      SELECT DISTINCT ${dayExpr} as day
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE ${where}
      ORDER BY day ASC
    `).all(...scopeParams) as { day: string }[]).map(row => row.day);

    const selected = day && days.includes(day) ? day : days[days.length - 1];

    if (!selected) {
      logger.debug('WORKER', 'PaginationHelper: explorer day empty', { day, project });
      return { day: null, days: [], observations: [] };
    }

    const observations = db.prepare(`
      SELECT
        o.id,
        o.memory_session_id as sessionId,
        COALESCE(s.content_session_id, o.memory_session_id) as contentSessionId,
        o.project,
        COALESCE(s.platform_source, 'claude') as platformSource,
        o.type,
        o.title,
        o.subtitle,
        o.prompt_number as promptNumber,
        o.created_at_epoch as createdAt
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE ${where} AND ${dayExpr} = ?
      ORDER BY o.created_at_epoch ASC
    `).all(...scopeParams, selected) as ExplorerDayObservation[];

    logger.debug('WORKER', 'PaginationHelper: built explorer day', {
      day: selected,
      days: days.length,
      observations: observations.length,
    });

    return { day: selected, days, observations };
  }

  getSummaries(offset: number, limit: number, project?: string, platformSource?: string): PaginatedResult<Summary> {
    const db = this.dbManager.getSessionStore().db;

    let query = `
      SELECT
        ss.id,
        s.content_session_id as session_id,
        COALESCE(s.platform_source, 'claude') as platform_source,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.project,
        ss.created_at,
        ss.created_at_epoch
      FROM session_summaries ss
      JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    `;
    const params: any[] = [];

    const conditions: string[] = [];

    if (project) {
      conditions.push('(ss.project = ? OR ss.merged_into_project = ?)');
      params.push(project, project);
    } else {
      conditions.push('ss.project != ?');
      params.push(OBSERVER_SESSIONS_PROJECT);
    }

    if (platformSource) {
      conditions.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY ss.created_at_epoch DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const stmt = db.prepare(query);
    const results = stmt.all(...params) as Summary[];

    return {
      items: results.slice(0, limit),
      hasMore: results.length > limit,
      offset,
      limit
    };
  }

  getPrompts(offset: number, limit: number, project?: string, platformSource?: string): PaginatedResult<UserPrompt> {
    const db = this.dbManager.getSessionStore().db;

    let query = `
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, 'claude') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
    `;
    const params: any[] = [];

    const conditions: string[] = [];

    if (project) {
      conditions.push('s.project = ?');
      params.push(project);
    } else {
      conditions.push('s.project != ?');
      params.push(OBSERVER_SESSIONS_PROJECT);
    }

    if (platformSource) {
      conditions.push(`COALESCE(s.platform_source, 'claude') = ?`);
      params.push(platformSource);
    }

    conditions.push(`
      NOT EXISTS (
        SELECT 1
        FROM user_prompts duplicate
        WHERE duplicate.session_db_id = up.session_db_id
          AND duplicate.prompt_text = up.prompt_text
          AND (
            duplicate.created_at_epoch > up.created_at_epoch
            OR (
              duplicate.created_at_epoch = up.created_at_epoch
              AND duplicate.id > up.id
            )
          )
          AND duplicate.created_at_epoch - up.created_at_epoch <= ?
      )
    `);
    params.push(USER_PROMPT_DEDUPE_WINDOW_MS);

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY up.created_at_epoch DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const stmt = db.prepare(query);
    const results = stmt.all(...params) as UserPrompt[];

    return {
      items: results.slice(0, limit),
      hasMore: results.length > limit,
      offset,
      limit
    };
  }
}
