import { getValidToken } from '../auth/refresh';
import { log } from '../utils/logger';

interface TrpcSuccessResult<T = unknown> {
  result: { data: { json: T } };
}

interface TrpcErrorResult {
  error: {
    json: {
      code: number;
      data: { code: string };
      message: string;
    };
  };
}

export class ApiClient {
  private serverUrl: string;
  private token: string;

  constructor(serverUrl: string, token: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.token = token;
  }

  static async create(): Promise<ApiClient> {
    const result = await getValidToken();
    if (!result) {
      log.error("No authentication found. Run 'lh login' first.");
      process.exit(1);
    }

    return new ApiClient(result.credentials.serverUrl, result.credentials.accessToken);
  }

  async query<T = unknown>(procedure: string, input?: unknown): Promise<T> {
    const url = new URL(`/trpc/lambda/${procedure}`, this.serverUrl);

    if (input !== undefined) {
      url.searchParams.set('input', JSON.stringify({ json: input }));
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    return this.handleResponse<T>(res, procedure);
  }

  async mutation<T = unknown>(procedure: string, input?: unknown): Promise<T> {
    const url = new URL(`/trpc/lambda/${procedure}`, this.serverUrl);

    const res = await fetch(url.toString(), {
      body: JSON.stringify(input !== undefined ? { json: input } : { json: {} }),
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    return this.handleResponse<T>(res, procedure);
  }

  private async handleResponse<T>(res: Response, procedure: string): Promise<T> {
    if (!res.ok) {
      const text = await res.text();
      log.error(`API request failed: ${procedure} (${res.status})`);
      log.debug(text);
      process.exit(1);
    }

    const body = (await res.json()) as TrpcErrorResult | TrpcSuccessResult<T>;

    if ('error' in body) {
      const err = body.error.json;
      log.error(`${procedure}: ${err.message} (${err.data.code})`);
      process.exit(1);
    }

    return body.result.data.json;
  }
}
