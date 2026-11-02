import { PROJECT_IDENTIFIER_REGEX } from '@lobechat/types';
import { kebabCase } from 'es-toolkit';
import { pinyin } from 'pinyin-pro';

const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CreateProjectDraft {
  identifier: string;
  name: string;
  slug: string;
}

export interface ProjectFieldSuggestions {
  slug: string;
}

export const getProjectFieldSuggestions = (name: string): ProjectFieldSuggestions => {
  const normalizedName = name.trim();
  if (!normalizedName) return { slug: '' };

  const transliteratedName = pinyin(normalizedName, {
    nonZh: 'consecutive',
    toneType: 'none',
    type: 'array',
  }).join(' ');
  const slug = kebabCase(transliteratedName).replaceAll(/[^a-z0-9-]/g, '');

  return { slug };
};

export const isProjectIdentifierValid = (identifier: string) =>
  PROJECT_IDENTIFIER_REGEX.test(identifier.trim().toUpperCase());

export const isProjectSlugValid = (slug: string) => {
  const normalizedSlug = slug.trim().toLowerCase();
  return !normalizedSlug || PROJECT_SLUG_REGEX.test(normalizedSlug);
};

export const getCreateProjectInput = (draft: CreateProjectDraft) => {
  const identifier = draft.identifier.trim().toUpperCase();
  const name = draft.name.trim();
  const slug = draft.slug.trim().toLowerCase();

  // The identifier is optional; left empty, tasks keep the default prefix.
  if (!name || (identifier && !isProjectIdentifierValid(identifier)) || !isProjectSlugValid(slug)) {
    return null;
  }

  return { name, ...(identifier ? { identifier } : {}), ...(slug ? { slug } : {}) };
};

export interface CreateProjectExtras {
  avatar?: string;
  /** The picked agent; only sent when the project reuses an existing agent. */
  mainAgentId?: string;
  mainAgentMode: 'dedicated' | 'existing';
}

/**
 * Leaving `coordinatorAgentId` out is what makes the server create an agent
 * for the project, named after it and wearing its avatar.
 */
export const buildCreateProjectRequest = (
  input: NonNullable<ReturnType<typeof getCreateProjectInput>>,
  { avatar, mainAgentId, mainAgentMode }: CreateProjectExtras,
) => ({
  ...input,
  ...(avatar ? { avatar } : {}),
  ...(mainAgentMode === 'existing' && mainAgentId ? { coordinatorAgentId: mainAgentId } : {}),
});
