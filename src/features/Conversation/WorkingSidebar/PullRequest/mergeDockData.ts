import type { DeviceGitPullRequestDetail, DeviceGitPullRequestMergeMethod } from '@lobechat/types';

export type Tone = 'success' | 'warning' | 'error' | 'neutral' | 'merged';

export type ChecksStatus = 'success' | 'pending' | 'failure' | 'unstable';

export type DockIcon =
  'check' | 'x' | 'eye' | 'spinner' | 'conflict' | 'behind' | 'push' | 'shieldAlert' | 'merge';

export interface DockText {
  labelKey: string;
  labelParams?: Record<string, string | number>;
}

export interface DockStatus extends DockText {
  icon: DockIcon;
  key:
    | 'merged'
    | 'closed'
    | 'draft'
    | 'calculating'
    | 'conflicts'
    | 'blocked'
    | 'waiting'
    | 'autoMerge'
    | 'bypass'
    | 'ready'
    | 'unstable'
    | 'error';
  tone: Tone;
}

export type DockAction =
  | {
      admin: boolean;
      busy?: boolean;
      busyLabelKey?: string;
      kind: 'merge';
      method: DeviceGitPullRequestMergeMethod;
      tone: 'success' | 'plain' | 'error';
    }
  | {
      busy?: boolean;
      busyLabelKey?: string;
      kind: 'autoMerge';
      method: DeviceGitPullRequestMergeMethod;
      tone: 'plain';
    }
  | { busy?: boolean; busyLabelKey?: string; kind: 'updateBranch'; tone: 'success' }
  | { busy?: boolean; busyLabelKey?: string; kind: 'ready' }
  | { busy?: boolean; busyLabelKey?: string; kind: 'deleteBranch' }
  | { busy?: boolean; busyLabelKey?: string; kind: 'reopen' }
  | { kind: 'disabled'; labelKey: string };

export interface MergeDockModel {
  action?: DockAction;
  bypassAvailable: boolean;
  checksStatus: ChecksStatus;
  hintKey?: string;
  hintParams?: Record<string, string | number>;
  reasons: DockText[];
  showPush?: boolean;
  showUpdateBranch: boolean;
  status: DockStatus;
}

export interface MergeDockInput {
  detail: DeviceGitPullRequestDetail;
  local?: { ahead: number; dirtyFiles: number };
  ui: {
    bypass: boolean;
    busy?: 'merge' | 'update' | 'push' | 'ready' | 'autoMerge';
    contextLoading?: boolean;
    error?: string;
    method: DeviceGitPullRequestMergeMethod;
  };
}

export const PR_KEYS = {
  action: {
    arming: 'workingPanel.pr.action.arming',
    calculating: 'workingPanel.pr.action.calculating',
    conflicting: 'workingPanel.pr.action.conflicting',
    merging: 'workingPanel.pr.action.merging',
    pushing: 'workingPanel.pr.action.pushing',
    readying: 'workingPanel.pr.action.readying',
    updating: 'workingPanel.pr.action.updating',
    waiting: 'workingPanel.pr.action.waiting',
  },
  hint: {
    autoMerge: 'workingPanel.pr.hint.autoMerge',
    blocked: 'workingPanel.pr.hint.blocked',
    bypass: 'workingPanel.pr.hint.bypass',
    calculating: 'workingPanel.pr.hint.calculating',
    merge: 'workingPanel.pr.hint.merge',
    merged: 'workingPanel.pr.hint.merged',
    readOnly: 'workingPanel.pr.hint.readOnly',
  },
  method: {
    merge: 'workingPanel.pr.method.merge',
    rebase: 'workingPanel.pr.method.rebase',
    squash: 'workingPanel.pr.method.squash',
  },
  reason: {
    behind: 'workingPanel.pr.reason.behind',
    changesRequested: 'workingPanel.pr.reason.changesRequested',
    checksFailing: 'workingPanel.pr.reason.checksFailing',
    checksPending: 'workingPanel.pr.reason.checksPending',
    conflicts: 'workingPanel.pr.reason.conflicts',
    localAhead: 'workingPanel.pr.reason.localAhead',
    localDirty: 'workingPanel.pr.reason.localDirty',
    optionalFailing: 'workingPanel.pr.reason.optionalFailing',
    reviewRequired: 'workingPanel.pr.reason.reviewRequired',
    rules: 'workingPanel.pr.reason.rules',
  },
  status: {
    autoMerge: 'workingPanel.pr.status.autoMerge',
    blocked: 'workingPanel.pr.status.blocked',
    bypass: 'workingPanel.pr.status.bypass',
    calculating: 'workingPanel.pr.status.calculating',
    closed: 'workingPanel.pr.status.closed',
    conflicts: 'workingPanel.pr.status.conflicts',
    draft: 'workingPanel.pr.status.draft',
    error: 'workingPanel.pr.status.error',
    merged: 'workingPanel.pr.status.merged',
    ready: 'workingPanel.pr.status.ready',
    unstable: 'workingPanel.pr.status.unstable',
    waiting: 'workingPanel.pr.status.waiting',
  },
} as const;

