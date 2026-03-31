/**
 * Market Auth Event System
 *
 * Provides a simple event-based communication mechanism for handling
 * Market API 401 errors across the application.
 */

export type MarketAuthEventType = 'market-unauthorized';

export interface MarketUnauthorizedEvent {
  path: string;
  timestamp: number;
}

type EventCallback = (event: MarketUnauthorizedEvent) => void;

class MarketAuthEventEmitter {
  private listeners: Map<MarketAuthEventType, Set<EventCallback>> = new Map();

  on(event: MarketAuthEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event: MarketAuthEventType, data: MarketUnauthorizedEvent): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error('[MarketAuthEvents] Error in event callback:', error);
      }
    });
  }
}

export const marketAuthEvents = new MarketAuthEventEmitter();
