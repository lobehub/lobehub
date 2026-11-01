import { useState } from 'react';

/** Keep the path draft and folder-creation input tied to the same directory. */
export const useDirectoryBrowserState = (defaultPath?: string) => {
  const [path, setPath] = useState(defaultPath);
  const [draft, setDraft] = useState<string>();
  const [creatingFolder, setCreatingFolder] = useState(false);

  const navigate = (nextPath?: string) => {
    setDraft(undefined);
    setCreatingFolder(false);
    setPath(nextPath);
  };

  const editPath = (nextDraft: string) => {
    setDraft(nextDraft);
    setCreatingFolder(false);
  };

  const isPathConfirmed = (directoryPath?: string) =>
    directoryPath !== undefined && (draft === undefined || draft.trim() === directoryPath);

  return { creatingFolder, draft, editPath, isPathConfirmed, navigate, path, setCreatingFolder };
};
