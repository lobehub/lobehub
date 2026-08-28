import { ImageIcon, ImageOffIcon, type LucideIcon } from 'lucide-react';

/** Thumbnail load states the placeholder has to speak for. */
export type ThumbnailStatus = 'loading' | 'loaded' | 'error';

/**
 * Icon standing in for a thumbnail that is not on screen.
 *
 * A pending thumbnail and a failed one are different messages: the plain frame
 * reads as "still coming", which stops being true the moment the load fails.
 * The struck-through frame is the icon language for "this image cannot be
 * shown", so a permanently missing bitmap stops looking like a slow one.
 */
export const readPlaceholderIcon = (status: ThumbnailStatus): LucideIcon =>
  status === 'error' ? ImageOffIcon : ImageIcon;
