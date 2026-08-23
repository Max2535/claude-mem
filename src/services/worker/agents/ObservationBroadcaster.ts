
import type { WorkerRef, ObservationSSEPayload, SummarySSEPayload } from './types.js';
import { logger } from '../../../utils/logger.js';
import { shouldEmitProjectRow } from '../../../shared/should-track-project.js';

export function broadcastObservation(
  worker: WorkerRef | undefined,
  payload: ObservationSSEPayload
): void {
  if (!worker?.sseBroadcaster) {
    return;
  }

  if (!shouldEmitProjectRow(payload.project)) {
    logger.debug('WORKER', 'SSE observation broadcast skipped (internal project)', {
      project: payload.project,
      id: payload.id,
    });
    return;
  }

  worker.sseBroadcaster.broadcast({
    type: 'new_observation',
    observation: payload
  });
  // Title, not text: Agent Flow must stay free of observation bodies.
  worker.sseBroadcaster.emitFlow?.({
    stage: 'observation_written',
    project: payload.project,
    contentSessionId: payload.session_id,
    sessionDbId: null,
    detail: payload.type,
    outcome: 'ok',
  });
}

export function broadcastSummary(
  worker: WorkerRef | undefined,
  payload: SummarySSEPayload
): void {
  if (!worker?.sseBroadcaster) {
    return;
  }

  if (!shouldEmitProjectRow(payload.project)) {
    logger.debug('WORKER', 'SSE summary broadcast skipped (internal project)', {
      project: payload.project,
      id: payload.id,
    });
    return;
  }

  worker.sseBroadcaster.broadcast({
    type: 'new_summary',
    summary: payload
  });
  worker.sseBroadcaster.emitFlow?.({
    stage: 'summary_written',
    project: payload.project,
    contentSessionId: payload.session_id,
    sessionDbId: null,
    detail: null,
    outcome: 'ok',
  });
}
