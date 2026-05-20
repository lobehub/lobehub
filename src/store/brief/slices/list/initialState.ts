import { type BriefItem } from '@/store/brief/types';

export interface BriefListState {
  briefs: BriefItem[];
  isBriefsInit: boolean;
}

export const initialBriefListState: BriefListState = {
  briefs: [],
  isBriefsInit: false,
};
