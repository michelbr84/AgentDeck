import { useEffect, useRef } from 'react';

export interface StreamEnvelope {
  id?: string;
  type: string;
  roomId?: string;
  runId?: string;
  instanceId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Live event stream from the deck's /ws endpoint.
 *
 * Opens one WebSocket for the component's lifetime, reconnects with
 * exponential backoff, and (re)subscribes to the given room so the server
 * only fans this socket that room's events. The handler is kept in a ref, so
 * callers can pass a fresh closure every render without re-connecting.
 */
export function useEventStream(
  roomId: string | null,
  onEvent: (envelope: StreamEnvelope) => void
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const wsRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<string | null>(roomId);

  useEffect(() => {
    let disposed = false;
    let retryDelayMs = 1000;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelayMs = 1000;
        if (roomRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe', roomId: roomRef.current }));
        }
      };
      ws.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data as string) as StreamEnvelope);
        } catch {
          // non-JSON frame — ignore
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 15000);
        }
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // Re-subscribe when the active room changes.
  useEffect(() => {
    roomRef.current = roomId;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(roomId ? { type: 'subscribe', roomId } : { type: 'unsubscribe' }));
    }
  }, [roomId]);
}
