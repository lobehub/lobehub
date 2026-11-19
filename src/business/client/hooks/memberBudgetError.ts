import { BRANDING_PROVIDER } from '@lobechat/business-const';
import type { ChatMessageError } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { omit } from 'es-toolkit';

/** The member's personal or department-assigned model budget is used up. */
export const MEMBER_BUDGET_TYPE = 'organization_member';

export const isMemberBudgetExceeded = (error?: ChatMessageError | null) =>
  error?.type === AgentRuntimeErrorType.InsufficientQuota &&
  (error.body as { budget?: { budgetTypeAtError?: unknown } } | undefined)?.budget
    ?.budgetTypeAtError === MEMBER_BUDGET_TYPE;

export const getBusinessErrorDetailsBody = (error: ChatMessageError) => {
  const { body } = error;
  if (isRecord(body) && body.provider === BRANDING_PROVIDER && isMemberBudgetExceeded(error)) {
    return omit(body, ['provider']);
  }

  return body;
};
