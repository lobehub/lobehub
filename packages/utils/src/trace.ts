import type { TracePayload } from '@lobechat/const';
import { LOBE_CHAT_TRACE_HEADER, LOBE_CHAT_TRACE_ID } from '@lobechat/const';

export const getTracePayload = (req: Request): TracePayload | undefined => {
  const header = req.headers.get(LOBE_CHAT_TRACE_HEADER);
  if (!header) return;

  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    // Ignore malformed trace header - return undefined to skip tracing
    return undefined;
  }
};

export const getTraceId = (res: Response) => res.headers.get(LOBE_CHAT_TRACE_ID);

const createTracePayload = (data: TracePayload) => {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(JSON.stringify(data));

  return Buffer.from(buffer).toString('base64');
};

export const createTraceHeader = (data: TracePayload) => {
  return { [LOBE_CHAT_TRACE_HEADER]: createTracePayload(data) };
};
