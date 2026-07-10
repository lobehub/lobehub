import type { VerifyCheckItem } from '@lobechat/types';

import type { VerifyStatus } from '@/database/models/agentOperation';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';

export type DockPhase =
  | 'idle'
  | 'draft'
  | 'verifying'
  | 'failed'
  // The verifier could not run (infra error) — a terminal, non-pass state that
  // is NOT a delivery failure. Rendered distinctly so it never reads as "failed".
  | 'errored'
  | 'repairing'
  | 'passed';

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
    case 'errored': {
      return 'errored';
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

/** The subset of theme color tokens the verify card tint reads. */
export interface VerifyTintTheme {
  colorBgElevated: string;
  colorError: string;
  colorSuccess: string;
  colorWarning: string;
}

const mix = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * State-tinted background for the whole verify card, keyed by phase. A soft
 * radial glow anchored to the status corner (top-right, behind the badge) over
 * the container fill — a gentle halo, not a full-width banner. Returns undefined
 * when neutral.
 */
export const phaseCardBackground = (
  phase: DockPhase,
  theme: VerifyTintTheme,
): string | undefined => {
  const glow = (color: string) =>
    `radial-gradient(60% 90% at 100% 0%, ${mix(color, 8)} 0%, ${mix(color, 0)} 52%), ${theme.colorBgElevated}`;
  switch (phase) {
    case 'passed': {
      return glow(theme.colorSuccess);
    }
    case 'failed': {
      return glow(theme.colorError);
    }
    case 'draft':
    case 'verifying':
    case 'errored':
    case 'repairing': {
      return glow(theme.colorWarning);
    }
    default: {
      return undefined;
    }
  }
};
