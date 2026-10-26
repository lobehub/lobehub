import type { AcceptanceCheckRow as SharedAcceptanceCheckRow } from '@lobechat/utils/verify/acceptanceCheckUnion';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';

// The union is pure and shared with the CLI's local reports; the server reads
// it over its own result rows.
export type {
  AcceptanceCheckHistoryEntry,
  AcceptanceTimelineEntry,
} from '@lobechat/utils/verify/acceptanceCheckUnion';
export {
  buildAcceptanceCheckUnion,
  tallyCheckUnion,
} from '@lobechat/utils/verify/acceptanceCheckUnion';

export type AcceptanceCheckRow = SharedAcceptanceCheckRow<VerifyCheckResultItem>;
