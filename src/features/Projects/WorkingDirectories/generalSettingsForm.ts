import { isProjectSlugValid } from '../createProjectForm';

export interface GeneralSettingsSource {
  avatar?: string | null;
  description?: string | null;
  name: string;
  slug?: string | null;
}

export interface GeneralSettingsDraft {
  avatar: string | null;
  description: string;
  name: string;
  slug: string;
}

export interface GeneralSettingsPatch {
  avatar?: string | null;
  description?: string | null;
  name?: string;
  slug?: string | null;
}

export const toGeneralSettingsDraft = (project: GeneralSettingsSource): GeneralSettingsDraft => ({
  avatar: project.avatar ?? null,
  description: project.description ?? '',
  name: project.name,
  slug: project.slug ?? '',
});

export const diffGeneralSettings = (
  project: GeneralSettingsSource,
  draft: GeneralSettingsDraft,
) => {
  const patch: GeneralSettingsPatch = {};
  const name = draft.name.trim();
  const slug = draft.slug.trim() || null;
  const description = draft.description.trim() || null;

  if (name && name !== project.name) patch.name = name;
  if (slug !== (project.slug || null)) patch.slug = slug;
  if (description !== (project.description || null)) patch.description = description;
  if (draft.avatar !== (project.avatar ?? null)) patch.avatar = draft.avatar;

  return {
    count: Object.keys(patch).length,
    patch,
    valid: Boolean(name) && isProjectSlugValid(draft.slug),
  };
};
