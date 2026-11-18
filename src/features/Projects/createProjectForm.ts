import { PROJECT_FIRST_NAVIGATION } from '@lobechat/business-const';
import {
  PROJECT_DUPLICATE_IDENTIFIER,
  PROJECT_DUPLICATE_SLUG,
  PROJECT_IDENTIFIER_REGEX,
  type ProjectDuplicateField,
} from '@lobechat/types';
import { kebabCase } from 'es-toolkit';
import { pinyin } from 'pinyin-pro';

import { isTrpcErrorCode } from '@/utils/trpcError';

const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECT_IDENTIFIER_LENGTH = 4;

export interface CreateProjectDraft {
  identifier: string;
  name: string;
  slug: string;
}

export interface ProjectFieldSuggestions {
  identifier: string;
  slug: string;
}

export const getProjectFieldSuggestions = (name: string): ProjectFieldSuggestions => {
  const normalizedName = name.trim();
  if (!normalizedName) return { identifier: '', slug: '' };

  const transliteratedName = pinyin(normalizedName, {
    nonZh: 'consecutive',
    toneType: 'none',
    type: 'array',
  }).join(' ');
  const slug = kebabCase(transliteratedName).replaceAll(/[^a-z0-9-]/g, '');
  const parts = slug.split('-').filter(Boolean);
  const initials = parts.map((part) => part[0]).join('');
  const compactName = parts.join('');
  const identifierSource = initials.length >= 3 ? initials : compactName;
  const identifier = identifierSource
    .slice(0, PROJECT_IDENTIFIER_LENGTH)
    .padEnd(3, 'x')
    .toUpperCase();

  return { identifier, slug };
};

export const isProjectIdentifierValid = (identifier: string) =>
  PROJECT_IDENTIFIER_REGEX.test(identifier.trim().toUpperCase());

export const getProjectConflictField = (error: unknown): ProjectDuplicateField | undefined => {
  if (!isTrpcErrorCode(error, 'CONFLICT') || !error || typeof error !== 'object') return;
  if (!('message' in error)) return;
  if (error.message === PROJECT_DUPLICATE_IDENTIFIER) return 'identifier';
  if (error.message === PROJECT_DUPLICATE_SLUG) return 'slug';
};

export const isProjectSlugValid = (slug: string) => {
  const normalizedSlug = slug.trim().toLowerCase();
  return !normalizedSlug || PROJECT_SLUG_REGEX.test(normalizedSlug);
};

export const getCreateProjectInput = (draft: CreateProjectDraft) => {
  const identifier = draft.identifier.trim().toUpperCase();
  const name = draft.name.trim();
  const slug = draft.slug.trim().toLowerCase();

  if (!name || !isProjectIdentifierValid(identifier) || !isProjectSlugValid(slug)) {
    return null;
  }

  return { identifier, name, ...(slug ? { slug } : {}) };
};

/**
 * Where a project created from a plain "New project" leads: its page, or
 * nowhere when projects lead the Home panel, which lists the new one at once.
 */
export const getCreatedProjectPath = (project: { id: string; slug?: string | null }) =>
  PROJECT_FIRST_NAVIGATION ? undefined : `/project/${project.slug ?? project.id}`;
