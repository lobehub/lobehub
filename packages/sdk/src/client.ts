import { DEFAULT_BASE_URL } from './constants';
import { toLobeHubError } from './errors';
import type { Client, Config, RequestResult } from './generated/client';
import { createClient, createConfig } from './generated/client';
import type { Generations, Options } from './generated/sdk.gen';
import { Files, LobeHub, Responses } from './generated/sdk.gen';
import type {
  PostApiV1FilesErrors,
  PostApiV1FilesResponses,
  PostApiV1ResponsesData,
} from './generated/types.gen';
import { GenerationsResource } from './generations';
import type { PageItem, PageOf, PaginateOptions } from './pagination';
import { paginate } from './pagination';
import { ResponseStream } from './streaming';
import {
  createTransport,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT,
  IDEMPOTENCY_KEY_HEADER,
  requestSettings,
} from './transport';
import type { Uploadable, UploadOptions } from './uploads';
import { toUploadFile } from './uploads';

export const WORKSPACE_HEADER = 'X-Workspace-Id';

export interface LobeHubOptions<ThrowOnError extends boolean = false> extends Omit<
  Config,
  'auth' | 'baseUrl' | 'throwOnError'
> {
  /**
   * Called before every request for the OIDC access token to send. Refresh it
   * here (see `refreshAccessToken`) so long-lived clients never send an expired
   * one. Takes precedence over `apiKey`.
   */
  accessToken?: () => Promise<string> | string;
  /** LobeHub API Key (`sk-lh-...`) or an OIDC JWT */
  apiKey?: string;
  /** API origin, defaults to LobeHub Cloud (`https://app.lobehub.com`) */
  baseURL?: string;
  /**
   * Throw `LobeHubAPIError` instead of returning `{ error }`. Every method's
   * return type follows: `{ data, request, response }` with `data` always set.
   */
  throwOnError?: ThrowOnError;
  /** Sent as `X-Workspace-Id` on every request: act inside this workspace. */
  workspaceId?: string;
}

/** The `responses.create` body; `stream` is forced on. */
type CreateResponseBody = PostApiV1ResponsesData['body'];

export type ResponseStreamOptions = Omit<
  Options<PostApiV1ResponsesData, true>,
  'body' | 'parseAs' | 'throwOnError'
>;

/** `lobehub.responses`, plus `stream()` for typed server-sent events. */
export class ResponsesResource extends Responses {
  /**
   * Start a response with `stream: true` and iterate its typed events:
   *
   * ```ts
   * for await (const event of lobehub.responses.stream({ input, model })) {
   *   if (event.type === 'response.output_text.delta') process.stdout.write(event.delta);
   * }
   * ```
   */
  stream(body: CreateResponseBody, options: ResponseStreamOptions = {}): ResponseStream {
    return new ResponseStream(async (signal) => {
      const { response } = await this.create({
        ...options,
        body: { ...body, stream: true },
        client: options.client ?? this.client,
        // Closing the stream must not abort a caller-owned signal, and vice versa.
        signal: options.signal ? anySignal([options.signal, signal]) : signal,
        parseAs: 'stream',
        // The helper reads `{ response }`: a client configured for data-only
        // results must not change its own internals.
        responseStyle: 'fields',
        throwOnError: true,
      });
      if (!response.body) throw new Error('The streaming response has no body');
      return response.body;
    });
  }
}

export type UploadRequestOptions<ThrowOnError extends boolean> = Omit<
  Options<never, ThrowOnError>,
  'body' | 'path' | 'query'
>;

/** `lobehub.files`, plus `upload()` for any file source. */
export class FilesResource extends Files {
  /**
   * Upload a `File` / `Blob`, raw bytes (`Buffer`, `Uint8Array`,
   * `ArrayBuffer`) or a local file path:
   *
   * ```ts
   * const { data } = await lobehub.files.upload('./report.pdf', { knowledgeBaseId });
   * ```
   */
  upload<ThrowOnError extends boolean = false>(
    source: Uploadable,
    options: UploadOptions & UploadRequestOptions<ThrowOnError> = {},
  ): RequestResult<PostApiV1FilesResponses, PostApiV1FilesErrors, ThrowOnError> {
    const {
      agentId,
      directory,
      knowledgeBaseId,
      name,
      sessionId,
      skipCheckFileType,
      skipDeduplication,
      type,
      ...requestOptions
    } = options;

    type Result = RequestResult<PostApiV1FilesResponses, PostApiV1FilesErrors, ThrowOnError>;
    return toUploadFile(source, { name, type }).then(
      (file): Awaited<Result> =>
        this.create<ThrowOnError>({
          ...requestOptions,
          body: {
            agentId,
            directory,
            file,
            knowledgeBaseId,
            sessionId,
            skipCheckFileType,
            skipDeduplication,
          },
        }) as unknown as Awaited<Result>,
    ) as Result;
  }
}

/**
 * Abort when any of `signals` does. `AbortSignal.any` keeps no strong
 * reference to the inputs, so a long-lived caller signal reused across many
 * streams does not accumulate listeners; the fallback is for hosts without it.
 */
