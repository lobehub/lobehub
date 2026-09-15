import { randomUUID } from 'node:crypto';

import type {
  ProviderImportErrorCode,
  ProviderImportPayload,
  ProviderImportPreview,
  ProviderImportRequest,
} from '@lobechat/electron-client-ipc';
import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';

import { createLogger } from '@/utils/logger';

import { ControllerModule, createProtocolHandler, IpcMethod } from '.';

const logger = createLogger('controllers:ProviderImportCtr');
const protocolHandler = createProtocolHandler('provider');

const CALLBACK_TIMEOUT_MS = 10_000;
const PENDING_IMPORT_TTL_MS = 2 * 60_000;
const MAX_CALLBACK_BYTES = 256 * 1024;
const MAX_MODEL_ID_LENGTH = 150;
const MAX_MODEL_DISPLAY_NAME_LENGTH = 200;
const CALLBACK_PATH_PATTERN = /^\/lobehub\/provider-import\/[\w-]{32,128}$/;
const PROVIDER_ID_PATTERN = /^[\d_a-z](?:[\d_a-z-]{0,62}[\d_a-z])?$/;
const directLoopbackDispatcher = new Agent();

const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const boundedIdentifier = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim() && !hasControlCharacter(value));

const baseURLSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);

    if (url.username || url.password || url.hash) return false;

    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
    );
  });

const logoSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  });

export const ProviderImportPayloadSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            contextWindowTokens: z.number().int().positive().max(100_000_000).optional(),
            displayName: boundedIdentifier(MAX_MODEL_DISPLAY_NAME_LENGTH).optional(),
            id: boundedIdentifier(MAX_MODEL_ID_LENGTH),
          })
          .strict(),
      )
      .max(256),
    provider: z
      .object({
        apiKey: z.string().min(1).max(8192),
        baseURL: baseURLSchema,
        checkModel: boundedIdentifier(MAX_MODEL_ID_LENGTH).optional(),
        description: z.string().max(512).optional(),
        enableResponsesApi: z.boolean().optional(),
        fetchOnClient: z.boolean().optional(),
        id: z.string().regex(PROVIDER_ID_PATTERN).max(64),
        logo: logoSchema.optional(),
        name: boundedIdentifier(128),
      })
      .strict(),
    version: z.literal(1),
  })
  .strict()
  .superRefine(({ models, provider }, context) => {
    const ids = new Set<string>();

    for (const [index, model] of models.entries()) {
      if (ids.has(model.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate model ID',
          path: ['models', index, 'id'],
        });
      }
      ids.add(model.id);
    }

    if (provider.checkModel && !ids.has(provider.checkModel)) {
      context.addIssue({
        code: 'custom',
        message: 'checkModel must be included in models',
        path: ['provider', 'checkModel'],
      });
    }
  });

class ProviderImportFetchError extends Error {
  constructor(readonly code: Exclude<ProviderImportErrorCode, 'invalid_callback'>) {
    super(code);
  }
}

export const parseProviderImportCallback = (value: string): URL | undefined => {
  try {
    const url = new URL(value);
    const isLoopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';

    if (
      url.protocol !== 'http:' ||
      !isLoopback ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !CALLBACK_PATH_PATTERN.test(url.pathname)
    ) {
      return;
    }

    return url;
  } catch {
    return;
  }
};

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_CALLBACK_BYTES
    ) {
      throw new ProviderImportFetchError('invalid_payload');
    }
  }

  if (!response.body) throw new ProviderImportFetchError('invalid_payload');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    length += value.byteLength;
    if (length > MAX_CALLBACK_BYTES) {
      await reader.cancel();
      throw new ProviderImportFetchError('invalid_payload');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
};

