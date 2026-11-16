import { spawn } from 'node:child_process';

import type { TfsCredentials } from '@lobechat/types';
import { normalizeTfsCollection } from '@lobechat/utils/tfs';

export class TfsRequestError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'TFS_AUTH_FAILED'
        : status === 403
          ? 'TFS_FORBIDDEN'
          : status === 404
            ? 'TFS_NOT_FOUND'
            : 'TFS_REQUEST_FAILED',
    );
  }
}

/** Fixed collection, no redirects, bounded output, and credentials over stdin (never argv). */
export const requestTfs = async (
  collection: string,
  credentials: TfsCredentials,
  path: string,
  query: Record<string, string | undefined> = {},
  accept = 'application/json',
): Promise<{ body: Buffer; continuation?: string }> => {
  const base = normalizeTfsCollection(collection);
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#'))
    throw new Error('Invalid TFS API path');
  const url = new URL(base + path);
  if (!url.href.startsWith(base + '/') || url.origin !== new URL(base).origin)
    throw new Error('Invalid TFS API path');
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) url.searchParams.set(key, value);
  const auth =
    credentials.authType === 'pat'
      ? `:${credentials.secret}`
      : `${credentials.username}:${credentials.secret}`;
  if ([...auth].some((char) => char.codePointAt(0)! < 32))
    throw new Error('Invalid TFS credentials');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'curl',
      [
        '--disable',
        '--globoff',
        '--config',
        '-',
        credentials.authType === 'ntlm' ? '--ntlm' : '--basic',
        '--silent',
        '--show-error',
        '--connect-timeout',
        '5',
        '--max-time',
        '30',
        '--max-filesize',
        '16777216',
        '--proto',
        '=http,https',
        '--header',
        `Accept: ${accept}`,
        '--include',
        url.href,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const timer = setTimeout(() => fail(), 35_000);
    const fail = () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error('TFS_TRANSPORT_FAILED'));
      }
    };
    child.on('error', fail);
    child.stdin.on('error', fail);
    // stderr and process errors can contain URLs; never return the raw curl error.
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 17 * 1024 * 1024) fail();
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (finished) return;
      if (code !== 0) {
        fail();
        return;
      }
      finished = true;
      try {
        const raw = Buffer.concat(chunks);
        let offset = 0;
        let status = 0;
        let header = '';
        // NTLM and HTTP proxies may prepend intermediate 401/CONNECT header blocks.
        do {
          const end = raw.indexOf('\r\n\r\n', offset);
          if (end < 0) throw new Error('TFS_TRANSPORT_FAILED');
          header = raw.subarray(offset, end).toString('utf8');
          status = Number(/^HTTP\/\S+\s+(\d+)/.exec(header)?.[1]);
          offset = end + 4;
        } while (raw.subarray(offset, offset + 5).toString() === 'HTTP/');
        if (!Number.isInteger(status) || status < 200 || status >= 300)
          throw new TfsRequestError(status);
        resolve({
          body: raw.subarray(offset),
          continuation: /^x-ms-continuationtoken:\s*(.+)$/im.exec(header)?.[1].trim(),
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`user = ${JSON.stringify(auth)}\n`);
  });
};
