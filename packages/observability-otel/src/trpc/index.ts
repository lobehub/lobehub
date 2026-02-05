import type { Attributes } from '@opentelemetry/api';

import { TRPCAttribute } from './convention';

export const DEFAULT_ERROR_CODE = 'UNKNOWN_ERROR';
export const DEFAULT_SUCCESS_STATUS = 'OK';

const textEncoder = new TextEncoder();

export function parseTRPCPath(path: string) {
  const parts = path?.split('.') ?? [];
  if (parts.length <= 1) {
    return { method: path, service: undefined };
  }

  const method = parts.at(-1);
  const service = parts.slice(0, -1).join('.').split('/').pop();
  return { method, service };
}

export function tRPCConventionFromPathAndType(path: string, type: string): Attributes {
  const { method, service } = parseTRPCPath(path);

  const attributes: Attributes = {
    [TRPCAttribute.RPC_SYSTEM]: 'trpc',
    [TRPCAttribute.RPC_TRPC_PATH]: path,
    [TRPCAttribute.RPC_TRPC_TYPE]: type,
  };

  if (service) {
    attributes[TRPCAttribute.RPC_SERVICE] = service;
  }
  if (method) {
    attributes[TRPCAttribute.RPC_METHOD] = method;
  }

  return attributes;
}

export const getPayloadSize = (payload: unknown): number | undefined => {
  if (payload === undefined || payload === null) return undefined;

  try {
    const serialized = JSON.stringify(payload);
    return textEncoder.encode(serialized).length;
  } catch {
    return undefined;
  }
};

export const createAttributesForMetrics = (
  baseAttributes: Attributes,
  statusCode: string,
  extraAttributes?: Attributes,
): Attributes => ({
  ...baseAttributes,
  [TRPCAttribute.RPC_TRPC_STATUS_CODE]: statusCode,
  ...extraAttributes,
});

export * from './convention';
export * from './metrics';
