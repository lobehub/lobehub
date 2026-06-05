import type { VerifyStatus } from '@/database/models/agentOperation';
import type { VerifyCheckItem, VerifyCheckResultItem } from '@/database/schemas/verify';

export type DockPhase = 'idle' | 'draft' | 'verifying' | 'failed' | 'repairing' | 'passed';

/** Map the persisted rollup status to the dock's phase state machine. */
export const phaseFromStatus = (status: VerifyStatus | null | undefined): DockPhase => {
  switch (status) {
    case 'planned': {
      return 'draft';
    }
    case 'verifying': {
      return 'verifying';
    }
    case 'failed': {
      return 'failed';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'passed':
    case 'delivered': {
      return 'passed';
    }
    default: {
      return 'idle';
    }
  }
};

/** Whether a draft plan exists but hasn't been confirmed yet. */
export const isDraftUnconfirmed = (
  status: VerifyStatus | null | undefined,
  confirmedAt: Date | null | undefined,
): boolean => status === 'planned' && !confirmedAt;

/** Display behavior of a check item, mirroring the mock's gate / auto_improve. */
export const itemBehavior = (item: Pick<VerifyCheckItem, 'required'>): 'gate' | 'auto_improve' =>
  item.required ? 'gate' : 'auto_improve';

export interface CheckCounts {
  failed: number;
  passed: number;
  total: number;
}

export const countResults = (results: VerifyCheckResultItem[] = []): CheckCounts => ({
  failed: results.filter((r) => r.status === 'failed' || r.verdict === 'failed').length,
  passed: results.filter((r) => r.status === 'passed' || r.verdict === 'passed').length,
  total: results.length,
});
