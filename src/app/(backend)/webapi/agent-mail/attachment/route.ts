import { checkAuth } from '@/app/(backend)/middleware/auth';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService, isAgentAccountError } from '@/server/services/agentIdentity';
import { AgentMailboxService } from '@/server/services/agentIdentity/mailbox';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';

import { resolveValidWorkspaceIdFromRequest, WORKSPACE_ID_HEADER } from '../../_utils/workspace';

export const runtime = 'nodejs';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const INDEX = /^\d{1,4}$/;

const jsonError = (error: string, status: number) =>
  Response.json({ error }, { headers: { 'Cache-Control': 'private, no-store' }, status });

/**
 * A filename for the header: the quoted form keeps printable ASCII only, so a
 * quote, a backslash or a line break can never end the header or start a new
 * one; `filename*` carries the real name, RFC 5987-encoded.
 */
const contentDisposition = (filename: string) => {
  const ascii = filename.replaceAll(/[^ -~]|["%/\\]/g, '_');
  const encoded = encodeURIComponent(filename).replaceAll(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

/**
 * One attachment of a mail, proxied so the browser never talks to the provider
 * and the same scope as reading the mail applies: the mail must resolve in the
 * caller's workspace and at the owning agent's visibility, and the provider
 * re-checks that the message lives in that address's inbox.
 *
 * Always a download, whatever the mail claims: the bytes come from whoever
 * sent it, so they are served as `application/octet-stream`, never sniffed,
 * never cached, and sandboxed should a browser render them anyway. A route
 * rather than tRPC because attachments do not fit a JSON response.
 *
 * `GET ?id=<mail uuid>&index=<attachment index>`, with the workspace in
 * `X-Workspace-Id` like the other web API routes. 404 `expired` when the mail
 * or the bytes are gone, 413 `too_large` past the download cap, 502
 * `unavailable` on a provider failure worth retrying.
 */
export const GET = checkAuth(async (req, { userId, serverDB }) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') ?? '';
  const rawIndex = searchParams.get('index') ?? '';
  if (!UUID.test(id) || !INDEX.test(rawIndex)) return jsonError('invalid request', 400);
  const index = Number(rawIndex);

  const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });
  // A workspace the caller is not a member of is refused, not quietly read as personal.
  if (req.headers.get(WORKSPACE_ID_HEADER)?.trim() && !workspaceId) {
    return jsonError('forbidden', 403);
  }

  const accounts = new AgentAccountService(serverDB, userId, {
    gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
    registry: createDefaultAgentAccountRegistry(),
    workspaceId,
  });
  const mailbox = new AgentMailboxService(serverDB, userId, { accounts, workspaceId });

  let file: Awaited<ReturnType<AgentMailboxService['readAttachment']>>;
  try {
    file = await mailbox.readAttachment(id, index);
  } catch (error) {
    if (isAgentAccountError(error) && error.code === 'attachment_too_large') {
      return jsonError('too_large', 413);
    }
    // Not "expired": the bytes may well be there, so the reader can retry.
    console.error('[agent-mail:attachment] download failed:', error);
    return jsonError('unavailable', 502);
  }
  if (!file) return jsonError('expired', 404);

  return new Response(new Uint8Array(file.buffer), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': contentDisposition(file.filename || `attachment-${index}`),
      'Content-Length': String(file.buffer.byteLength),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': 'application/octet-stream',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
