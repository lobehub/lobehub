const CLOSED_THINK_BLOCK = /<think\b[^>]*>[\S\s]*?<\/think\s*>/gi;
const UNCLOSED_THINK_BLOCK = /<think\b[^>]*>[\S\s]*$/gi;
const ORPHAN_THINK_TAG = /<\/?think\b[^>]*>/gi;

/** Remove model reasoning from the compact Home inbox preview. */
export const sanitizeInboxPreview = (content: string) =>
  content
    .replaceAll(CLOSED_THINK_BLOCK, '')
    .replaceAll(UNCLOSED_THINK_BLOCK, '')
    .replaceAll(ORPHAN_THINK_TAG, '')
    .trim();
