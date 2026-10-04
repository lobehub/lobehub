import {
  ASC_SUITE,
  type AscIdentityKeyPair,
  type AscRequest,
  createRequest,
  deriveIdentityFromSecret,
  fingerprintIdentityKey,
  formatSecretPlaceholder,
  generatePersistableRecipientKey,
  hashArgv,
  type PersistableRecipientKey,
} from '@lobechat/secret-channel';
import {
  AGENT_SECRET_SLOT,
  type AgentHumanRequestAction,
  type AgentSecretChannelIdentity,
  type AgentSecretKind,
} from '@lobechat/types';

import { getServerDBConfig } from '@/config/db';

/**
 * The LobeHub server as an ASC/1 Executor for its own actions.
 *
 * ASC's usual Executor sits next to a local command (`sudo`, `git`); here the
 * "command" is an action the server itself performs — sending a message from
 * one of the agent's addresses. The mapping:
 *
 * | ASC field                | value                                             |
 * | ------------------------ | ------------------------------------------------- |
 * | `target.kind`            | `lobehub-send-message`                            |
 * | `target.exePath`         | `lobe-agent-account/sendMessage`                  |
 * | `target.argvHash`        | hash of the full bound action (account, to, …)   |
 * | `target.verification`    | `verified` — the server observes its own action   |
 * | `purpose.systemObserved` | server-written description of the action          |
 * | `purpose.agentClaim`     | the agent's reason (unbound, untrusted)           |
 *
 * Because `argvHash` and the description are in the AAD, an envelope opens
 * only for the exact action the human was shown; the service recomputes the
 * hash from the stored action before opening, so a row edited after the card
 * was rendered cannot receive the secret either.
 */

export const SECRET_EXECUTOR_ID = 'lobehub-server';
export const SECRET_EXECUTOR_NAME = 'LobeHub';
export const SECRET_TARGET_KIND = 'lobehub-send-message';
export const SECRET_TARGET_EXE = 'lobe-agent-account/sendMessage';

/** Codes go stale in minutes; ASC caps a request at 15 (spec §6.7). */
export const SECRET_REQUEST_TTL_SEC = 600;

/** System-chosen labels — never written by the model. */
export const SECRET_LABELS: Record<AgentSecretKind, string> = {
  otp: 'verification-code',
  password: 'password',
  token: 'access-token',
};

const DESCRIPTION_BODY_CHARS = 400;

let cachedIdentity: AscIdentityKeyPair | undefined;

/** The server's Ed25519 identity, derived from `KEY_VAULTS_SECRET`. */
export const getExecutorIdentity = (): AscIdentityKeyPair => {
  if (cachedIdentity) return cachedIdentity;

  const { KEY_VAULTS_SECRET } = getServerDBConfig();
  if (!KEY_VAULTS_SECRET) {
    throw new Error('`KEY_VAULTS_SECRET` is required for secure input requests');
  }
  cachedIdentity = deriveIdentityFromSecret(
    Buffer.from(KEY_VAULTS_SECRET, 'base64'),
    SECRET_EXECUTOR_ID,
  );
  return cachedIdentity;
};

/** What clients pin (TOFU) to verify every secret request they render. */
export const describeExecutorIdentity = (): AgentSecretChannelIdentity => {
  const identity = getExecutorIdentity();
  return {
    executorId: SECRET_EXECUTOR_ID,
    executorName: SECRET_EXECUTOR_NAME,
    identityKeyFp: fingerprintIdentityKey(identity.publicKey),
    identityPublicKey: identity.publicKey,
    suite: ASC_SUITE,
  };
};

/** The canonical argv of a bound action: every field that changes what is sent. */
export const actionArgv = (action: AgentHumanRequestAction): string[] => [
  action.type,
  action.accountId,
  action.from,
  action.to,
  action.subject ?? '',
  action.text,
  action.threadKey ?? '',
];

export const hashAction = (action: AgentHumanRequestAction) => hashArgv(actionArgv(action));

/** The system-observed description: what the server will do, with the slot shown as its label. */
export const describeAction = (action: AgentHumanRequestAction, label: string): string => {
  const body = action.text.split(AGENT_SECRET_SLOT).join(formatSecretPlaceholder(label));
  const clipped =
    body.length > DESCRIPTION_BODY_CHARS ? `${body.slice(0, DESCRIPTION_BODY_CHARS)}…` : body;
  const what = action.channel === 'mail' ? 'email' : 'message';
  const subject = action.subject ? ` (subject: ${action.subject})` : '';

  return `Send ${what} from ${action.from} to ${action.to}${subject}: ${clipped}`;
};

export interface BuildSecretRequestParams {
  action: AgentHumanRequestAction;
  kind: AgentSecretKind;
  now?: number;
  reason?: string;
  runId?: string;
}

/** Create the signed ASC request for an action and the key that opens its envelope. */
export const buildSecretRequest = async ({
  action,
  kind,
  now = Date.now(),
  reason,
  runId,
}: BuildSecretRequestParams): Promise<{
  key: PersistableRecipientKey;
  label: string;
  request: AscRequest;
}> => {
  const label = SECRET_LABELS[kind];
  const key = await generatePersistableRecipientKey();

  const request = createRequest({
    ephPub: key.publicKey,
    executor: { executorId: SECRET_EXECUTOR_ID, executorName: SECRET_EXECUTOR_NAME },
    identity: getExecutorIdentity(),
    kind,
    label,
    now,
    purpose: {
      ...(reason ? { agentClaim: reason } : {}),
      systemObserved: describeAction(action, label),
    },
    requester: { runId: runId || 'unattended', source: 'tool' },
    target: {
      argvDisplay: `sendMessage ${action.from} -> ${action.to}`,
      argvHash: hashAction(action),
      exePath: SECRET_TARGET_EXE,
      kind: SECRET_TARGET_KIND,
      verification: 'verified',
    },
    ttlSec: SECRET_REQUEST_TTL_SEC,
  });

  return { key, label, request };
};
