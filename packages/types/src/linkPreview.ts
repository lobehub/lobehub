/**
 * The Open Graph summary of one web page, as a message link card paints it.
 * Text only: the image stays at the page's own address and is loaded by the
 * viewer's browser, so a preview never takes up anyone's storage.
 */
export interface LinkPreview {
  description?: string;
  /** Absolute `http(s)` address of the page's preview image. */
  image?: string;
  /** The page asked for a wide image card (`twitter:card` = `summary_large_image`). */
  largeImage?: boolean;
  siteName?: string;
  title?: string;
  /** The address the preview was read from. */
  url: string;
}
