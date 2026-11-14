import type { ReportCase } from './data';

export interface VerdictEntry {
  category: string;
  file: string;
  flags: string[];
  hash: string;
  key: string;
  signedReasons?: string[];
  signoff: 'missing' | 'not-needed' | 'stale' | 'valid';
}

export interface FollowInfo {
  base: string;
  head: string;
  pinned: boolean;
  requested: string;
  runId: string;
  startedAt?: string;
}

let servedRun = '';

const remember = <T extends { follow?: FollowInfo }>(payload: T) => {
  if (payload.follow) servedRun = payload.follow.runId;
  return payload;
};

export interface RunPayload {
  calibration: Array<{
    detail: string;
    file: string;
    fixture: string;
    fixtureId: string;
    status: string;
    synthetic: string;
  }>;
  cases: ReportCase[];
  follow?: FollowInfo;
  mutation: {
    caught: number;
    equivalent: number;
    evaluated: number;
    mutants: Array<{
      caseKey: string;
      description: string;
      expected: string[];
      detected: string[];
      gaps?: string[];
      operator: string;
      outcome: string;
    }>;
    passed: boolean;
    requested: number;
  };
  run: {
    base: string;
    conditions?: string[];
    durationMs?: number;
    head: string;
    runId: string;
    verifierVersion?: string;
    widths?: number[];
  };
  verdict: { items: VerdictEntry[]; mergeable: boolean; reasons: string[] };
}

export const fetchRun = async (): Promise<RunPayload> => {
  const response = await fetch('/api/run');
  if (!response.ok) throw new Error(`/api/run ${response.status}`);
  return remember(await response.json());
};

export const fetchCurrent = async (): Promise<FollowInfo> => {
  const response = await fetch('/api/current');
  if (!response.ok) throw new Error(`/api/current ${response.status}`);
  return response.json();
};

export interface HashedElement {
  bindings: Array<{ expr: string; prop: string; spread: boolean }>;
  literalProps: Record<string, unknown>;
  slots: string[];
  tag: string;
}

export interface CaseDetail {
  case?: ReportCase & {
    plan: ReportCase['plan'] & {
      combos: Array<Record<string, boolean | string>>;
      variables: Array<{ kinds: Record<string, string>; name: string }>;
    };
    result: ReportCase['result'] & { unstableConditions: string[] };
  };
  evidence?: {
    declarations: Partial<Record<'base' | 'head', Record<string, string>>>;
    elements: Partial<Record<'base' | 'head', HashedElement[]>>;
  };
  extraction?: Partial<
    Record<
      'base' | 'head',
      { rules: Array<{ conditions: string[]; selector: string; slot?: string }> }
    >
  >;
  item?: VerdictEntry;
}

export interface SideSnapshot {
  error?: string;
  target?: { box: number[]; key: string; tag: string; values: Record<string, string> };
  targetKey?: string;
}

export interface CaseSnapshot {
  base: SideSnapshot;
  differences: Array<{ after?: string; before?: string; key: string; property: string }>;
  head: SideSnapshot;
  ignored: Array<{ key: string; property: string; reason: string }>;
}

const caseUrl = (key: string, action = '') => `/api/case/${encodeURIComponent(key)}${action}`;

export const fetchCase = async (key: string): Promise<CaseDetail> => {
  const response = await fetch(caseUrl(key));
  if (!response.ok) throw new Error(`${response.status} ${(await response.json()).error ?? ''}`);
  return response.json();
};

export const fetchSnapshot = async (
  key: string,
  condition: string,
  combo: number,
): Promise<CaseSnapshot> => {
  const response = await fetch(
    `${caseUrl(key, '/snapshot')}?condition=${encodeURIComponent(condition)}&combo=${combo}`,
  );
  if (!response.ok) throw new Error(`${response.status} ${(await response.json()).error ?? ''}`);
  return response.json();
};

export const shotUrl = (key: string, side: 'base' | 'head', condition: string, combo: number) =>
  `${caseUrl(key, '/shot')}?side=${side}&condition=${encodeURIComponent(condition)}&combo=${combo}&run=${encodeURIComponent(servedRun)}`;

export interface CorpusEntry {
  actual: string;
  detail: string[];
  expected: string;
  feature: string;
  id: string;
  passed: boolean;
}

export interface SelfTestPayload {
  css: CorpusEntry[];
  passed: boolean;
  ranAt: string;
  source: CorpusEntry[];
  verifierVersion: string;
}

export const fetchMethod = async (): Promise<{ selfTest: SelfTestPayload | null }> => {
  const response = await fetch('/api/method');
  if (!response.ok) throw new Error(`/api/method ${response.status}`);
  return response.json();
};

export const cropShotUrl = (key: string, side: 'base' | 'head', condition: string, combo: number) =>
  `${shotUrl(key, side, condition, combo)}&crop=1&reveal=1`;

export type ReviewState = 'changed' | 'passed' | 'reworked' | 'todo' | 'waiting-agent';

export interface ReviewView {
  ask: string;
  canPass: boolean;
  category: string;
  comboDifferences: Array<{ combo: number; condition: string; summary: string[] }>;
  combos: Array<{ index: number; label: string }>;
  component?: string;
  differingConditions: string[];
  errors: string[];
  file: string;
  flags: string[];
  hash: string;
  key: string;
  needsAgent: boolean;
  note?: { finding: string; suggestion: 'pass' | 'rework' };
  rework?: { at: string; note: string; reviewer: string };
  standIns: Partial<Record<'base' | 'head', string[]>>;
  state: ReviewState;
  styles: {
    blocks: Array<{
      rows: Array<{
        after: string[];
        before: string[];
        differs: boolean;
        label: string;
        movedTo?: string[];
        oneSided: boolean;
      }>;
      slot: string;
      standIn?: string;
    }>;
    counterpart?: 'base' | 'head';
    moved: Record<
      string,
      Array<{ selectors: string[]; slot: string; tags: string[]; text: string }>
    >;
    source: Partial<Record<'base' | 'head', Record<string, string>>>;
    usage: Partial<Record<'base' | 'head', string[]>>;
  };
  summary: string[];
  title: string;
}

export interface ReviewPayload {
  conditions: string[];
  counts: Record<ReviewState | 'proven' | 'total', number>;
  follow?: FollowInfo;
  items: ReviewView[];
  pr?: { branch: string; number: number; title: string };
  resolved: Array<{ key: string; note: string; resolvedAt: string }>;
  run: { base: string; head: string; runId: string };
  verdict: { mergeable: boolean; reasons: string[] };
}

export const fetchReview = async (): Promise<ReviewPayload> => {
  const response = await fetch('/api/review');
  if (!response.ok) throw new Error(`/api/review ${response.status}`);
  return remember(await response.json());
};

export interface CaseReview {
  conditions: string[];
  item: ReviewView;
  queued: boolean;
}

export const fetchCaseReview = async (key: string): Promise<CaseReview> => {
  const response = await fetch(`/api/case/${encodeURIComponent(key)}/review`);
  if (!response.ok) throw new Error(`/api/case review ${response.status}`);
  return response.json();
};

export const postReview = async (body: {
  action: 'pass' | 'rework';
  key: string;
  note: string;
}): Promise<ReviewPayload> => {
  const response = await fetch('/api/review', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `/api/review ${response.status}`);
  return remember(payload);
};
