/**
 * Wait until a chat response body yields its first chunk (or ends), and return an equivalent
 * response that replays it.
 *
 * A routed chat (`RouterRuntime`) keeps response bytes private until an attempt produces
 * visible output, so a terminal failure such as `ModelEmptyError` can error the body before a
 * single byte exists. An HTTP route that returns that body as-is lets the framework fail while
 * piping it: Next.js then answers with its generic 500 HTML page instead of the route's
 * structured error. Calling this inside the route's `try` turns such a failure into a rejection
 * the route can map to a structured error response. Failures after the first chunk still
 * surface in the body, because the response status is already committed by then.
 *
 * @throws The body error when the stream fails before yielding any chunk.
 */
export const awaitFirstResponseChunk = async (response: Response): Promise<Response> => {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const first = await reader.read();

  const body = new ReadableStream<Uint8Array>(
    {
      async cancel(reason) {
        await reader.cancel(reason);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      start(controller) {
        if (first.done) controller.close();
        else controller.enqueue(first.value);
      },
    },
    { highWaterMark: 0 },
  );

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};
