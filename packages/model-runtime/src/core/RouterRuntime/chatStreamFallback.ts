import type { ChatAttemptObservation } from './chatAttempt';
import type { RouteAttemptFinished } from './routeAttempt';

export interface ChatStreamFallbackAttempt {
  index: number;
  observation: ChatAttemptObservation;
  onCompleted?: () => Promise<void>;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  response: Response;
}

interface CreateChatStreamFallbackResponseOptions {
  shouldFallback: (result: RouteAttemptFinished) => Promise<boolean>;
  startAttempt: (index: number) => Promise<ChatStreamFallbackAttempt>;
  totalAttempts: number;
}

/**
 * Keep response bytes and callbacks private until an attempt produces visible
 * output. A terminal empty or interrupted attempt can then be discarded before
 * starting the next route without mixing output from two providers.
 */
export const createChatStreamFallbackResponse = async ({
  shouldFallback,
  startAttempt,
  totalAttempts,
}: CreateChatStreamFallbackResponseOptions): Promise<Response> => {
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

  const activateNextAttempt = async () => {
    active.observation.discard();
    active = await startAttempt(active.index + 1);
    bufferedChunks = [];
    committed = false;
  };

  const shouldFallbackTerminalAttempt = async (result: RouteAttemptFinished) => {
    if (
      committed ||
      active.observation.hasVisibleOutput() ||
      active.index + 1 >= totalAttempts ||
      (result.outcome !== 'empty' && result.outcome !== 'interrupted')
    ) {
      return false;
    }

    return shouldFallback(result);
  };

  const commitTerminalAttempt = async (result: RouteAttemptFinished) => {
    await active.observation.commit();
    if (result.outcome === 'completed') await active.onCompleted?.();
  };

  return new Response(
    new ReadableStream<Uint8Array>(
      {
        async cancel(reason) {
          await active.reader?.cancel(reason);
          await active.observation.commit();
        },
        async pull(controller) {
          while (true) {
            if (!active.reader) {
              const result = await active.observation.finished;
              if (await shouldFallbackTerminalAttempt(result)) {
                await activateNextAttempt();
                continue;
              }

              await commitTerminalAttempt(result);
              if (result.outcome === 'completed') controller.close();
              else controller.error(result.error ?? new Error(`Chat attempt ${result.outcome}`));
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
              if (await shouldFallbackTerminalAttempt(result)) {
                await activateNextAttempt();
                continue;
              }

              await commitTerminalAttempt(result);
              if (result.outcome === 'completed') {
                flushBufferedChunks(controller);
                controller.close();
              } else {
                controller.error(result.error ?? new Error(`Chat attempt ${result.outcome}`));
              }
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
              if (await shouldFallbackTerminalAttempt(result)) {
                await activateNextAttempt();
                continue;
              }

              await commitTerminalAttempt(result);
              controller.error(error);
              return;
            }
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
