import type { ChatAttemptObservation } from './chatAttempt';
import type { RouteAttemptFinished } from './routeAttempt';

export interface ChatStreamFallbackAttempt {
  index: number;
  observation: ChatAttemptObservation;
  onCompleted?: () => Promise<void>;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  response: Response;
}

export interface ChatStreamRetryContext {
  /** Time since the first attempt of this request started. */
  elapsedMs: number;
  /** Same-option retries already made for this request. */
  retryCount: number;
}

interface CreateChatStreamFallbackResponseOptions {
  /** Called for each terminal attempt replaced by a retry or fallback; its callbacks never run. */
  onDiscarded?: (result: RouteAttemptFinished) => void | Promise<void>;
  onSettled?: () => void;
  shouldFallback: (result: RouteAttemptFinished) => Promise<boolean>;
  /** Checked before fallback: replay the same option instead of moving to the next one. */
  shouldRetry?: (result: RouteAttemptFinished, context: ChatStreamRetryContext) => Promise<boolean>;
  startAttempt: (index: number) => Promise<ChatStreamFallbackAttempt>;
  totalAttempts: number;
}

/**
 * Keep response bytes and callbacks private until an attempt produces visible
 * output. A terminal empty or interrupted attempt can then be discarded before
 * starting the next route without mixing output from two providers.
 */
export const createChatStreamFallbackResponse = async ({
  onDiscarded,
  onSettled,
  shouldFallback,
  shouldRetry,
  startAttempt,
  totalAttempts,
}: CreateChatStreamFallbackResponseOptions): Promise<Response> => {
  const startedAt = Date.now();
  let retryCount = 0;
  let active = await startAttempt(0);
  const initialResponse = active.response;
  const responseHeaders = new Headers(initialResponse.headers);
  responseHeaders.delete('content-length');
  let bufferedChunks: Uint8Array[] = [];
  let committed = false;

  const flushBufferedChunks = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    for (const chunk of bufferedChunks) controller.enqueue(chunk);
    bufferedChunks = [];
  };

  const activateAttempt = async (index: number, discarded: RouteAttemptFinished) => {
    active.observation.discard();
    try {
      await onDiscarded?.(discarded);
    } catch (error) {
      console.error('[RouterRuntime] onDiscarded callback failed:', error);
    }
    active = await startAttempt(index);
    bufferedChunks = [];
    committed = false;
  };

  /**
   * The option index to replace an uncommitted terminal attempt with, or undefined to commit
   * it. A same-option retry keeps the channel's prompt cache, which a fallback would lose.
   */
  const resolveReplacementIndex = async (
    result: RouteAttemptFinished,
  ): Promise<number | undefined> => {
    if (
      committed ||
      active.observation.hasVisibleOutput() ||
      (result.outcome !== 'empty' && result.outcome !== 'interrupted')
    ) {
      return;
    }

    if (shouldRetry) {
      let retry = false;
      try {
        retry = await shouldRetry(result, { elapsedMs: Date.now() - startedAt, retryCount });
      } catch (error) {
        console.error('[RouterRuntime] shouldRetry callback failed:', error);
      }
      if (retry) {
        retryCount += 1;
        return active.index;
      }
    }

    if (active.index + 1 >= totalAttempts) return;
    return (await shouldFallback(result)) ? active.index + 1 : undefined;
  };

  const commitTerminalAttempt = async (result: RouteAttemptFinished) => {
    await active.observation.commit();
    if (result.outcome === 'completed') await active.onCompleted?.();
  };

  return new Response(
    new ReadableStream<Uint8Array>(
      {
        async cancel(reason) {
          try {
            await active.reader?.cancel(reason);
            await active.observation.commit();
          } finally {
            onSettled?.();
          }
        },
        async pull(controller) {
          try {
            while (true) {
              if (!active.reader) {
                const result = await active.observation.finished;
                const replacementIndex = await resolveReplacementIndex(result);
                if (replacementIndex !== undefined) {
                  await activateAttempt(replacementIndex, result);
                  continue;
                }

                await commitTerminalAttempt(result);
                if (result.outcome === 'completed') controller.close();
                else controller.error(result.error ?? new Error(`Chat attempt ${result.outcome}`));
                onSettled?.();
                return;
              }

              try {
                const { done, value } = await active.reader.read();
                if (!done) {
                  if (committed) {
                    controller.enqueue(value);
                    return;
                  }

                  bufferedChunks.push(value);
                  if (active.observation.hasVisibleOutput()) {
                    committed = true;
                    await active.observation.commit();
                    flushBufferedChunks(controller);
                    return;
                  }
                  continue;
                }

                const result = await active.observation.finished;
                const replacementIndex = await resolveReplacementIndex(result);
                if (replacementIndex !== undefined) {
                  await activateAttempt(replacementIndex, result);
                  continue;
                }

                await commitTerminalAttempt(result);
                if (result.outcome === 'completed') {
                  flushBufferedChunks(controller);
                  controller.close();
                } else {
                  controller.error(result.error ?? new Error(`Chat attempt ${result.outcome}`));
                }
                onSettled?.();
                return;
              } catch (error) {
                // A deferred consumer callback can reject before EOF. Cancelling
                // first lets the observer reach a terminal state without waiting
                // forever inside the current pull.
                try {
                  await active.reader.cancel(error);
                } catch {
                  // The reader may already be errored and the observer terminal.
                }
                const result = await active.observation.finished;
                const replacementIndex = await resolveReplacementIndex(result);
                if (replacementIndex !== undefined) {
                  await activateAttempt(replacementIndex, result);
                  continue;
                }

                await commitTerminalAttempt(result);
                controller.error(error);
                onSettled?.();
                return;
              }
            }
          } catch (error) {
            onSettled?.();
            throw error;
          }
        },
      },
      { highWaterMark: 0 },
    ),
    {
      headers: responseHeaders,
      status: initialResponse.status,
      statusText: initialResponse.statusText,
    },
  );
};
