export type ReportCategory = 'blocking' | 'difference' | 'equal' | 'needs-signoff';
export type FileStatus = ReportCategory;
export type CellStatus = 'difference' | 'equal' | 'flagged-difference' | 'unknown';

export interface RootCause {
  after?: string;
  before?: string;
  key: string;
  property: string;
}

export interface ReportCase {
  category: ReportCategory;
  key: string;
  plan: {
    combos?: unknown[];
    elementIds?: { base: string; head: string };
    file: string;
    flags: string[];
  };
  result: {
    comboDifferences?: Array<{ combo: number; condition: string; rootCauses: RootCause[] }>;
    differingConditions: string[];
    errors?: string[];
    gaps: string[];
    rootCauses: RootCause[];
    status?: string;
    unstableConditions?: string[];
  };
}

export interface UnpairedEntry {
  file: string;
  key: string;
}

export interface TreeFile {
  file: string;
  name: string;
  open: number;
  status: FileStatus;
  total: number;
}

const RANK: Record<FileStatus, number> = {
  'blocking': 3,
  'difference': 2,
  'equal': 0,
  'needs-signoff': 1,
};

export const buildTree = (cases: ReportCase[], unpaired: UnpairedEntry[]) => {
  const files = new Map<string, TreeFile>();
  const touch = (file: string) => {
    const existing = files.get(file);
    if (existing) return existing;
    const created: TreeFile = {
      file,
      name: file.slice(file.lastIndexOf('/') + 1),
      open: 0,
      status: 'equal',
      total: 0,
    };
    files.set(file, created);
    return created;
  };
  for (const entry of cases) {
    const file = touch(entry.plan.file);
    file.total++;
    if (entry.category !== 'equal') file.open++;
    if (RANK[entry.category] > RANK[file.status]) file.status = entry.category;
  }
  for (const entry of unpaired) {
    const file = touch(entry.file);
    file.total++;
    file.open++;
    if (RANK[file.status] < RANK['needs-signoff']) file.status = 'needs-signoff';
  }
  const directories = new Map<string, TreeFile[]>();
  for (const file of files.values()) {
    const directory = file.file.slice(0, Math.max(file.file.lastIndexOf('/'), 0));
    directories.set(directory, [...(directories.get(directory) ?? []), file]);
  }
  return [...directories.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, list]) => ({
      directory,
      files: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));
};

export interface ConditionColumn {
  label: string;
  state: string;
  theme: string;
  variant?: string;
  width: number;
}

const BASE_STATES = ['default', 'hover-chain', 'hover-target', 'focus-visible'];
const themeRank = (theme: string) => (theme === 'light' ? 0 : theme === 'dark' ? 1 : 2);
const stateRank = (state: string) => {
  const index = BASE_STATES.indexOf(state);
  return index === -1 ? BASE_STATES.length : index;
};

export const conditionColumns = (labels: string[]): ConditionColumn[] =>
  [...new Set(labels)]
    .map((label) => {
      const [theme, width, state, variant] = label.split('/');
      return { label, state, theme, variant, width: Number(width) };
    })
    .sort(
      (a, b) =>
        themeRank(a.theme) - themeRank(b.theme) ||
        a.theme.localeCompare(b.theme) ||
        a.width - b.width ||
        Number(Boolean(a.variant)) - Number(Boolean(b.variant)) ||
        stateRank(a.state) - stateRank(b.state) ||
        a.state.localeCompare(b.state) ||
        (a.variant ?? '').localeCompare(b.variant ?? ''),
    );

const isFlagged = (entry: ReportCase) =>
  entry.plan.flags.length > 0 || entry.result.gaps.length > 0;

export const fileMatrix = (cases: ReportCase[], columns: ConditionColumn[]) => {
  const measured = cases.filter((entry) => entry.category !== 'blocking');
  return columns.map(({ label }) => {
    if (!measured.length) return { count: 0, label, status: 'unknown' as CellStatus };
    const differing = measured.filter((entry) => entry.result.differingConditions.includes(label));
    const status: CellStatus = !differing.length
      ? 'equal'
      : differing.some((entry) => !isFlagged(entry))
        ? 'difference'
        : 'flagged-difference';
    return { count: differing.length, label, status };
  });
};

export const caseStrip = (entry: ReportCase, columns: ConditionColumn[]) =>
  columns.map(({ label }) => ({
    label,
    status: (entry.category === 'blocking'
      ? 'unknown'
      : entry.result.differingConditions.includes(label)
        ? isFlagged(entry)
          ? 'flagged-difference'
          : 'difference'
        : 'equal') as CellStatus,
  }));

export const overviewRows = (cases: ReportCase[], columns: ConditionColumn[]) => {
  const files = [...new Set(cases.map((entry) => entry.plan.file))].map((file) => {
    const list = cases.filter((entry) => entry.plan.file === file);
    return {
      file,
      matrix: fileMatrix(list, columns),
      open: list.filter((entry) => entry.category !== 'equal').length,
    };
  });
  return {
    equal: files.filter((file) => !file.open),
    open: files
      .filter((file) => file.open)
      .sort((a, b) => b.open - a.open || a.file.localeCompare(b.file)),
  };
};
