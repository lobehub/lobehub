export const groupedRepo = '/Users/fixture/lobehub';
export const flatRepo = '/Users/fixture/lobe-chat';

type Status = 'added' | 'deleted' | 'modified';

const file = (filePath: string, status: Status, additions: number, deletions: number) => ({
  additions,
  deletions,
  filePath,
  isBinary: false,
  patch: '',
  status,
  truncated: false,
});

const parentPatches = [
  file('src/features/Conversation/WorkingSidebar/Review/FileRow.tsx', 'modified', 18, 7),
  file('src/features/Conversation/WorkingSidebar/Review/GroupHeader.tsx', 'modified', 9, 12),
  file('packages/locales/src/default/chat.ts', 'added', 4, 0),
];

const reviewData: Record<string, unknown> = {
  [flatRepo]: { mode: 'unstaged', patches: parentPatches },
  [groupedRepo]: {
    mode: 'unstaged',
    patches: parentPatches,
    submodules: [
      {
        absolutePath: `${groupedRepo}/packages/lobe-ui`,
        branch: 'feat/stylex-review',
        name: 'lobe-ui',
        patches: [
          file('src/PatchDiff/PatchDiff.tsx', 'modified', 6, 3),
          file('src/PatchDiff/style.ts', 'deleted', 0, 41),
        ],
        relativePath: 'packages/lobe-ui',
      },
      {
        absolutePath: `${groupedRepo}/packages/business`,
        branch: 'main',
        name: 'business',
        patches: [],
        relativePath: 'packages/business',
      },
    ],
  },
};

export const useReviewPatches = (workingDirectory: string) => ({
  data: reviewData[workingDirectory],
  error: undefined,
  isLoading: false,
  isValidating: false,
});
export const useGitRemoteBranches = () => ({ data: undefined });
export const useFetchGitBranch = (_deviceId: string | undefined, path?: string) => ({
  data: path ? { branch: 'canary', detached: false } : undefined,
});
export const getReviewSummaryState = () => ({ diffPending: false, isSummary: false });
export const invalidateGitReviewCaches = async () => {};

export const itemKey = (groupPath: string, entry: { filePath: string; status: string }) =>
  `${groupPath}|${entry.status}:${entry.filePath}`;
export const getDefaultExpandedKeys = (): string[] => [];

const storeState = { addChatContextSelection: () => {}, revealInFilesTab: () => {} };
const select = <T>(selector: (state: typeof storeState) => T) => selector(storeState);
export const useFileStore = select;
export const useGlobalStore = select;
export const gitService = { revertGitFile: async () => ({ success: true }) };
export const nanoid = () => 'fixture';

const FileTreeNav = () => null;

export default FileTreeNav;
