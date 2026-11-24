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

/** agy reports its reset as a compact relative duration, for example 28m39s. */
const antigravityQuotaResetAt = (message: string): number | undefined => {
  const duration =
    /\bResets in\s+(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?(?=\.|$)/i.exec(message);
  if (!duration) return;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = duration;
  const reset =
    Number(days) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  if (Number.isSafeInteger(reset) && reset > 0) return Math.floor(Date.now() / 1000) + reset;
};

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
    const resetsAt = agentType === 'antigravity' ? antigravityQuotaResetAt(detail) : undefined;
    return {
      agentType,
      code: 'rate_limit',
      details: { kind: quota.kind },
      error: detail,
      message: detail,
      ...(quota.rateLimitType || resetsAt
        ? {
            rateLimitInfo: {
              ...(quota.rateLimitType && { rateLimitType: quota.rateLimitType }),
              ...(resetsAt && { resetsAt }),
              status: 'rejected',
            },
          }
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
