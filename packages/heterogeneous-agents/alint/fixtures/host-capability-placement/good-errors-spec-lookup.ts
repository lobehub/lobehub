// Fixture: src/errors/specs.ts — error specs the web app uses to render a hetero error card.
import type { HeteroErrorCategory } from './taxonomy';

export interface HeteroErrorSpec {
  category: HeteroErrorCategory;
  guideKey: string;
  userSide: boolean;
}

export const HETERO_ERROR_SPECS: Record<string, HeteroErrorSpec> = {
  CLI_NOT_FOUND: { category: 'environment', guideKey: 'install', userSide: true },
  RATE_LIMITED: { category: 'quota', guideKey: 'quota', userSide: true },
};

export const getHeteroErrorSpec = (code: string): HeteroErrorSpec | undefined =>
  HETERO_ERROR_SPECS[code];