const anySignal = (signals: AbortSignal[]) => {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    });
  }
  return controller.signal;
};

/**
 * The resource-style client returned by `createLobeHub`: every generated
 * resource (`lobehub.agents`, `lobehub.topics`, …) plus `paginate`,
 * `responses.stream`, `files.upload` and `generations.wait`.
 */
export class LobeHubClient extends LobeHub {
  readonly #client: Client;
  #files?: FilesResource;
  #generations?: GenerationsResource;
  #responses?: ResponsesResource;

  constructor(args: { client: Client; key?: string }) {
    super(args);
    this.#client = args.client;
  }

  override get files(): FilesResource {
    return (this.#files ??= new FilesResource({ client: this.#client }));
  }

  override get generations(): GenerationsResource {
    return (this.#generations ??= new GenerationsResource({ client: this.#client }));
  }

  override get responses(): ResponsesResource {
    return (this.#responses ??= new ResponsesResource({ client: this.#client }));
  }

  /**
   * Iterate every item of a cursor-paginated list across pages:
   *
   * ```ts
   * for await (const agent of lobehub.paginate(lobehub.agents.list, { query: { limit: 50 } })) {
   *   console.log(agent.id);
   * }
   * ```
   */
  paginate<M extends (options: any) => Promise<any>>(
    method: M,
    options?: PaginateOptions<M>,
  ): AsyncGenerator<PageItem<PageOf<M>>> {
    return paginate(this.#client, method, options);
  }
}

// ---------- throwOnError typing ----------

type ThrowingOptions<O> = O extends object ? Omit<O, 'throwOnError'> & { throwOnError?: true } : O;

/** The `throwOnError: true` variant of a generated method: same arguments, `data` always set. */
type ThrowingMethod<F> = F extends (...args: infer Args) => Promise<infer Result>
  ? (
      ...args: { [I in keyof Args]: ThrowingOptions<Args[I]> }
    ) => Promise<Extract<Result, { request: Request; response: Response }>>
  : F;

type ThrowingResource<R> = { [K in keyof R]: ThrowingMethod<R[K]> };

/** `LobeHubClient` whose methods all reject with `LobeHubAPIError` and always return `data`. */
export type ThrowingLobeHubClient = {
  [K in keyof LobeHubClient]: K extends 'paginate'
    ? LobeHubClient[K]
    : K extends 'responses'
      ? ThrowingResource<ResponsesResource> & Pick<ResponsesResource, 'stream'>
      : K extends 'files'
        ? ThrowingResource<Files> & {
            upload: (
              source: Uploadable,
              options?: UploadOptions & UploadRequestOptions<true>,
            ) => RequestResult<PostApiV1FilesResponses, PostApiV1FilesErrors, true>;
          }
        : K extends 'generations'
          ? ThrowingResource<Generations> & Pick<GenerationsResource, 'wait'>
          : ThrowingResource<LobeHubClient[K]>;
};

/**
 * Create a resource-style LobeHub API client: `lobehub.agents.list()`,
 * `lobehub.files.upload()`, `lobehub.users.me()`, …
 *
 * Resources, methods, and schemas are generated from
 * `packages/openapi/openapi.yml` — run `bun generate` after the spec changes.
 */
export function createLobeHub(options: LobeHubOptions<false>): LobeHubClient;
export function createLobeHub(options: LobeHubOptions<true>): ThrowingLobeHubClient;
export function createLobeHub(
  options: LobeHubOptions<boolean>,
): LobeHubClient | ThrowingLobeHubClient {
  const {
    accessToken,
    apiKey,
    baseURL = DEFAULT_BASE_URL,
    fetch: baseFetch = globalThis.fetch,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeout = DEFAULT_TIMEOUT,
    workspaceId,
    ...clientConfig
  } = options;
  if (!accessToken && !apiKey)
    throw new Error('createLobeHub needs an apiKey or an accessToken provider');

  const client = createClient(
    createConfig({
      ...clientConfig,
      auth: accessToken ? () => accessToken() : () => apiKey,
      baseUrl: baseURL,
      fetch: createTransport((...args) => baseFetch(...args), { maxRetries, timeout }),
      maxRetries,
      timeout,
    }),
  );

  client.interceptors.request.use((request, requestOptions) => {
    // A per-call `X-Workspace-Id` header still wins over the client default.
    if (workspaceId && !request.headers.has(WORKSPACE_HEADER))
      request.headers.set(WORKSPACE_HEADER, workspaceId);
    if (requestOptions.idempotencyKey)
      request.headers.set(IDEMPOTENCY_KEY_HEADER, requestOptions.idempotencyKey);
    requestSettings.set(request, {
      maxRetries: requestOptions.maxRetries ?? maxRetries,
      // `parseAs: 'stream'` asks for the SSE body: keep the transport from
      // resending a request whose answer cannot be replayed.
      streaming: requestOptions.parseAs === 'stream',
      timeout: requestOptions.timeout ?? timeout,
    });
    return request;
  });
  client.interceptors.error.use((error, response) => toLobeHubError(error, response));

  return new LobeHubClient({ client });
}
