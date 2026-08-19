import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { changelogKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type Locales } from '@/locales/resources';

export const useChangelogPost = (id: string | undefined) => {
  const { i18n } = useTranslation();
  const locale = i18n.language as Locales;

  const { data, error, isLoading, mutate } = useSWR(
    id ? changelogKeys.post(id, locale) : null,
    async () => lambdaClient.changelog.getPostById.query({ id: id!, locale }),
  );

  return { data, error, isLoading, retry: () => mutate() };
};
