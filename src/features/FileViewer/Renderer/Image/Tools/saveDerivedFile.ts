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

  for (const knowledgeBaseId of location?.knowledgeBaseIds ?? []) {
    // The file is already saved; a library link that fails only hides it there.
    await deps.addToKnowledgeBase(knowledgeBaseId, [result.id]).catch((error) => {
      console.error('[ImageViewer] failed to add the edited image to its library', error);
    });
  }

  return result;
};
