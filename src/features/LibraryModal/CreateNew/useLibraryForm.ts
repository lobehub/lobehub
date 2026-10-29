import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { defaultCoverPreset, presetCoverValue } from '@/features/LibraryCover';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  DEFAULT_WORKSPACE_LIST_VISIBILITY,
  type ResourceListVisibilityFilter,
} from '@/features/ResourceManager/store/initialState';
import { readPersistedResourceMode } from '@/features/ResourceManager/store/modePersistence';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useKnowledgeBaseStore } from '@/store/library';

export interface LibraryFormOptions {
  id?: string;
  initialValues?: { cover?: string; description?: string; name?: string };
  /**
   * Visibility preselected by an entry that already states one (e.g. the
   * "Create a private knowledge base" empty state). Falls back to the space the user
   * last chose for this workspace.
   */
  initialVisibility?: ResourceListVisibilityFilter;
  onClose?: () => void;
  /** Called with the new library id; without it the form opens the library itself. */
  onSuccess?: (id: string) => void;
}

export const useLibraryForm = ({
  id,
  initialValues,
  initialVisibility,
  onClose,
  onSuccess,
}: LibraryFormOptions) => {
  const { t } = useTranslation('knowledgeBase');
  const navigate = useWorkspaceAwareNavigate();
  const workspaceId = useActiveWorkspaceId() ?? undefined;
  const [listVisibility, listVisibilityWorkspaceId, setListVisibility] = useResourceManagerStore(
    (s) => [s.listVisibility, s.listVisibilityWorkspaceId, s.setListVisibility],
  );
  const createNewKnowledgeBase = useKnowledgeBaseStore((s) => s.createNewKnowledgeBase);
  const updateKnowledgeBase = useKnowledgeBaseStore((s) => s.updateKnowledgeBase);
  const updateKnowledgeBaseCover = useKnowledgeBaseStore((s) => s.updateKnowledgeBaseCover);

  const isEditMode = !!id;
  // Visibility only exists in team workspaces, and an existing library changes
  // it through the guarded publish / make-private entries, never this form.
  const showVisibility = !!workspaceId && !isEditMode;

  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [name, setNameValue] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  // A new library has no id yet; a per-form seed keeps the previewed default
  // cover identical to the one it is created with.
  const [draftSeed] = useState(() => id ?? `draft-${Math.random().toString(36).slice(2)}`);
  const [cover, setCover] = useState<string | null>(initialValues?.cover ?? null);
  // Prefer the space the user is in right now; persistence is best-effort and
  // a failed write would leave a stale value behind. Fall back to the persisted
  // space only when the store was never hydrated for this workspace (e.g. a ⌘K
  // create from a chat page sees the 'workspace' default), so a library the
  // user meant to keep private is not silently shared.
  const [visibility, setVisibility] = useState<ResourceListVisibilityFilter>(
    () =>
      initialVisibility ??
      (workspaceId && listVisibilityWorkspaceId === workspaceId
        ? listVisibility
        : (readPersistedResourceMode(workspaceId) ?? DEFAULT_WORKSPACE_LIST_VISIBILITY)),
  );

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const coverChanged = cover !== (initialValues?.cover ?? null);
  const unchanged =
    isEditMode &&
    !coverChanged &&
    trimmedName === (initialValues?.name ?? '').trim() &&
    trimmedDescription === (initialValues?.description ?? '').trim();

  const setName = (value: string) => {
    setNameValue(value);
    if (value.trim()) setNameError(false);
  };

  const submit = async () => {
    if (loading) return;
    if (!trimmedName) {
      setNameError(true);
      return;
    }
    if (unchanged) return;

    setLoading(true);
    const values = { description: trimmedDescription, name: trimmedName };

    try {
      if (isEditMode) {
        // Edit only touches the metadata the form shows. `listVisibility`
        // describes the sidebar mode the user happens to be browsing in, not
        // this library's visibility — sending it would silently take a shared
        // library private just because its description was edited from the
        // Private tab. Publish / make-private have their own guarded entries.
        await updateKnowledgeBase(id, values);
        if (coverChanged) await updateKnowledgeBaseCover(id, cover);
        onClose?.();
        return;
      }

      const newId = await createNewKnowledgeBase({
        ...values,
        cover: cover ?? presetCoverValue(defaultCoverPreset(draftSeed).id),
        visibility: visibility === 'private' ? 'private' : 'public',
      });

      // Follow the new library into its space, otherwise the sidebar list keeps
      // filtering the other space and the library looks like it was never made.
      // Record it even when it equals an unhydrated store default: the next
      // /resource hydrate would otherwise restore a stale persisted space.
      if (workspaceId) setListVisibility(visibility, workspaceId);

      onClose?.();
      if (onSuccess) onSuccess(newId);
      else navigate(`/resource/library/${newId}`);
    } catch (error) {
      console.error(error);
      toast.error(t(isEditMode ? 'createNew.edit.error' : 'createNew.error'));
    } finally {
      setLoading(false);
    }
  };

  return {
    cover,
    description,
    draftSeed,
    isEditMode,
    loading,
    name,
    nameError,
    setCover,
    setDescription,
    setName,
    setVisibility,
    showVisibility,
    submit,
    submitDisabled: !trimmedName || unchanged,
    visibility,
  };
};
