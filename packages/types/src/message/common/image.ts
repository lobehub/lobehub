import { z } from 'zod';

export interface ChatImageItem {
  alt: string;
  /** Intrinsic image height in pixels, when known from upload metadata. */
  height?: number;
  id: string;
  /**
   * MIME type of the stored file (e.g. `image/png`), when known. Used to keep
   * formats that vision APIs reject, such as `image/svg+xml`, out of model input.
   */
  mimeType?: string;
  /** Intrinsic aspect ratio (width / height), when known from upload metadata. */
  ratio?: number;
  url: string;
  /** Intrinsic image width in pixels, when known from upload metadata. */
  width?: number;
}

export const ChatImageItemSchema = z.object({
  alt: z.string(),
  height: z.number().optional(),
  id: z.string(),
  mimeType: z.string().optional(),
  ratio: z.number().optional(),
  url: z.string(),
  width: z.number().optional(),
});

export interface ChatImageChunk {
  data: string;
  id: string;
  isBase64?: boolean;
}
