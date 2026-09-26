import { localFileKeys } from '@/libs/swr/keys';
import { type OpenLocalFileParams } from '@/store/chat/slices/portal/initialState';

type PreviewTarget = Pick<
  OpenLocalFileParams,
  'deviceId' | 'filePath' | 'sandboxTopicId' | 'workingDirectory'
>;

/**
 * `mutate` matcher for every cached preview of one open tab. The body keys its
 * preview on more than the tab identity (image accept, external-file and
 * resource scope flags), so the header matches on the identity prefix — the
 * leading elements of `localFileKeys.preview` — and refreshes each variant.
 * A workspace suffix appended by the SWR layer sits after them and is ignored.
 */
export const matchLocalFilePreviewKey =
  ({ deviceId, filePath, sandboxTopicId, workingDirectory }: PreviewTarget) =>
  (key: unknown): boolean =>
    Array.isArray(key) &&
    key[0] === localFileKeys.preview.root &&
    key[1] === (sandboxTopicId ? `sandbox:${sandboxTopicId}` : (deviceId ?? 'local')) &&
    key[2] === filePath &&
    key[3] === workingDirectory;
