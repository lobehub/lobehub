import { useFolderPath } from './useFolderPath';

/** The folder the URL (`/resource/library/<id>/folder/<folderId>`) points at. */
export const useCurrentFolderId = () => useFolderPath().currentFolderId;
