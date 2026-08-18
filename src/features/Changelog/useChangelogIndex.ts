import useSWR from 'swr';

import { changelogKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

export const useChangelogIndex = () => {
  const { data, error, isLoading, mutate } = useSWR(changelogKeys.index(), () =>
    lambdaClient.changelog.getIndex.query(),
  );

  return { data, error, isLoading, retry: () => mutate() };
};
