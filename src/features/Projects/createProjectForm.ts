import { PROJECT_IDENTIFIER_REGEX } from '@lobechat/types';

const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CreateProjectDraft {
  identifier: string;
  name: string;
  slug: string;
}

export const isProjectSlugValid = (slug: string) => {
  const normalizedSlug = slug.trim().toLowerCase();
  return !normalizedSlug || PROJECT_SLUG_REGEX.test(normalizedSlug);
};

export const getCreateProjectInput = (draft: CreateProjectDraft) => {
  const identifier = draft.identifier.trim().toUpperCase();
  const name = draft.name.trim();
  const slug = draft.slug.trim().toLowerCase();

  if (!name || !PROJECT_IDENTIFIER_REGEX.test(identifier) || !isProjectSlugValid(slug)) {
    return null;
  }

  return { identifier, name, ...(slug ? { slug } : {}) };
};
