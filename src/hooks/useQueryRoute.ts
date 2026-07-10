import { isOnServerSide } from '@lobechat/utils';
import { type ParsedQuery } from 'query-string';
import qs from 'query-string';
import { useMemo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface QueryRouteOptions {
  hash?: string;
  query?: ParsedQuery;
  replace?: boolean;
  replaceHash?: boolean;
  withHash?: boolean;
}

interface GenHrefOptions extends QueryRouteOptions {
  prevQuery?: ParsedQuery;
  url: string;
}

const genHref = ({ hash, replace, url, prevQuery = {}, query = {} }: GenHrefOptions): string => {
  let href = qs.stringifyUrl(
    { query: replace ? query : { ...prevQuery, ...query }, url },
    { skipNull: true },
  );

  if (!isOnServerSide && hash) {
    href = [href, hash || location?.hash?.slice(1)].filter(Boolean).join('#');
  }

  return href;
};

export const useQueryRoute = () => {
  const navigate = useWorkspaceAwareNavigate();

  return useMemo(
    () => ({
      push: (url: string, options: QueryRouteOptions = {}) => {
        const prevQuery = qs.parse(window.location.search);
        return navigate(genHref({ prevQuery, url, ...options }));
      },
      replace: (url: string, options: QueryRouteOptions = {}) => {
        const prevQuery = qs.parse(window.location.search);
        return navigate(genHref({ prevQuery, url, ...options }), { replace: true });
      },
    }),
    [navigate],
  );
};
