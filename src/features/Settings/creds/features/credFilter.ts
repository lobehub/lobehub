import { type CredType, type UserCredSummary } from '@lobechat/types';

import { CRED_TYPES } from './credTypes';

export type CredTypeFilterValue = CredType | 'all';

export interface CredFilter {
  /** Matched case-insensitively against the name, key and description. */
  keyword?: string;
  type?: CredTypeFilterValue;
}

export const isCredFilterActive = ({ keyword, type }: CredFilter) =>
  !!keyword?.trim() || (!!type && type !== 'all');

/** The rows the vault toolbar's search box and type filter leave. */
export const filterCreds = <
  T extends Pick<UserCredSummary, 'description' | 'key' | 'name' | 'type'>,
>(
  creds: T[],
  { keyword, type }: CredFilter,
): T[] => {
  const needle = keyword?.trim().toLowerCase();

  return creds.filter((cred) => {
    if (type && type !== 'all' && cred.type !== type) return false;
    if (!needle) return true;

    return [cred.name, cred.key, cred.description].some((text) =>
      text?.toLowerCase().includes(needle),
    );
  });
};

/**
 * How many rows each type tab would show: the search keyword applies, the
 * selected type does not, so switching tabs never changes the counts.
 */
export const countCredsByType = <
  T extends Pick<UserCredSummary, 'description' | 'key' | 'name' | 'type'>,
>(
  creds: T[],
  keyword?: string,
): Record<CredTypeFilterValue, number> => {
  const matched = filterCreds(creds, { keyword });
  const counts = { all: matched.length } as Record<CredTypeFilterValue, number>;
  for (const type of CRED_TYPES) counts[type] = 0;
  for (const cred of matched) counts[cred.type] += 1;
  return counts;
};