const BLOCKED_STATES = new Set(['BLOCKED', 'DIRTY', 'BEHIND']);

const computeChecksStatus = (checks: DeviceGitPullRequestDetail['checks']): ChecksStatus => {
  if (
    checks.some(
      (check) => check.required && (check.status === 'failure' || check.status === 'cancelled'),
    )
  )
    return 'failure';
  if (checks.some((check) => check.status === 'pending')) return 'pending';
  if (
    checks.some(
      (check) => !check.required && (check.status === 'failure' || check.status === 'cancelled'),
    )
  )
    return 'unstable';
  return 'success';
};

const countFailing = (checks: DeviceGitPullRequestDetail['checks'], required: boolean) =>
  checks.filter(
    (check) =>
      check.required === required && (check.status === 'failure' || check.status === 'cancelled'),
  ).length;

const buildReasons = (
  detail: DeviceGitPullRequestDetail,
  checksStatus: ChecksStatus,
  local: MergeDockInput['local'],
): { blockers: DockText[]; reasons: DockText[] } => {
  const blockers: DockText[] = [];
  const reasons: DockText[] = [];

  if (checksStatus === 'failure')
    blockers.push({
      labelKey: PR_KEYS.reason.checksFailing,
      labelParams: { count: countFailing(detail.checks, true) },
    });
  if (detail.reviewDecision === 'CHANGES_REQUESTED')
    blockers.push({
      labelKey: PR_KEYS.reason.changesRequested,
      labelParams: {
        authors: detail.reviews
          .filter((review) => review.state === 'CHANGES_REQUESTED')
          .map((review) => review.author)
          .join(', '),
      },
    });
  if (detail.reviewDecision === 'REVIEW_REQUIRED')
    blockers.push({ labelKey: PR_KEYS.reason.reviewRequired });
  if (detail.mergeStateStatus === 'BEHIND')
    blockers.push({ labelKey: PR_KEYS.reason.behind, labelParams: { base: detail.baseRefName } });
  if (checksStatus === 'pending') reasons.push({ labelKey: PR_KEYS.reason.checksPending });
  if (checksStatus === 'unstable')
    reasons.push({
      labelKey: PR_KEYS.reason.optionalFailing,
      labelParams: { count: countFailing(detail.checks, false) },
    });
  if ((local?.ahead ?? 0) > 0)
    reasons.push({ labelKey: PR_KEYS.reason.localAhead, labelParams: { count: local!.ahead } });
  if ((local?.dirtyFiles ?? 0) > 0)
    reasons.push({
      labelKey: PR_KEYS.reason.localDirty,
      labelParams: { count: local!.dirtyFiles },
    });

  return { blockers, reasons };
};

const buildStatus = (
  detail: DeviceGitPullRequestDetail,
  ui: MergeDockInput['ui'],
  checksStatus: ChecksStatus,
  blocked: boolean,
  hasBlockers: boolean,
): DockStatus => {
  if (ui.error)
    return {
      icon: 'x',
      key: 'error',
      labelKey: PR_KEYS.status.error,
      labelParams: { message: ui.error },
      tone: 'error',
    };
  if (detail.state === 'merged')
    return { icon: 'merge', key: 'merged', labelKey: PR_KEYS.status.merged, tone: 'merged' };
  if (detail.state === 'closed')
    return { icon: 'x', key: 'closed', labelKey: PR_KEYS.status.closed, tone: 'error' };
  if (detail.isDraft)
    return { icon: 'eye', key: 'draft', labelKey: PR_KEYS.status.draft, tone: 'neutral' };
  if (detail.mergeable === 'UNKNOWN')
    return {
      icon: 'spinner',
      key: 'calculating',
      labelKey: PR_KEYS.status.calculating,
      tone: 'neutral',
    };
  if (detail.mergeable === 'CONFLICTING')
    return {
      icon: 'conflict',
      key: 'conflicts',
      labelKey: PR_KEYS.status.conflicts,
      labelParams: { base: detail.baseRefName },
      tone: 'error',
    };
  if (ui.bypass)
    return { icon: 'shieldAlert', key: 'bypass', labelKey: PR_KEYS.status.bypass, tone: 'error' };
  if (detail.autoMerge)
    return {
      icon: 'merge',
      key: 'autoMerge',
      labelKey: PR_KEYS.status.autoMerge,
      labelParams: { method: detail.autoMerge.method },
      tone: 'merged',
    };
  if (hasBlockers || (blocked && checksStatus !== 'pending'))
    return { icon: 'x', key: 'blocked', labelKey: PR_KEYS.status.blocked, tone: 'error' };
  if (checksStatus === 'pending')
    return { icon: 'spinner', key: 'waiting', labelKey: PR_KEYS.status.waiting, tone: 'warning' };
  if (checksStatus === 'unstable')
    return { icon: 'x', key: 'unstable', labelKey: PR_KEYS.status.unstable, tone: 'warning' };
  return { icon: 'check', key: 'ready', labelKey: PR_KEYS.status.ready, tone: 'success' };
};

