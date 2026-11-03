export const createReadableStream = <T>(chunks: T[]) =>
  new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));

      controller.close();
    },
  });

export const readStreamChunk = async (stream: ReadableStream) => {
  const decoder = new TextDecoder();
  const chunks = [];

  // @ts-ignore
  for await (const chunk of stream) {
    chunks.push(decoder.decode(chunk, { stream: true }));
  }

  return chunks;
};
