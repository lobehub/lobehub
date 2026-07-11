import crypto from 'node:crypto';

import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { createLogger } from '@/utils/logger';
import { setDesktopUserAgentHeader } from '@/utils/user-agent';

import { ServiceModule } from './index';

const logger = createLogger('services:RemoteFileUploadService');

export interface UploadFileBufferInput {
  /** Raw file bytes to upload. */
  buffer: Buffer;
  /** Display name; its extension seeds the S3 pathname. */
  fileName: string;
  /** MIME type sent as the S3 `Content-Type` and stored on the record. */
  fileType: string;
}

export interface UploadedFileRecord {
  id: string;
  url: string;
}

/**
 * Upload in-memory buffers to the remote server's file storage from the MAIN
 * process — the counterpart of the CLI's `uploadFileBuffer`
 * (`apps/cli/src/utils/uploadLocalFile.ts`), sharing its flow: hash dedup via
 * `file.checkFileHash`, pre-signed S3 PUT, then `file.createFile`.
 *
 * Talks to the lambda router over raw authenticated fetch (`Oidc-Auth`), the
 * same pattern GatewayConnectionCtr uses for `agentNotify.notify` /
 * `device.register` — desktop main has no typed TRPC client.
 */
export default class RemoteFileUploadService extends ServiceModule {
  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  /**
   * Upload a buffer and create its file record.
   *
   * @returns the created record, or `undefined` when the desktop has no
   *   active remote server session (callers degrade, e.g. to an
   *   `[Image: …]` placeholder).
   */
  async uploadFileBuffer({
    buffer,
    fileName,
    fileType,
  }: UploadFileBufferInput): Promise<UploadedFileRecord | undefined> {
    const [serverUrl, token] = await Promise.all([
      this.remoteServerConfigCtr.getRemoteServerUrl(),
      this.remoteServerConfigCtr.getAccessToken(),
    ]);
    if (!serverUrl || !token) {
      logger.debug('No active remote server session, declining upload');
      return undefined;
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = fileName.split('.').length > 1 ? fileName.split('.').pop() : undefined;
    const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

    // 1. Dedup: same bytes already stored → skip the S3 upload, reuse the url.
    const existing = await this.callLambda<{ isExist?: boolean; url?: string }>(
      serverUrl,
      token,
      'file.checkFileHash',
      { hash },
    );

    let pathname: string;
    if (existing?.isExist && existing.url) {
      pathname = existing.url;
    } else {
      // 2. Get a pre-signed upload URL and PUT the bytes to S3.
      pathname = ext ? `files/${date}/${hash}.${ext}` : `files/${date}/${hash}`;
      const presigned = await this.callLambda<string | { url?: string }>(
        serverUrl,
        token,
        'upload.createS3PreSignedUrl',
        { pathname },
      );

      const presignedUrl = typeof presigned === 'string' ? presigned : presigned?.url;
      if (!presignedUrl) throw new Error('createS3PreSignedUrl returned no url');

      const uploadRes = await fetch(presignedUrl, {
        body: buffer,
        headers: { 'Content-Type': fileType },
        method: 'PUT',
      });
      if (!uploadRes.ok) {
        throw new Error(`S3 upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
      }
    }

    // 3. Create the file record.
    return await this.callLambda<UploadedFileRecord>(serverUrl, token, 'file.createFile', {
      fileType,
      hash,
      metadata: { date, dirname: '', filename: fileName, path: pathname },
      name: fileName,
      size: buffer.length,
      url: pathname,
    });
  }

  private async callLambda<T>(
    serverUrl: string,
    token: string,
    procedure: string,
    input: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Oidc-Auth': token,
    };
    setDesktopUserAgentHeader(headers);

    const res = await fetch(`${serverUrl}/trpc/lambda/${procedure}`, {
      // superjson envelope: plain values serialize as `{ json: <value> }`.
      body: JSON.stringify({ json: input }),
      headers,
      method: 'POST',
    });
    if (!res.ok) throw new Error(`${procedure} failed: ${res.status}`);

    const data = (await res.json()) as { result?: { data?: { json?: T } } };
    return data?.result?.data?.json as T;
  }
}
