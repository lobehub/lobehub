/**
 * The raw, stored payload of one tool message, as a projector sees it.
 *
 * `content` and `pluginState` are what the DB holds. They serve TWO audiences
 * that have been conflated so far: the model (the whole blob is replayed into
 * the LLM context) and the screen (a render component picks a handful of fields
 * out of it). A projector exists to split those apart.
 */
export interface ToolProjectorInput {
  apiName: string;
  /** JSON-encoded tool call arguments, exactly as the model produced them. */
  arguments?: string;
  content: string;
  identifier: string;
  pluginState?: unknown;
}

/**
 * What a projector hands back. Both fields are optional and OMISSION MEANS
 * "keep what is stored" — a projector that only shrinks `pluginState` leaves
 * `content` untouched by simply not returning it.
 *
 * Returning `content: null` drops the body entirely; use it when the render
 * needs nothing from it (the length is preserved separately as
 * `UIChatMessage.contentLength`, which several presence checks rely on).
 */
export interface ToolProjection {
  content?: string | null;
  pluginState?: unknown;
  /**
   * Who still needs the stored payload once this projection applies.
   *
   * `'detail'` (the default) means the inline card is complete on its own and
   * only a detail surface — the crawl portal, the raw viewer — has to fetch.
   * `'render'` means the card itself renders the body, so it must be hydrated
   * when the row is expanded.
   *
   * Declared here, next to the projection that created the gap, so the two
   * cannot drift the way a separate registry would.
   */
  storedPayloadNeededBy?: 'detail' | 'render';
}

/**
 * Reduces one tool message's stored payload to what the UI actually renders.
 *
 * MUST be pure and dependency-free: it runs on the server, inside the read
 * path, for every tool message of every query. Return `undefined` to decline
 * (the message passes through untouched), which is also the correct answer for
 * a payload shape the projector does not recognise — a projector must never
 * throw on unexpected input, and must never invent data that was not stored.
 */
export type ToolProjector = (input: ToolProjectorInput) => ToolProjection | undefined;
