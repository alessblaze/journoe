// @ts-ignore: import.meta.env is injected by Vite
const API_URL = (import.meta as any).env.VITE_API_URL || 'http://localhost:8080/api';

import { refreshToken } from './api';

export type SSEEventType = 'created' | 'updated' | 'deleted';

export interface SSEEvent {
  type: SSEEventType;
  entry_id: number;
  data?: any;
}

export type SSEEventHandler = (event: SSEEvent) => void;

class SSEService {
  private abortController: AbortController | null = null;
  private handlers: Map<SSEEventType, Set<SSEEventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private _isConnected = false;
  private reconnectTimeout: number | undefined;
  private onDeadConnection: ((reason?: string) => void) | null = null;

  /** Called once when all retry attempts are exhausted and SSE gives up. */
  setDeadConnectionHandler(handler: (reason?: string) => void): void {
    this.onDeadConnection = handler;
  }

  async connect(): Promise<void> {
    if (this.abortController && !this.abortController.signal.aborted) {
      return;
    }

    // Reset retry counter on an explicit connect so forced reconnects get fresh attempts
    this.reconnectAttempts = 0;

    await this._attemptConnect();
  }

  private async _attemptConnect(): Promise<void> {
    try {
      const url = `${API_URL}/sse`;

      this.abortController = new AbortController();

      const response = await fetch(url, {
        credentials: 'include',
        signal: this.abortController.signal,
        headers: {
          'Accept': 'text/event-stream',
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          const refreshed = await refreshToken();
          if (refreshed) {
            return this._attemptConnect();
          }
          // Refresh failed (e.g. revoked token) — treat as a counted retry
          // to prevent infinite 401 → refresh-fail → reconnect loops.
          throw new Error('SSE auth failed and refresh token is invalid');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      this._isConnected = true;
      this.reconnectAttempts = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = ''; // Buffer to accumulate partial lines across chunks

      try {
        while (!this.abortController.signal.aborted) {
          const { value, done } = await reader.read();
          
          if (done) {
            throw new Error('SSE stream closed by server');
          }

          // Append decoded chunk to the buffer — a chunk may contain
          // a partial line from the previous read or multiple complete lines.
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');

          // The last element may be an incomplete line (no trailing \n),
          // so keep it in the buffer for the next chunk.
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event: SSEEvent = JSON.parse(line.slice(6));
                this.notifyHandlers(event);
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error: any) {
      this._isConnected = false;
      this.abortController = null;

      if (error.message === 'SSE auth failed and refresh token is invalid') {
        // Stop retrying if refresh token is dead (i.e., user logged out)
        if (this.onDeadConnection) {
          this.onDeadConnection('auth_revoked');
        }
        return;
      }

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        this.reconnectTimeout = window.setTimeout(() => void this._attemptConnect(), delay);
      } else {
        // All retries exhausted — notify caller so the user can be informed
        if (this.onDeadConnection) {
          this.onDeadConnection('network_failure');
        }
      }
    }
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this._isConnected = false;
  }

  on(eventType: SSEEventType, handler: SSEEventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlers = this.handlers.get(eventType)!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  private notifyHandlers(event: SSEEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch {}
      });
    }
  }

  isConnected(): boolean {
    return this._isConnected && this.abortController !== null;
  }
}

export const sseService = new SSEService();
export default sseService;
