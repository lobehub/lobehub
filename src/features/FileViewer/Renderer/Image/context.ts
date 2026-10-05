import { createContext, use } from 'react';

import type { DerivedImageOperation, Point, Rotation, Size } from './geometry';
import type { ImageMarkup } from './Tools/markup';

/** An edit saved from this viewer, shown next to the original for comparison. */
export interface ImageVersion {
  fileId: string;
  name: string;
  operation: DerivedImageOperation;
  url: string;
}

/**
 * What the viewer shares with mounted tools: the file identity, the displayed
 * image geometry, and the element tools draw over. Tools own their own state;
 * the viewer only exposes the stage.
 */
export interface ImageStageValue {
  /** Register a saved edit and show it on stage; the original stays one click away. */
  addVersion: (version: ImageVersion) => void;
  fileId: string;
  /** Lets a tool ask the viewer to fit the image back on screen. */
  fitToScreen: () => void;
  /**
   * Unsent annotations and comments for the version on stage. The viewer keeps
   * them per version in memory, so switching versions does not drop them and
   * closing the viewer does.
   */
  markup: ImageMarkup;
  name?: string;
  /** Natural pixel size, known once the image has loaded. */
  naturalSize?: Size;
  /** Element covering the displayed (rotated, zoomed) image; tools portal overlays into it. */
  overlayElement: HTMLDivElement | null;
  rotation: Rotation;
  setMarkup: (markup: ImageMarkup) => void;
  /** Map a pointer position to a normalized point on the image. */
  toImagePoint: (client: Point) => Point | undefined;
  url: string;
  zoom: number;
}

export const ImageStageContext = createContext<ImageStageValue | null>(null);

export const useImageStage = () => {
  const value = use(ImageStageContext);
  if (!value) throw new Error('useImageStage must be used inside the image viewer');
  return value;
};
