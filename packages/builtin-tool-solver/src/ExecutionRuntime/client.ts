import type { SolveServiceResponse, VerifyServiceResponse } from '../types';

/**
 * Transport-level failure categories surfaced to the agent. Deliberately
 * coarse and stable — the runtime maps them into tool errors.
 */
export type SolverServiceErrorType =
  | 'aborted'
  | 'bad_request'
  | 'network'
  | 'request_too_large'
  | 'service_error'
  | 'timeout'
  | 'unauthorized'
  | 'unknown_pack';

export class SolverServiceError extends Error {
  status?: number;
  type: SolverServiceErrorType;

  constructor(type: SolverServiceErrorType, message: string, status?: number) {
    super(message);
    this.name = 'SolverServiceError';
    this.type = type;
    this.status = status;
  }
}

export interface SolveRequestBody {
  maxCandidates?: number;
  queryId: string;
  spec: Record<string, any>;
  timeLimitMs?: number;
}

export interface VerifyRequestBody {
  plan: Record<string, any>[];
  queryId: string;
  spec: Record<string, any>;
}

/**
 * HTTP client for the solver service (POST /v1/packs/{pack}/solve|verify).
 *
 * Security invariant: the bearer key is only ever placed in the request
 * headers — never in URLs, error messages, or thrown bodies. Error messages
 * below are written assuming they reach the model and the chat UI.
 */
export class SolverServiceClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private timeoutMs: number;

  constructor(options: {
    apiKey: string;
    baseUrl: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  }) {
    if (!options.baseUrl || !options.apiKey) {
      throw new SolverServiceError(
        'service_error',
        'Solver service is not configured: SOLVER_SERVICE_URL and SOLVER_SERVICE_API_KEY are required',
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    /**
     * Generous default on purpose: the deployed service's steady-state p95 is
     * ~2.5 s of mostly network RTT, but a cold first request after a redeploy
     * can take the container start + data preload (~13 s measured) and the
     * server-side per-request solve budget defaults to 30 s. 60 s covers all
     * three without a config knob; pass timeoutMs to tighten it.
     */
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async solve(
    pack: string,
    body: SolveRequestBody,
    options?: { signal?: AbortSignal },
  ): Promise<SolveServiceResponse> {
    return this.post(`/v1/packs/${encodeURIComponent(pack)}/solve`, body, options?.signal);
  }

  async verify(
    pack: string,
    body: VerifyRequestBody,
    options?: { signal?: AbortSignal },
  ): Promise<VerifyServiceResponse> {
    return this.post(`/v1/packs/${encodeURIComponent(pack)}/verify`, body, options?.signal);
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        body: JSON.stringify(body),
        headers: {
          'authorization': `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: combinedSignal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new SolverServiceError('aborted', 'Solver service request was aborted by the caller');
      }
      if (timeoutSignal.aborted) {
        throw new SolverServiceError(
          'timeout',
          `Solver service did not respond within ${this.timeoutMs} ms`,
        );
      }
      // Network failure (DNS, refused connection, TLS). Node fetch surfaces
      // this as TypeError with a `cause`; keep the message, drop internals.
      const reason = error instanceof Error ? error.message : String(error);
      throw new SolverServiceError('network', `Cannot reach the solver service: ${reason}`);
    }

    if (response.ok) return response.json();

    const detail = await this.readDetail(response);

    switch (response.status) {
      case 400: {
        throw new SolverServiceError(
          'bad_request',
          `Solver service rejected the request: ${detail || 'bad request'}`,
          400,
        );
      }
      case 401:
      case 403: {
        throw new SolverServiceError(
          'unauthorized',
          'Solver service rejected the configured credentials — check SOLVER_SERVICE_API_KEY',
          response.status,
        );
      }
      case 404: {
        throw new SolverServiceError(
          'unknown_pack',
          `The solver service does not know this pack (404 for ${path})`,
          404,
        );
      }
      case 413: {
        throw new SolverServiceError(
          'request_too_large',
          'Solver service rejected the request body as too large (HTTP 413)',
          413,
        );
      }
      default: {
        throw new SolverServiceError(
          'service_error',
          `Solver service error (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
          response.status,
        );
      }
    }
  }

  /** Best-effort extraction of FastAPI's { detail } error body. */
  private async readDetail(response: Response): Promise<string | undefined> {
    try {
      const body = await response.json();
      const detail = (body as any)?.detail;
      return typeof detail === 'string' ? detail : undefined;
    } catch {
      return undefined;
    }
  }
}
