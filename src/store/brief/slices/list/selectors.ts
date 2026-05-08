import { type BriefStore } from '@/store/brief/store';

const briefs = (s: BriefStore) => s.briefs;
const hasBriefs = (s: BriefStore) => s.briefs.length > 0;
const isBriefsInit = (s: BriefStore) => s.isBriefsInit;

export const briefListSelectors = {
  briefs,
  hasBriefs,
  isBriefsInit,
};
