/**
 * 从请求体中获取数据
 * @param body - 请求体
 * @returns 转换后的请求体数据
 */
export const getRequestBody = async (
  // eslint-disable-next-line no-undef
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

  console.warn('不支持的 IPC 代理请求体类型:', typeof body);
  throw new Error('不支持的 IPC 代理请求体类型');
};
