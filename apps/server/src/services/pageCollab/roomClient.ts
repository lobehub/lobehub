import { TRPCError } from '@trpc/server';

import { appEnv } from '@/envs/app';

export interface PageRoomState {
  bootstrapped: boolean;
  epoch: string;
  // Absent from a gateway that predates conditional server writes.
  serverWriteSeq?: number;
  update: Uint8Array;
}

export class PageRoomConflictError extends Error {
  constructor() {
    super('Page room was bootstrapped by another collaborator');
    this.name = 'PageRoomConflictError';
  }
}

export class PageRoomStaleBaseError extends Error {
  constructor() {
    super('Page room changed after this writer read it');
    this.name = 'PageRoomStaleBaseError';
  }
}

export const PAGE_TOO_LARGE_MESSAGE =
  'This page is too large to store more content. Remove some content from the page, or ask support to trim its history.';

export class PageRoomTooLargeError extends TRPCError {
  constructor() {
    super({ code: 'PAYLOAD_TOO_LARGE', message: PAGE_TOO_LARGE_MESSAGE });
    this.name = 'PageRoomTooLargeError';
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
    const body = (await res.json()) as {
      bootstrapped: boolean;
      epoch: string;
      serverWriteSeq?: number;
      update: string;
    };
    return {
      bootstrapped: body.bootstrapped,
      epoch: body.epoch,
      serverWriteSeq: typeof body.serverWriteSeq === 'number' ? body.serverWriteSeq : undefined,
      update: fromBase64(body.update),
    };
  }

  async pushUpdate(
    documentId: string,
    update: Uint8Array,
    options: { actor?: string; baseServerWriteSeq?: number; bootstrap?: boolean } = {},
  ): Promise<void> {
    const res = await fetch(new URL('/api/documents/update', this.baseUrl), {
      body: JSON.stringify({ documentId, update: toBase64(update), ...options }),
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (res.ok) return;

    const code = await errorCodeOf(res);
    if (code === 'STALE_BASE') throw new PageRoomStaleBaseError();
    if (code === 'DOC_TOO_LARGE') throw new PageRoomTooLargeError();
    if (res.status === 409) throw new PageRoomConflictError();
    throw new Error(`Page room update failed: ${res.status}`);
  }

  async dropRoom(documentId: string): Promise<void> {
    const url = new URL('/api/documents/room', this.baseUrl);
    url.searchParams.set('documentId', documentId);
    const res = await fetch(url, { headers: this.headers(), method: 'DELETE' });
    if (!res.ok) throw new Error(`Page room drop failed: ${res.status}`);
  }

  private headers() {
    return { Authorization: `Bearer ${this.serviceToken}` };
  }
}

const errorCodeOf = async (res: Response) => {
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  return typeof body?.code === 'string' ? body.code : undefined;
};

const toHttpBase = (url: string) => url.replace(/^ws(s?):\/\//, 'http$1://');

export const createPageRoomClient = (): PageRoomClient | null => {
  const baseUrl = appEnv.AGENT_GATEWAY_INTERNAL_URL || appEnv.AGENT_GATEWAY_URL;
  const token = appEnv.AGENT_GATEWAY_SERVICE_TOKEN;
  if (!baseUrl || !token) return null;
  return new PageRoomClient(toHttpBase(baseUrl), token);
};
