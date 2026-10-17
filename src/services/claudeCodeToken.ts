import { CLAUDE_CODE_TOKEN_CRED_KEY } from '@/helpers/claudeCodeTokenCred';
import { lambdaClient } from '@/libs/trpc/client';

interface SaveClaudeCodeTokenParams {
  inWorkspace: boolean;
  /** The caller's existing token — updated in place instead of adding a duplicate key. */
  personalCred?: { id: number; type?: string };
  token: string;
}

/**
 * `save` failed: nothing changed. `share` failed: the token is stored in the
 * personal vault, but runs in the active workspace still cannot read it.
 * `type`: a credential with this key exists with another type; the update API
 * changes values but not type, so it is left untouched.
 */
export type SaveClaudeCodeTokenResult =
  { ok: true } | { failedStep: 'save' | 'share' | 'type'; ok: false };

/**
 * Store the Claude Code OAuth token where the run will read it. Inside a
 * workspace a run reads the workspace's credentials, so the personal token is
 * shared to the active workspace after it is saved.
 */
export const saveClaudeCodeToken = async ({
  inWorkspace,
  personalCred,
  token,
}: SaveClaudeCodeTokenParams): Promise<SaveClaudeCodeTokenResult> => {
  const values = { [CLAUDE_CODE_TOKEN_CRED_KEY]: token };

  if (personalCred?.type !== undefined && personalCred.type !== 'kv-env') {
    return { failedStep: 'type', ok: false };
  }

  let credId: number;
  try {
    if (personalCred === undefined) {
      const created = await lambdaClient.market.creds.createKV.mutate({
        key: CLAUDE_CODE_TOKEN_CRED_KEY,
        name: 'Claude Code OAuth Token',
        type: 'kv-env',
        values,
      });
      credId = created.id;
    } else {
      await lambdaClient.market.creds.update.mutate({ id: personalCred.id, values });
      credId = personalCred.id;
    }
  } catch {
    return { failedStep: 'save', ok: false };
  }

  if (!inWorkspace) return { ok: true };

  try {
    await lambdaClient.market.creds.share.mutate({ id: credId });
  } catch {
    return { failedStep: 'share', ok: false };
  }

  return { ok: true };
};
