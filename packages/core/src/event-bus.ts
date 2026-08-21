import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { EventEnvelope } from '@agentdeck/protocol';

export type EventCallback<T = unknown> = (event: EventEnvelope<T>) => void | Promise<void>;

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  /**
   * Publishes an event wrapped in a standard envelope with correlation metadata.
   */
  public emit<T = unknown>(
    type: string,
    payload: T,
    metadata?: {
      correlationId?: string;
      causationId?: string;
      sessionId?: string;
      runId?: string;
      roomId?: string;
      instanceId?: string;
    }
  ): EventEnvelope<T> {
    const envelope: EventEnvelope<T> = {
      id: crypto.randomUUID(),
      type,
      version: 1,
      timestamp: new Date().toISOString(),
      correlationId: metadata?.correlationId,
      causationId: metadata?.causationId,
      sessionId: metadata?.sessionId,
      runId: metadata?.runId,
      roomId: metadata?.roomId,
      instanceId: metadata?.instanceId,
      payload,
    };

    this.emitter.emit(type, envelope);
    this.emitter.emit('*', envelope);
    return envelope;
  }

  /**
   * Subscribes to a specific event type.
   */
  public on<T = unknown>(type: string, callback: EventCallback<T>): () => void {
    const handler = (envelope: EventEnvelope<T>) => {
      void callback(envelope);
    };
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }

  /**
   * Subscribes to all events across the entire deck.
   */
  public onAny(callback: EventCallback<unknown>): () => void {
    const handler = (envelope: EventEnvelope<unknown>) => {
      void callback(envelope);
    };
    this.emitter.on('*', handler);
    return () => this.emitter.off('*', handler);
  }
}
