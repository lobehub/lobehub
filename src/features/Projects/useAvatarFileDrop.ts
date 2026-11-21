import { type DragEvent, useRef, useState } from 'react';

/** The image types the avatar picker's own uploader accepts. */
const AVATAR_IMAGE_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export const isFileDrag = (dataTransfer: DataTransfer | null) =>
  !!dataTransfer && Array.from(dataTransfer.types).includes('Files');

/** The first dropped file usable as an avatar, if any. */
export const pickAvatarFile = (files: ArrayLike<File> | null | undefined) =>
  Array.from(files ?? []).find((file) => AVATAR_IMAGE_TYPES.has(file.type));

interface UseAvatarFileDropOptions {
  disabled?: boolean;
  onFile: (file: File) => void;
  /** Files were dropped, but none of them is an image. */
  onReject?: () => void;
}

/**
 * Accept an image dropped anywhere on the element the returned props are spread
 * on. Events keep bubbling: the app-wide drag overlay listens on `window` and
 * must see the drop to close.
 */
export const useAvatarFileDrop = ({ disabled, onFile, onReject }: UseAvatarFileDropOptions) => {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossed, so count the nesting.
  const depth = useRef(0);

  const accepts = (event: DragEvent) => !disabled && isFileDrag(event.dataTransfer);

  const dropProps = {
    onDragEnter: (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!accepts(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDragOver: (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDrop: (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = pickAvatarFile(event.dataTransfer.files);
      if (file) onFile(file);
      else onReject?.();
    },
  };

  return { dragging, dropProps };
};
