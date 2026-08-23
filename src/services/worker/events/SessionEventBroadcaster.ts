
import { SSEBroadcaster } from '../SSEBroadcaster.js';
import type { SessionManager } from '../SessionManager.js';
import type { WorkerService } from '../../worker-service.js';

export class SessionEventBroadcaster {
  constructor(
    private sseBroadcaster: SSEBroadcaster,
    private workerService: WorkerService,
    /**
     * Only used to resolve a session's project for Agent Flow. Optional so the
     * broadcaster stays constructible from a bare worker double in tests, and
     * so a missing session degrades to a null project rather than a throw.
     */
    private sessionManager?: SessionManager
  ) {}

  broadcastNewPrompt(prompt: {
    id: number;
    content_session_id: string;
    project: string;
    platform_source: string;
    prompt_number: number;
    prompt_text: string;
    created_at_epoch: number;
  }): void {
    this.sseBroadcaster.broadcast({
      type: 'new_prompt',
      prompt
    });
  }

  /**
   * Resolve the project for a flow event from the live session, so Agent Flow
   * can group by project without every call site threading it through.
   */
  private flowContext(sessionDbId: number): { project: string | null; contentSessionId: string | null } {
    const session = this.sessionManager?.getSession(sessionDbId);
    return {
      project: session?.project ?? null,
      contentSessionId: session?.contentSessionId ?? null,
    };
  }

  broadcastSessionStarted(sessionDbId: number, project: string): void {
    this.sseBroadcaster.broadcast({
      type: 'session_started',
      sessionDbId,
      project
    });
    this.sseBroadcaster.emitFlow({
      stage: 'session_started',
      project,
      contentSessionId: this.flowContext(sessionDbId).contentSessionId,
      sessionDbId,
      detail: null,
      outcome: null,
    });
  }

  broadcastObservationQueued(sessionDbId: number): void {
    this.sseBroadcaster.broadcast({
      type: 'observation_queued',
      sessionDbId
    });
    const queued = this.flowContext(sessionDbId);
    this.sseBroadcaster.emitFlow({
      stage: 'observation_queued',
      project: queued.project,
      contentSessionId: queued.contentSessionId,
      sessionDbId,
      detail: null,
      outcome: null,
    });
  }

  broadcastSessionCompleted(sessionDbId: number): void {
    this.sseBroadcaster.broadcast({
      type: 'session_completed',
      timestamp: Date.now(),
      sessionDbId
    });
    const completed = this.flowContext(sessionDbId);
    this.sseBroadcaster.emitFlow({
      stage: 'session_completed',
      project: completed.project,
      contentSessionId: completed.contentSessionId,
      sessionDbId,
      detail: null,
      outcome: null,
    });
  }

  broadcastSummarizeQueued(): void {
    this.workerService.broadcastProcessingStatus();
  }
}
