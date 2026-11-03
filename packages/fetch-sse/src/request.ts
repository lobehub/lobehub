/**
 * Get data from request body
 * @param body - Request body
 * @returns Converted request body data
 */
export const getRequestBody = async (
  body?: BodyInit | null,
): Promise<string | ArrayBuffer | undefined> => {
  if (!body) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }
  if (body instanceof Blob) {
    return await body.arrayBuffer();
  }

  console.warn('Unsupported IPC proxy request body type:', typeof body);
  throw new Error('Unsupported IPC proxy request body type');
};
