import type { IStreamEventManager } from './types';

/** An `IStreamEventManager` that records each call and resolves `<method>-result`. */
export function createMockInner(): IStreamEventManager & { calls: Record<string, any[][]> } {
  const calls: Record<string, any[][]> = {};

  const track = (name: string) => {
    calls[name] = [];
    return (...args: any[]) => {
      calls[name].push(args);
      return Promise.resolve(`${name}-result`);
    };
  };

  return {
    calls,
    cleanupOperation: track('cleanupOperation') as any,
    disconnect: track('disconnect') as any,
    getActiveOperationsCount: track('getActiveOperationsCount') as any,
    getStreamHistory: track('getStreamHistory') as any,
    getStreamHistoryPage: track('getStreamHistoryPage') as any,
    publishAgentRuntimeEnd: track('publishAgentRuntimeEnd') as any,
    publishAgentRuntimeInit: track('publishAgentRuntimeInit') as any,
    publishStreamChunk: track('publishStreamChunk') as any,
    publishStreamEvent: track('publishStreamEvent') as any,
    readEventsOnce: track('readEventsOnce') as any,
    subscribeStreamEvents: track('subscribeStreamEvents') as any,
  };
}
