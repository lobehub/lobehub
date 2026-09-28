import { cssVar } from 'antd-style';
import { Check, CheckCheck, CircleDashed, HelpCircle, MessageSquareX, XCircle } from 'lucide-react';

import { userReviewState } from './checkState';
import type { AcceptanceCheck, AcceptanceCheckState } from './types';

export const STATE_META: Record<AcceptanceCheckState, { color: string; icon: typeof Check }> = {
  failed: { color: cssVar.colorError, icon: XCircle },
  not_executed: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  passed: { color: cssVar.colorSuccess, icon: Check },
  uncertain: { color: cssVar.colorWarning, icon: HelpCircle },
};

/** Canonical verdict glyph for every surface that presents an Acceptance check. */
export const checkHeadMeta = (check: AcceptanceCheck) => {
  const meta = STATE_META[check.state];
  const reviewState = userReviewState(check);

  if (reviewState === 'rejected') {
    return { color: cssVar.colorError, icon: MessageSquareX };
  }

  if (check.state === 'passed' && reviewState === 'accepted') {
    return { color: cssVar.colorSuccess, icon: CheckCheck };
  }

  return meta;
};
