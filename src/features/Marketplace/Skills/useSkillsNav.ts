import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import urlJoin from 'url-join';

import { useCatalogDetailNavigate } from '../Catalog/useCatalogDetailNavigate';
import { MARKETPLACE_SKILL_PATH } from '../paths';

/** A group's "all" page: `installed` or a market category. */
const GROUP_PARAM = 'group';
/** The GitHub import page; an empty value opens it with an empty address. */
const GITHUB_PARAM = 'github';

/**
 * Where the Skills pages are, kept in the URL so Back, reload and shared links
 * work: `?group=<category|installed>` is a group's page, `?github=<address>` the
 * GitHub import page, and `/marketplace/skill/<identifier>` a skill's page.
 */
export const useSkillsNav = () => {
  const [params, setParams] = useSearchParams();
  const openDetail = useCatalogDetailNavigate();

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      }),
    [setParams],
  );

  return {
    githubUrl: params.get(GITHUB_PARAM),
    group: params.get(GROUP_PARAM),
    openSkill: (identifier: string) =>
      openDetail(urlJoin(MARKETPLACE_SKILL_PATH, encodeURIComponent(identifier))),
    setGithubUrl: (url: string | null) => setParam(GITHUB_PARAM, url),
    setGroup: (group: string | null) => setParam(GROUP_PARAM, group),
  };
};
