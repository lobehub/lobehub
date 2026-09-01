/**
 * Largest video the chat pipeline hands to a model as an inline `video_url`
 * part.
 *
 * A provider given a URL fetches the file and measures it against its own
 * ceiling, and it does so before inference: Volcengine Ark answers a 64 MiB
 * input with `InvalidParameter param=video_url ... exceeds the limit (50 MiB)`
 * in about 1.4 seconds. Because attachments stay in the conversation history,
 * one oversized video does not fail a single turn — it fails every later turn
 * in that topic too, whatever the user sends next.
 *
 * Anything above this goes to the media-analysis tool instead. That path
 * fetches the file on its own terms and is not bound by the inline limit, so
 * being under this number costs at most an extra tool call while being over it
 * costs the whole request.
 *
 * The value is Ark's, observed in production rather than read off a spec sheet
 * (see lobehub/lobehub#13881, where the same pass-the-URL-through design meets
 * a 20 MB variant of the limit). Prefer the most conservative ceiling among the
 * providers a deployment routes to.
 */
export const INLINE_VIDEO_SIZE_LIMIT = 50 * 1024 * 1024;
