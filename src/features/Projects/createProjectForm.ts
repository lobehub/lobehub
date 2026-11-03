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

/**
 * Whether an already-loaded project in the active scope claims `identifier`.
 *
 * Identifiers are unique per scope (`projects_identifier_workspace_id_unique`),
 * so the form checks this inline and shows the conflict next to the field. The
 * list is visibility-filtered, so another member's private project can slip
 * past here — the server re-checks and answers `CONFLICT` for that case.
 */
export const isProjectIdentifierTaken = (
  identifier: string,
  projects: readonly { identifier?: string | null }[],
) => {
  const normalized = identifier.trim().toUpperCase();

  return Boolean(normalized) && projects.some((project) => project.identifier === normalized);
};

/**
 * Whether a `CONFLICT` answered for `submittedIdentifier` still describes the
 * value in the field.
 *
 * The identifier input stays editable while the create request is in flight, so
 * the answer can come back after the user has typed another value. The verdict
 * belongs to what was submitted; a different value typed meanwhile must not
 * inherit it. An empty submission carries no identifier (the server leaves the
 * column null), so it has nothing to attribute the conflict to.
 */
export const doesConflictApplyTo = (submittedIdentifier: string, currentIdentifier: string) => {
  const submitted = submittedIdentifier.trim().toUpperCase();

  return Boolean(submitted) && currentIdentifier.trim().toUpperCase() === submitted;
};

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
