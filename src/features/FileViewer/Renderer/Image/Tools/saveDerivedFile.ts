import type { AIEditDeps } from './AIEdit/runAIImageEdit';

export type SaveDerivedFileDeps = Pick<AIEditDeps, 'addToKnowledgeBase' | 'getFile' | 'uploadFile'>;

export interface SaveDerivedFileParams {
  file: File;
  metadata: Record<string, unknown>;
  /** Folder known on the client, used when the server lookup fails. */
  parentId?: string | null;
  sourceId: string;
}

/**
 * Add a saved edit to the original's libraries. The file is already saved, so
 * a failed link is reported (it only hides the file in that library) rather
 * than thrown. Returns whether any link failed.
 */
export const fileIntoLibraries = async (
  deps: Pick<SaveDerivedFileDeps, 'addToKnowledgeBase'>,
  knowledgeBaseIds: string[] | undefined,
  fileId: string,
) => {
  let failed = false;
  for (const knowledgeBaseId of knowledgeBaseIds ?? []) {
    await deps.addToKnowledgeBase(knowledgeBaseId, [fileId]).catch((error) => {
      console.error('[ImageViewer] failed to add the edited image to its library', error);
      failed = true;
    });
  }
  return failed;
};

/**
 * Upload an edited image as a new file beside its original: same folder and
 * same libraries. The original file is only read, never written.
 */
export const saveDerivedFile = async (
  deps: SaveDerivedFileDeps,
  { file, metadata, parentId, sourceId }: SaveDerivedFileParams,
) => {
  // Hosts such as the image grid or a library view do not carry the original's
  // folder and libraries on the client, so ask the server where it lives.
  const location = await deps.getFile(sourceId).catch((error) => {
    console.error('[ImageViewer] failed to read the original image location', error);
    return undefined;
  });

  const result = await deps.uploadFile({
    file,
    metadata,
    // A successful lookup wins even when it reports the top level (null).
    parentId: (location ? location.parentId : parentId) ?? undefined,
    // Collaborators who can see the original should see the edit too.
    visibility: location?.visibility ?? undefined,
  });
  if (!result) return;

  const libraryFailed = await fileIntoLibraries(deps, location?.knowledgeBaseIds, result.id);

  return { ...result, libraryFailed };
};
