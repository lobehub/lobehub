/**
 * Convert async iterator to JSON format ReadableStream
 */
export const createModelPullStream = <
  T extends { completed?: number; digest?: string; status: string; total?: number },
>(
  iterable: AsyncIterable<T>,
  model: string,
  {
    onCancel, // Added: callback function to call on cancellation
  }: {
    onCancel?: (reason?: any) => void; // Callback function signature
  } = {},
): ReadableStream => {
  let iterator: AsyncIterator<T>; // Track iterator externally so we can call return on cancellation

  return new ReadableStream({
    // Implement cancel method
    cancel(reason) {
      // Call the onCancel callback to execute external cleanup logic (e.g., client.abort())
      if (onCancel) {
        onCancel(reason);
      }

      // Attempt to gracefully terminate the iterator
      // Note: This depends on whether the AsyncIterable implementation supports return/throw
      if (iterator && typeof iterator.return === 'function') {
        // No need to await, let it execute cleanup in the background
        iterator.return().catch();
      }
    },
    async start(controller) {
      iterator = iterable[Symbol.asyncIterator](); // Get iterator

      const encoder = new TextEncoder();

      try {
        while (true) {
          // Wait for the next data chunk or iteration completion
          const { value: progress, done } = await iterator.next();

          // If iteration is complete, break the loop
          if (done) {
            break;
          }

          // Ignore 'pulling manifest' status as it does not contain progress
          if (progress.status === 'pulling manifest') continue;

          // Format to standard format and write to stream
          const progressData =
            JSON.stringify({
              completed: progress.completed,
              digest: progress.digest,
              model,
              status: progress.status,
              total: progress.total,
            }) + '\n';

          controller.enqueue(encoder.encode(progressData));
        }

        // Normal completion
        controller.close();
      } catch (error) {
        // Handle errors

        // If error is caused by abort operation, handle silently or log, then try to close stream
        if (error instanceof DOMException && error.name === 'AbortError') {
          // No need to enqueue error message as connection may already be disconnected
          // Try to close normally; if already cancelled, controller may be closed or errored
          try {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ status: 'cancelled' })));
            controller.close();
          } catch {
            // Ignore close errors, stream may already be handled by cancellation mechanism
          }
        } else {
          console.error('[createModelPullStream] model download stream error:', error);
          // For other errors, try to send error message to client
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorData =
            JSON.stringify({
              error: errorMessage,
              model,
              status: 'error',
            }) + '\n';

          try {
            // Only try to enqueue if stream is still expecting data
            if (controller.desiredSize !== null && controller.desiredSize > 0) {
              controller.enqueue(encoder.encode(errorData));
            }
          } catch (enqueueError) {
            console.error('[createModelPullStream] Error enqueueing error message:', enqueueError);
            // If this also fails, connection is likely disconnected
          }

          // Try to close stream or mark as error state
          try {
            controller.close(); // Try to close normally
          } catch {
            controller.error(error); // If closing fails, put stream in error state
          }
        }
      }
    },
  });
};
