/**
 * Shared text representation for images echoed by a tool_result (CC `Read` on
 * an image file). The adapter emits {@link imagePlaceholder} pre-upload (it only
 * has base64, not a URL); once the runtime pipeline uploads the image it swaps
 * that placeholder for {@link imageMarkdown} via {@link rewriteImagePlaceholders},
 * so a downstream model handed this history sees a real image reference instead
 * of an opaque `[Image: …]` token.
 *
 * Keeping both the emit and the rewrite here means the adapter and pipeline
 * can't drift on the placeholder shape.
 */

/** Pre-upload placeholder: the adapter has no URL yet, only the media type. */
export const imagePlaceholder = (mediaType: string): string => `[Image: ${mediaType}]`;

/** Post-upload text: a markdown image so text-only consumers/models see a real reference. */
export const imageMarkdown = (mediaType: string, url: string): string => `![${mediaType}](${url})`;

/** Outcome of uploading one image, in adapter emission order. `url` unset ⇒ upload failed/dropped. */
export interface UploadedImageOutcome {
  mediaType: string;
  url?: string;
}

// Matches an `[Image: <mediaType>]` placeholder. `<mediaType>` never contains `]`.
const IMAGE_PLACEHOLDER_RE = /\[Image: [^\]]*]/g;

/**
 * Replace each `[Image: …]` placeholder — in the order the adapter emitted them,
 * which matches `outcomes` — with a markdown image for the images that uploaded
 * successfully. A placeholder whose image failed to upload is left untouched, so
 * it still signals "an image was here".
 *
 * Bails out unchanged when the placeholder count doesn't match `outcomes`: a
 * mismatch means the tokens can't be safely mapped to images (e.g. the tool
 * output happened to contain a literal `[Image: …]`), so we don't risk
 * corrupting the content.
 */
export const rewriteImagePlaceholders = (
  content: string,
  outcomes: UploadedImageOutcome[],
): string => {
  const matches = content.match(IMAGE_PLACEHOLDER_RE);
  if (!matches || matches.length !== outcomes.length) return content;

  let i = 0;
  return content.replace(IMAGE_PLACEHOLDER_RE, (original) => {
    const outcome = outcomes[i++];
    return outcome?.url ? imageMarkdown(outcome.mediaType, outcome.url) : original;
  });
};