export const fetchProviderImportPayload = async (callback: URL): Promise<ProviderImportPayload> => {
  let response: Response;

  try {
    response = (await undiciFetch(callback, {
      cache: 'no-store',
      dispatcher: directLoopbackDispatcher,
      headers: { accept: 'application/vnd.lobehub.provider-import+json; version=1' },
      redirect: 'error',
      signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
    })) as unknown as Response;
  } catch {
    throw new ProviderImportFetchError('callback_failed');
  }

  if (!response.ok) throw new ProviderImportFetchError('callback_failed');

  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/vnd.lobehub.provider-import+json'
  ) {
    throw new ProviderImportFetchError('invalid_payload');
  }

  try {
    const body = await readBoundedBody(response);
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    return ProviderImportPayloadSchema.parse(json);
  } catch (error) {
    if (error instanceof ProviderImportFetchError) throw error;
    throw new ProviderImportFetchError('invalid_payload');
  }
};

interface ProviderImportParams {
  callback?: string;
}

export default class ProviderImportController extends ControllerModule {
  static override readonly groupName = 'providerImport';

  private readonly pendingImports = new Map<
    string,
    { expiresAt: number; payload: ProviderImportPayload }
  >();
  private readonly pendingErrors = new Map<
    string,
    { errorCode: ProviderImportErrorCode; expiresAt: number }
  >();

  private deletePendingRequest(requestId: string) {
    this.pendingImports.delete(requestId);
    this.pendingErrors.delete(requestId);
  }

  private storePendingImport(payload: ProviderImportPayload): ProviderImportPreview {
    const requestId = randomUUID();
    const expiresAt = Date.now() + PENDING_IMPORT_TTL_MS;
    this.pendingImports.set(requestId, { expiresAt, payload });

    const timeout = setTimeout(() => this.deletePendingRequest(requestId), PENDING_IMPORT_TTL_MS);
    timeout.unref?.();

    const { apiKey: _apiKey, ...provider } = payload.provider;
    return { modelCount: payload.models.length, provider, requestId };
  }

  private storePendingError(errorCode: ProviderImportErrorCode): ProviderImportRequest {
    const requestId = randomUUID();
    const expiresAt = Date.now() + PENDING_IMPORT_TTL_MS;
    this.pendingErrors.set(requestId, { errorCode, expiresAt });

    const timeout = setTimeout(() => this.deletePendingRequest(requestId), PENDING_IMPORT_TTL_MS);
    timeout.unref?.();

    return { errorCode, requestId, status: 'error' };
  }

  @IpcMethod()
  public cancel(requestId: string): void {
    this.deletePendingRequest(requestId);
  }

  @IpcMethod()
  public consume(requestId: string): ProviderImportPayload | undefined {
    const pending = this.pendingImports.get(requestId);
    this.deletePendingRequest(requestId);

    if (!pending || pending.expiresAt <= Date.now()) return;
    return pending.payload;
  }

  @IpcMethod()
  public listPending(): ProviderImportRequest[] {
    const now = Date.now();
    const requests: ProviderImportRequest[] = [];

    for (const [requestId, pending] of this.pendingImports) {
      if (pending.expiresAt <= now) {
        this.deletePendingRequest(requestId);
        continue;
      }

      const { apiKey: _apiKey, ...provider } = pending.payload.provider;
      requests.push({
        preview: { modelCount: pending.payload.models.length, provider, requestId },
        status: 'ready',
      });
    }

    for (const [requestId, pending] of this.pendingErrors) {
      if (pending.expiresAt <= now) {
        this.deletePendingRequest(requestId);
        continue;
      }

      requests.push({ errorCode: pending.errorCode, requestId, status: 'error' });
    }

    return requests;
  }

  @protocolHandler('import')
  private async handleImportRequest(params: ProviderImportParams): Promise<boolean> {
    if (!this.app?.browserManager) return false;

    let request: ProviderImportRequest;
    const callback = params.callback ? parseProviderImportCallback(params.callback) : undefined;

    if (!callback) {
      request = this.storePendingError('invalid_callback');
    } else {
      try {
        const payload = await fetchProviderImportPayload(callback);
        request = { preview: this.storePendingImport(payload), status: 'ready' };
      } catch (error) {
        const errorCode =
          error instanceof ProviderImportFetchError ? error.code : ('callback_failed' as const);
        logger.warn('Provider import callback failed', { errorCode });
        request = this.storePendingError(errorCode);
      }
    }

    this.app.browserManager.broadcastToWindow('app', 'providerImportRequest', request);
    return true;
  }
}
