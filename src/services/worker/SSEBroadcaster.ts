
import type { Response } from 'express';
import { logger } from '../../utils/logger.js';
import type { SSEEvent, SSEClient } from '../worker-types.js';
import { AgentFlowBuffer, type AgentFlowEvent, type AgentFlowEventInput } from './events/AgentFlowBuffer.js';

export class SSEBroadcaster {
  private sseClients: Set<SSEClient> = new Set();
  private flowBuffer = new AgentFlowBuffer();

  addClient(res: Response): void {
    this.sseClients.add(res);
    logger.debug('WORKER', 'Client connected', { total: this.sseClients.size });

    res.on('close', () => {
      this.removeClient(res);
    });

    this.sendToClient(res, { type: 'connected', timestamp: Date.now() });

    // Replay before any live event can arrive, so the viewer never has to
    // reconcile a backlog that overlaps what it already rendered.
    const backlog = this.flowBuffer.backlog();
    if (backlog.length > 0) {
      this.sendToClient(res, { type: 'flow_backlog', events: backlog });
    }
  }

  /**
   * Record one Agent Flow event and push it to every connected viewer.
   *
   * Unlike broadcast(), this stores even when nobody is listening: the ring is
   * what a viewer opened thirty seconds from now will replay.
   */
  emitFlow(input: AgentFlowEventInput): AgentFlowEvent {
    const event = this.flowBuffer.record(input);
    if (this.sseClients.size > 0) {
      const data = `data: ${JSON.stringify({ type: 'flow_event', event, timestamp: event.at })}\n\n`;
      for (const client of this.sseClients) {
        client.write(data);
      }
    }
    return event;
  }

  getFlowBacklog(): AgentFlowEvent[] {
    return this.flowBuffer.backlog();
  }

  removeClient(res: Response): void {
    this.sseClients.delete(res);
    logger.debug('WORKER', 'Client disconnected', { total: this.sseClients.size });
  }

  broadcast(event: SSEEvent): void {
    if (this.sseClients.size === 0) {
      logger.debug('WORKER', 'SSE broadcast skipped (no clients)', { eventType: event.type });
      return; 
    }

    const eventWithTimestamp = { ...event, timestamp: Date.now() };
    const data = `data: ${JSON.stringify(eventWithTimestamp)}\n\n`;

    logger.debug('WORKER', 'SSE broadcast sent', { eventType: event.type, clients: this.sseClients.size });

    for (const client of this.sseClients) {
      client.write(data);
    }
  }

  getClientCount(): number {
    return this.sseClients.size;
  }

  private sendToClient(res: Response, event: SSEEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    res.write(data);
  }
}
