import { appEnv } from '@/envs/app';

export interface PageRoomState {
  bootstrapped: boolean;
  epoch: string;
  update: Uint8Array;
}

export class PageRoomConflictError extends Error {
  constructor() {
    super('Page room was bootstrapped by another collaborator');
    this.name = 'PageRoomConflictError';
  }
}

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

export class PageRoomClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  async getState(documentId: string): Promise<PageRoomState> {
    const url = new URL('/api/documents/state', this.baseUrl);
    url.searchParams.set('documentId', documentId);
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Page room state failed: ${res.status}`);
    const body = (await res.json()) as { bootstrapped: boolean; epoch: string; update: string };
    return { bootstrapped: body.bootstrapped, epoch: body.epoch, update: fromBase64(body.update) };
  }

  async pushUpdate(
    documentId: string,
    update: Uint8Array,
    options: { actor?: string; bootstrap?: boolean } = {},
  ): Promise<void> {
    const res = await fetch(new URL('/api/documents/update', this.baseUrl), {
      body: JSON.stringify({ documentId, update: toBase64(update), ...options }),
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (res.status === 409) throw new PageRoomConflictError();
    if (!res.ok) throw new Error(`Page room update failed: ${res.status}`);
  }

  private headers() {
    return { Authorization: `Bearer ${this.serviceToken}` };
  }
}

const toHttpBase = (url: string) => url.replace(/^ws(s?):\/\//, 'http$1://');

export const createPageRoomClient = (): PageRoomClient | null => {
  const baseUrl = appEnv.AGENT_GATEWAY_INTERNAL_URL || appEnv.AGENT_GATEWAY_URL;
  const token = appEnv.AGENT_GATEWAY_SERVICE_TOKEN;
  if (!baseUrl || !token) return null;
  return new PageRoomClient(toHttpBase(baseUrl), token);
};
