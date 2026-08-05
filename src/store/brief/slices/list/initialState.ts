import { type BriefItem } from '@/store/brief/types';

export interface BriefListState {
  briefs: BriefItem[];
  /**
   * Cache scope (`${userId}:${workspaceId}`) the current `briefs` were fetched
   * for. Briefs are per-user AND per-workspace rows, so a list carried across a
   * workspace switch is not merely stale — every id in it is unreachable in the
   * new scope, and acting on one 404s. Readers compare against the live scope
   * and treat a mismatch as "not loaded yet" rather than rendering rows the
   * server will refuse.
   */
  briefsScope?: string;
  isBriefsInit: boolean;
}

export const initialBriefListState: BriefListState = {
  briefs: [],
  briefsScope: undefined,
  isBriefsInit: false,
};
