import type { DeviceGitPullRequestDetail, DeviceGitPullRequestMergeMethod } from '@lobechat/types';

export type Tone = 'success' | 'warning' | 'error' | 'neutral' | 'merged';

export type ChecksStatus = 'success' | 'pending' | 'failure' | 'unstable';

export interface DockRow {
  expandable?: boolean;
  icon:
    | 'check'
    | 'x'
    | 'eye'
    | 'spinner'
    | 'conflict'
    | 'behind'
    | 'push'
    | 'shieldAlert'
    | 'shieldCheck'
    | 'merge';
  key: 'review' | 'checks' | 'base' | 'local' | 'rules' | 'autoMerge' | 'error';
  labelKey: string;
  labelParams?: Record<string, string | number>;
  tone: Tone;
  trailingKey?: string;
  trailingParams?: Record<string, string | number>;
}

export type DockAction =
  | {
      admin: boolean;
      busy?: boolean;
      busyLabelKey?: string;
      kind: 'merge';
      method: DeviceGitPullRequestMergeMethod;
      tone: 'success' | 'error';
    }
  | {
      busy?: boolean;
      busyLabelKey?: string;
      kind: 'autoMerge';
      method: DeviceGitPullRequestMergeMethod;
      tone: 'warning';
    }
  | { busy?: boolean; busyLabelKey?: string; kind: 'updateBranch'; tone: 'success' }
  | { busy?: boolean; busyLabelKey?: string; kind: 'ready' }
  | { busy?: boolean; busyLabelKey?: string; kind: 'deleteBranch' }
  | { busy?: boolean; busyLabelKey?: string; kind: 'reopen' }
  | { kind: 'disabled'; labelKey: string };

export interface MergeDockModel {
  action?: DockAction;
  checksStatus: ChecksStatus;
  hintKey?: string;
  hintParams?: Record<string, string | number>;
  rows: DockRow[];
  showBypass: boolean;
  showPush?: boolean;
}