const BUSY_LABEL_KEY: Record<NonNullable<MergeDockInput['ui']['busy']>, string> = {
  autoMerge: PR_KEYS.action.arming,
  merge: PR_KEYS.action.merging,
  push: PR_KEYS.action.pushing,
  ready: PR_KEYS.action.readying,
  update: PR_KEYS.action.updating,
};

export const resolveMergeDock = ({ detail, local, ui }: MergeDockInput): MergeDockModel => {
  const checksStatus = computeChecksStatus(detail.checks);
  const blocked = BLOCKED_STATES.has(detail.mergeStateStatus);
  const canAutoMerge =
    checksStatus === 'pending' &&
    detail.mergeable === 'MERGEABLE' &&
    detail.reviewDecision !== 'CHANGES_REQUESTED' &&
    !detail.autoMerge;

  const settled = detail.state === 'open' && !detail.isDraft && detail.mergeable !== 'UNKNOWN';
  const { blockers, reasons: softReasons } = settled
    ? buildReasons(detail, checksStatus, local)
    : { blockers: [], reasons: [] };
  if (settled && blocked && blockers.length === 0 && checksStatus !== 'pending' && !ui.bypass)
    blockers.push({ labelKey: PR_KEYS.reason.rules });
  const reasons = detail.mergeable === 'CONFLICTING' ? softReasons : [...blockers, ...softReasons];
  const status = buildStatus(detail, ui, checksStatus, blocked, blockers.length > 0);

  let action: DockAction | undefined;
  if (ui.contextLoading) {
    action =
      detail.state === 'open'
        ? { kind: 'disabled', labelKey: PR_KEYS.action.calculating }
        : undefined;
  } else if (!detail.viewerCanWrite) {
    action = undefined;
  } else if (detail.state === 'merged') {
    action = detail.isCrossRepository ? undefined : { kind: 'deleteBranch' };
  } else if (detail.state === 'closed') {
    action = { kind: 'reopen' };
  } else if (detail.isDraft) {
    action = { kind: 'ready' };
  } else if (detail.mergeable === 'UNKNOWN') {
    action = { kind: 'disabled', labelKey: PR_KEYS.action.calculating };
  } else if (detail.mergeable === 'CONFLICTING') {
    action = { kind: 'disabled', labelKey: PR_KEYS.action.conflicting };
  } else if (detail.mergeStateStatus === 'BEHIND' && !ui.bypass) {
    action = { kind: 'updateBranch', tone: 'success' };
  } else if (blocked && !ui.bypass) {
    if (canAutoMerge) action = { kind: 'autoMerge', method: ui.method, tone: 'plain' };
    else if (detail.autoMerge) action = { kind: 'disabled', labelKey: PR_KEYS.action.waiting };
    else action = { kind: 'disabled', labelKey: PR_KEYS.method[ui.method] };
  } else {
    action = {
      admin: ui.bypass,
      kind: 'merge',
      method: ui.method,
      tone: ui.bypass ? 'error' : checksStatus === 'success' ? 'success' : 'plain',
    };
  }

  if (action && action.kind !== 'disabled' && ui.busy) {
    action = { ...action, busy: true, busyLabelKey: BUSY_LABEL_KEY[ui.busy] };
  }

  const bypassAvailable =
    detail.viewerCanWrite &&
    detail.viewerCanBypass &&
    blocked &&
    detail.state === 'open' &&
    !detail.isDraft;
  const showPush = (local?.ahead ?? 0) > 0 && action?.kind === 'merge';
  const showUpdateBranch =
    settled &&
    detail.viewerCanWrite &&
    detail.baseBehindBy > 0 &&
    detail.mergeable !== 'CONFLICTING' &&
    action?.kind !== 'updateBranch';

  let hintKey: string | undefined;
  let hintParams: Record<string, string | number> | undefined;

  if (ui.contextLoading) {
    hintKey = undefined;
  } else if (!detail.viewerCanWrite && detail.state === 'open') {
    hintKey = PR_KEYS.hint.readOnly;
    hintParams = { repo: `${detail.repo.owner}/${detail.repo.name}` };
  } else if (ui.error) {
    hintKey = undefined;
  } else if (detail.mergeable === 'UNKNOWN') {
    hintKey = PR_KEYS.hint.calculating;
  } else if (ui.bypass) {
    hintKey = PR_KEYS.hint.bypass;
  } else if (detail.autoMerge) {
    hintKey = PR_KEYS.hint.autoMerge;
    hintParams = { method: detail.autoMerge.method };
  } else if (blocked && !canAutoMerge) {
    hintKey = PR_KEYS.hint.blocked;
  } else if (action?.kind === 'merge') {
    hintKey = PR_KEYS.hint.merge;
    hintParams = { base: detail.baseRefName, count: detail.commits.length };
  } else if (detail.state === 'merged') {
    hintKey = PR_KEYS.hint.merged;
    hintParams = { head: detail.headRefName };
  }

  if (reasons.length > 0 && hintKey !== PR_KEYS.hint.readOnly) hintKey = undefined;

  return {
    action,
    bypassAvailable,
    checksStatus,
    hintKey,
    hintParams,
    reasons,
    showPush,
    showUpdateBranch,
    status,
  };
};
