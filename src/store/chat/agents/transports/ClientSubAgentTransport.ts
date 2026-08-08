import type { SubAgentExecutionResult, SubAgentTransport } from '@lobechat/agent-runtime';
import type { ExecSubAgentParams, ExecVirtualSubAgentParams } from '@lobechat/types';

import { aiAgentService } from '@/services/aiAgent';
import type { ChatStore } from '@/store/chat/store';

const DEFAULT_TIMEOUT_MS = 1_800_000;
const POLL_INTERVAL_MS = 3000;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

const waitForNextPoll = (delayMs: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener('abort', onAbort, { once: true });
  });
};

/** Client adapter that waits for a server-backed sub-agent task to finish. */
export class ClientSubAgentTransport implements SubAgentTransport {
  constructor(
    private readonly get: () => ChatStore,
    private readonly operationId: string,
  ) {}

  execSubAgent(params: ExecSubAgentParams): Promise<SubAgentExecutionResult> {
    return this.execute(params);
  }

  execVirtualSubAgent(params: ExecVirtualSubAgentParams): Promise<SubAgentExecutionResult> {
    return this.execute(params);
  }

  private async execute(params: ExecSubAgentParams): Promise<SubAgentExecutionResult> {
    let dispatchResult: Awaited<ReturnType<typeof aiAgentService.execSubAgentTask>> | undefined;
    let interruptPromise: Promise<void> | undefined;
    const interrupt = () => {
      if (!interruptPromise) {
        interruptPromise = (async () => {
          if (!dispatchResult?.threadId) return;

          try {
            await aiAgentService.interruptTask({ threadId: dispatchResult.threadId });
          } catch {
            // The terminal result still needs to reach the parent when interruption fails.
          }
        })();
      }

      return interruptPromise;
    };

    try {
      dispatchResult = await aiAgentService.execSubAgentTask(params);
      if (!dispatchResult.success) {
        return {
          ...dispatchResult,
          error: dispatchResult.error ?? 'Sub-agent dispatch failed',
          status: 'failed',
        };
      }

      const operation = this.get().operations[this.operationId];
      if (!operation) throw new Error(`Operation not found: ${this.operationId}`);

      const signal = operation.abortController.signal;
      const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;
      const startedAt = Date.now();

      const onAbort = () => void interrupt();
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        while (Date.now() - startedAt < timeoutMs) {
          const currentOperation = this.get().operations[this.operationId];
          if (signal.aborted || currentOperation?.status === 'cancelled') {
            await interrupt();
            return {
              ...dispatchResult,
              error: 'Operation cancelled',
              status: 'cancelled',
              success: false,
            };
          }

          const taskStatus = await aiAgentService.getSubAgentTaskStatus({
            threadId: dispatchResult.threadId,
          });

          if (signal.aborted || this.get().operations[this.operationId]?.status === 'cancelled') {
            await interrupt();
            return {
              ...dispatchResult,
              error: 'Operation cancelled',
              status: 'cancelled',
              success: false,
            };
          }

          if (taskStatus.taskDetail) {
            this.get().internal_dispatchMessage(
              {
                id: params.parentMessageId,
                type: 'updateMessage',
                value: { taskDetail: taskStatus.taskDetail },
              },
              { operationId: this.operationId },
            );
          }

          if (taskStatus.status === 'completed') {
            return {
              ...dispatchResult,
              result: taskStatus.result,
              status: 'completed',
              success: true,
            };
          }

          if (taskStatus.status === 'failed') {
            return {
              ...dispatchResult,
              error: taskStatus.error ?? 'Unknown error',
              status: 'failed',
              success: false,
            };
          }

          if (taskStatus.status === 'cancel') {
            return {
              ...dispatchResult,
              error: 'Task was cancelled',
              status: 'cancelled',
              success: false,
            };
          }

          const remainingMs = timeoutMs - (Date.now() - startedAt);
          await waitForNextPoll(Math.min(POLL_INTERVAL_MS, remainingMs), signal);
        }

        await interrupt();
        return {
          ...dispatchResult,
          error: `Task timeout after ${timeoutMs}ms`,
          status: 'timed_out',
          success: false,
        };
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    } catch (error) {
      if (dispatchResult?.success) await interrupt();

      return {
        assistantMessageId: dispatchResult?.assistantMessageId ?? '',
        error: getErrorMessage(error),
        operationId: dispatchResult?.operationId ?? '',
        status: 'failed',
        success: false,
        threadId: dispatchResult?.threadId ?? '',
      };
    }
  }
}
