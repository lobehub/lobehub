import type { LocalHeterogeneousAgentType } from '../config';
import {
  buildHeterogeneousAgentAuthRequiredError,
  isHeterogeneousAgentAuthRequired,
} from '../config';
import type { HeterogeneousTerminalErrorData } from '../types';
import { classifyCliQuotaMessage } from './cliQuota';

interface ClassifyCliMessageErrorParams {
  agentType: LocalHeterogeneousAgentType;
  command?: string;
  detail?: string;
}

/** Error text shared by stream adapters and process failure handling. */
export const classifyCliMessageError = ({
  agentType,
  command,
  detail: rawDetail,
}: ClassifyCliMessageErrorParams): HeterogeneousTerminalErrorData | undefined => {
  const detail = rawDetail?.trim();
  if (!detail) return;

  // A CLI can report a spent subscription through its auth layer. Signing in
  // again never fixes that, so explicit quota wording takes precedence.
  const quota = classifyCliQuotaMessage(detail);
  if (quota) {
    return {
      agentType,
      code: 'rate_limit',
      details: { kind: quota.kind },
      error: detail,
      message: detail,
      ...(quota.rateLimitType
        ? { rateLimitInfo: { rateLimitType: quota.rateLimitType, status: 'rejected' } }
        : {}),
      stderr: detail,
    };
  }

  if (isHeterogeneousAgentAuthRequired(agentType, detail)) {
    return buildHeterogeneousAgentAuthRequiredError({
      agentType,
      command,
      stderr: detail,
    });
  }
};
