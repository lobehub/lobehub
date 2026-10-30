import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { projectService } from '@/services/project';
import { useFileStore } from '@/store/file';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';

const MAX_LOGO_SIZE = 2 * 1024 * 1024;

type ProjectPatch = Parameters<typeof projectService.update>[1];

/**
 * Saves one field of the project. The store applies the patch optimistically,
 * so the header, sidebar and tabs pick it up before the request returns.
 * Resolves to the saved project, or `undefined` when the save failed.
 */
export const useSaveProjectField = (projectId: string) => {
  const { t } = useTranslation('project');
  const updateProject = useProjectStore((s) => s.updateProject);
  const [saving, setSaving] = useState(false);

  const save = async (patch: ProjectPatch, successMessage = t('settings.saved')) => {
    setSaving(true);
    try {
      const saved = await updateProject(projectId, patch);
      toast.success(successMessage);
      return saved;
    } catch (error) {
      console.error('Failed to update project', error);
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return { save, saving };
};

/** The logo saves as soon as it changes: there is no draft to confirm. */
export const useProjectLogo = (project: ProjectDetail['project']) => {
  const { t } = useTranslation('project');
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const { save, saving } = useSaveProjectField(project.id);
  const [uploading, setUploading] = useState(false);
  const avatar = project.avatar || null;

  const saveLogo = async (next: string | null) => {
    if (next === avatar) return;
    await save({ avatar: next }, t('settings.logoUpdated'));
  };

  const onUpload = async (file: File) => {
    if (file.size > MAX_LOGO_SIZE) {
      toast.error(t('settings.logoSizeExceeded'));
      return;
    }

    setUploading(true);
    try {
      const result = await uploadWithProgress({ file });
      if (!result?.url) {
        toast.error(t('settings.logoUploadFailed'));
        return;
      }
      await saveLogo(result.url);
    } catch (error) {
      console.error('Failed to upload project logo', error);
      toast.error(t('settings.logoUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  // Deleting goes through `onDelete`; uploads arrive as data URLs before
  // `onUpload` has stored the file.
  const onChange = (next: string | null | undefined) => {
    if (!next || next.startsWith('data:')) return;
    void saveLogo(next);
  };

  const onDelete = () => saveLogo(null);

  return { avatar, busy: uploading || saving, onChange, onDelete, onUpload };
};
