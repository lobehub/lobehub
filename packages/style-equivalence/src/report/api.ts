import type { ReportCase } from './data';

export interface VerdictEntry {
  category: string;
  file: string;
  flags: string[];
  hash: string;
  key: string;
  signoff: 'missing' | 'not-needed' | 'stale' | 'valid';
}

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
  mutation: {
    caught: number;
    equivalent: number;
    evaluated: number;
    mutants: Array<{
      caseKey: string;
      description: string;
      expected: string[];
      detected: string[];
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
      combos: Array<Record<string, boolean>>;
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
  `${caseUrl(key, '/shot')}?side=${side}&condition=${encodeURIComponent(condition)}&combo=${combo}`;

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

export const postSignoff = async (body: {
  keys: string[];
  note: string;
  reason: string;
}): Promise<{ verdict: RunPayload['verdict'] }> => {
  const response = await fetch('/api/signoff', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.json()).error ?? ''}`);
  return response.json();
};
