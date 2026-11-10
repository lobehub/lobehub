import {
  PROJECT_DUPLICATE_IDENTIFIER,
  PROJECT_DUPLICATE_SLUG,
  PROJECT_IDENTIFIER_REGEX,
  type ProjectDuplicateField,
} from '@lobechat/types';
import { kebabCase } from 'es-toolkit';
import { pinyin } from 'pinyin-pro';

const PROJECT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Mirrors the `max(100)` on `projectSlugInput` in the project router. */
export const PROJECT_SLUG_MAX_LENGTH = 100;

const boundSlug = (slug: string) => slug.slice(0, PROJECT_SLUG_MAX_LENGTH).replace(/-+$/, '');

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
  const slug = boundSlug(kebabCase(transliteratedName).replaceAll(/[^a-z0-9-]/g, ''));

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
 * Whether a `CONFLICT` answered for `submitted` still describes the value in the
 * field.
 *
 * The inputs stay editable while the create request is in flight, so the answer
 * can come back after the user has typed another value. The verdict belongs to
 * what was submitted; a different value typed meanwhile must not inherit it. An
 * empty submission carries no value (the server generates the slug, and leaves
 * the identifier null), so it has nothing to attribute a conflict to.
 */
export const doesConflictApplyTo = (submitted: string, current: string) => {
  const submittedValue = submitted.trim().toUpperCase();

  return Boolean(submittedValue) && current.trim().toUpperCase() === submittedValue;
};

/**
 * The field a project `CONFLICT` belongs to.
 *
 * The create router answers a taken slug or identifier with a machine-readable
 * message (see `PROJECT_DUPLICATE_*`), so the form can put the error under the
 * input that resolves it. Any other conflict stays a generic failure.
 */
export const getProjectConflictField = (error: unknown): ProjectDuplicateField | undefined => {
  const conflict = error as { data?: { code?: string }; message?: string } | null | undefined;
  if (conflict?.data?.code !== 'CONFLICT') return undefined;
  if (conflict.message === PROJECT_DUPLICATE_IDENTIFIER) return 'identifier';
  if (conflict.message === PROJECT_DUPLICATE_SLUG) return 'slug';

  return undefined;
};

export const isProjectSlugValid = (slug: string) => {
  const normalizedSlug = slug.trim().toLowerCase();
  return (
    !normalizedSlug ||
    (normalizedSlug.length <= PROJECT_SLUG_MAX_LENGTH && PROJECT_SLUG_REGEX.test(normalizedSlug))
  );
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

/** Lead a new project with an agent created for it, or with an existing one. */
export type MainAgentMode = 'dedicated' | 'existing';

/**
 * Every new project starts with an agent of its own. Reusing an agent is an
 * explicit pick in the modal and is not carried over to the next project.
 */
export const DEFAULT_MAIN_AGENT_MODE: MainAgentMode = 'dedicated';

export interface CreateProjectExtras {
  avatar?: string;
  /** The picked agent; only sent when the project reuses an existing agent. */
  mainAgentId?: string;
  mainAgentMode: MainAgentMode;
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