export interface MergeDockInput {
  detail: DeviceGitPullRequestDetail;
  local?: { ahead: number; dirtyFiles: number };
  ui: {
    bypass: boolean;
    busy?: 'merge' | 'update' | 'push' | 'ready' | 'autoMerge';
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
    localAhead: 'workingPanel.pr.hint.localAhead',
    merge: 'workingPanel.pr.hint.merge',
    merged: 'workingPanel.pr.hint.merged',
    readOnly: 'workingPanel.pr.hint.readOnly',
  },
  method: {
    merge: 'workingPanel.pr.method.merge',
    rebase: 'workingPanel.pr.method.rebase',
    squash: 'workingPanel.pr.method.squash',
  },
  row: {
    autoMerge: { armed: 'workingPanel.pr.row.autoMerge.armed' },
    base: {
      behind: 'workingPanel.pr.row.base.behind',
      calculating: 'workingPanel.pr.row.base.calculating',
      clean: 'workingPanel.pr.row.base.clean',
      closed: 'workingPanel.pr.row.base.closed',
      conflicting: 'workingPanel.pr.row.base.conflicting',
      draft: 'workingPanel.pr.row.base.draft',
      merged: 'workingPanel.pr.row.base.merged',
    },
    checks: {
      failure: 'workingPanel.pr.row.checks.failure',
      pending: 'workingPanel.pr.row.checks.pending',
      success: 'workingPanel.pr.row.checks.success',
      unstable: 'workingPanel.pr.row.checks.unstable',
    },
    error: 'workingPanel.pr.row.error',
    local: 'workingPanel.pr.row.local',
    review: {
      approved: 'workingPanel.pr.row.review.approved',
      changesRequested: 'workingPanel.pr.row.review.changesRequested',
      none: 'workingPanel.pr.row.review.none',
      reviewRequired: 'workingPanel.pr.row.review.reviewRequired',
      trailingApproved: 'workingPanel.pr.row.review.trailingApproved',
      trailingAuthors: 'workingPanel.pr.row.review.trailingAuthors',
      trailingCount: 'workingPanel.pr.row.review.trailingCount',
    },
    rules: {
      blocked: 'workingPanel.pr.row.rules.blocked',
      bypass: 'workingPanel.pr.row.rules.bypass',
      ready: 'workingPanel.pr.row.rules.ready',
    },
  },
  rules: {
    admin: 'workingPanel.pr.rules.admin',
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

const CHECKS_ROW_BY_STATUS: Record<ChecksStatus, Pick<DockRow, 'icon' | 'labelKey' | 'tone'>> = {
  failure: { icon: 'x', labelKey: PR_KEYS.row.checks.failure, tone: 'error' },
  pending: { icon: 'spinner', labelKey: PR_KEYS.row.checks.pending, tone: 'warning' },
  success: { icon: 'check', labelKey: PR_KEYS.row.checks.success, tone: 'success' },
  unstable: { icon: 'x', labelKey: PR_KEYS.row.checks.unstable, tone: 'warning' },
};

const buildChecksRow = (status: ChecksStatus): DockRow => ({
  expandable: true,
  key: 'checks',
  ...CHECKS_ROW_BY_STATUS[status],
});

const buildReviewRow = (detail: DeviceGitPullRequestDetail): DockRow => {
  if (detail.reviewDecision === 'APPROVED') {
    const count = detail.reviews.filter((review) => review.state === 'APPROVED').length;
    return {
      icon: 'check',
      key: 'review',
      labelKey: PR_KEYS.row.review.approved,
      tone: 'success',
      trailingKey: PR_KEYS.row.review.trailingApproved,
      trailingParams: { count },
    };
  }

  if (detail.reviewDecision === 'CHANGES_REQUESTED') {
    const authors = detail.reviews
      .filter((review) => review.state === 'CHANGES_REQUESTED')
      .map((review) => review.author)
      .join(', ');
    return {
      icon: 'x',
      key: 'review',
      labelKey: PR_KEYS.row.review.changesRequested,
      tone: 'error',
      trailingKey: PR_KEYS.row.review.trailingAuthors,
      trailingParams: { authors },
    };
  }

  if (detail.reviewDecision === 'REVIEW_REQUIRED') {
    return {
      icon: 'eye',
      key: 'review',
      labelKey: PR_KEYS.row.review.reviewRequired,
      tone: 'error',
      trailingKey: PR_KEYS.row.review.trailingCount,
      trailingParams: { approved: 0, required: 1 },
    };
  }

  return { icon: 'eye', key: 'review', labelKey: PR_KEYS.row.review.none, tone: 'neutral' };
};

const buildBaseRow = (detail: DeviceGitPullRequestDetail): DockRow => {
  if (detail.mergeable === 'UNKNOWN')
    return {
      icon: 'spinner',
      key: 'base',
      labelKey: PR_KEYS.row.base.calculating,
      tone: 'neutral',
    };
  if (detail.mergeable === 'CONFLICTING')
    return { icon: 'conflict', key: 'base', labelKey: PR_KEYS.row.base.conflicting, tone: 'error' };
  if (detail.mergeStateStatus === 'BEHIND')
    return { icon: 'behind', key: 'base', labelKey: PR_KEYS.row.base.behind, tone: 'warning' };
  return {
    icon: 'check',
    key: 'base',
    labelKey: PR_KEYS.row.base.clean,
    labelParams: { base: detail.baseRefName },
    tone: 'success',
  };
};

const buildLocalRow = (local: { ahead: number; dirtyFiles: number }): DockRow => ({
  icon: 'push',
  key: 'local',
  labelKey: PR_KEYS.row.local,
  labelParams: { ahead: local.ahead, dirty: local.dirtyFiles },
  tone: 'warning',
});

const buildRulesRow = (
  detail: DeviceGitPullRequestDetail,
  ui: MergeDockInput['ui'],
  blocked: boolean,
): DockRow => {
  if (blocked) {
    const row: DockRow = {
      icon: 'shieldAlert',
      key: 'rules',
      labelKey: PR_KEYS.row.rules.blocked,
      tone: 'error',
    };
    if (detail.viewerCanBypass && !ui.bypass) row.trailingKey = PR_KEYS.rules.admin;
    return row;
  }

  if (ui.bypass)
    return { icon: 'shieldAlert', key: 'rules', labelKey: PR_KEYS.row.rules.bypass, tone: 'error' };

  return { icon: 'shieldCheck', key: 'rules', labelKey: PR_KEYS.row.rules.ready, tone: 'success' };
};

const buildAutoMergeRow = (
  autoMerge: NonNullable<DeviceGitPullRequestDetail['autoMerge']>,
): DockRow => ({
  icon: 'merge',
  key: 'autoMerge',
  labelKey: PR_KEYS.row.autoMerge.armed,
  labelParams: { method: autoMerge.method },
  tone: 'merged',
});

const buildErrorRow = (message: string): DockRow => ({
  icon: 'x',
  key: 'error',
  labelKey: PR_KEYS.row.error,
  labelParams: { message },
  tone: 'error',
});

const buildStateRow = (detail: DeviceGitPullRequestDetail): DockRow => {
  if (detail.state === 'merged')
    return { icon: 'merge', key: 'base', labelKey: PR_KEYS.row.base.merged, tone: 'merged' };
  if (detail.state === 'closed')
    return { icon: 'x', key: 'base', labelKey: PR_KEYS.row.base.closed, tone: 'error' };
  return { icon: 'eye', key: 'base', labelKey: PR_KEYS.row.base.draft, tone: 'neutral' };
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
  const hasLocalChanges = (local?.ahead ?? 0) > 0 || (local?.dirtyFiles ?? 0) > 0;

  let rows: DockRow[];
  if (detail.state === 'merged' || detail.state === 'closed') {
    rows = [buildStateRow(detail)];
  } else if (detail.isDraft) {
    rows = [buildStateRow(detail), buildChecksRow(checksStatus)];
  } else {
    rows = [];
    if (detail.autoMerge) rows.push(buildAutoMergeRow(detail.autoMerge));
    rows.push(buildReviewRow(detail));
    rows.push(buildChecksRow(checksStatus));
    rows.push(buildBaseRow(detail));
    if (hasLocalChanges) rows.push(buildLocalRow(local!));
    if (detail.mergeable !== 'UNKNOWN') rows.push(buildRulesRow(detail, ui, blocked));
  }
  if (ui.error) rows.push(buildErrorRow(ui.error));

  let action: DockAction | undefined;
  if (!detail.viewerCanWrite) {
    action = undefined;
  } else if (detail.state === 'merged') {
    action = { kind: 'deleteBranch' };
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
    if (canAutoMerge) action = { kind: 'autoMerge', method: ui.method, tone: 'warning' };
    else if (detail.autoMerge) action = { kind: 'disabled', labelKey: PR_KEYS.action.waiting };
    else action = { kind: 'disabled', labelKey: PR_KEYS.method[ui.method] };
  } else {
    action = {
      admin: ui.bypass,
      kind: 'merge',
      method: ui.method,
      tone: ui.bypass ? 'error' : 'success',
    };
  }

  if (action && action.kind !== 'disabled' && ui.busy) {
    action = { ...action, busy: true, busyLabelKey: BUSY_LABEL_KEY[ui.busy] };
  }

  const showBypass =
    detail.viewerCanWrite &&
    detail.viewerCanBypass &&
    blocked &&
    detail.state === 'open' &&
    !detail.isDraft;
  const showPush = hasLocalChanges && (local?.ahead ?? 0) > 0 && action?.kind === 'merge';

  let hintKey: string | undefined;
  let hintParams: Record<string, string | number> | undefined;

  if (!detail.viewerCanWrite) {
    hintKey = PR_KEYS.hint.readOnly;
    hintParams = { repo: `${detail.repo.owner}/${detail.repo.name}` };
  } else if (ui.error) {
    hintKey = undefined;
  } else if (detail.mergeable === 'UNKNOWN') {
    hintKey = PR_KEYS.hint.calculating;
  } else if ((local?.ahead ?? 0) > 0) {
    hintKey = PR_KEYS.hint.localAhead;
    hintParams = { count: local!.ahead };
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

  return { action, checksStatus, hintKey, hintParams, rows, showBypass, showPush };
};
