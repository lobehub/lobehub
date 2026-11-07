/**
 * Source of an image for an agent prompt. Three input shapes are supported so
 * callers can pass whatever they have: a URL (CDN attachments), a local path
 * (terminal `--image ./pic.png`), or already-decoded base64 (programmatic).
 */
export type AgentImageSource =
  | {
      /** Stable id for cache dedupe. Falls back to a hash of the url. */
      id?: string;
      type: 'url';
      url: string;
    }
  | {
      path: string;
      type: 'path';
    }
  | {
      data: string;
      /** Mime type, e.g. `'image/png'`. */
      mediaType: string;
      type: 'base64';
    };

export interface AgentTextBlock {
  /**
   * Set when a context provider attached this block rather than the user typing
   * it, naming the provider (e.g. `LOBEHUB_CLI_GUIDE_CONTEXT`). It lets the
   * executing side drop a copy it delivers through a native channel instead.
   * Serializers never forward it to the agent.
   */
  context?: string;
  text: string;
  type: 'text';
}

export interface AgentImageBlock {
  source: AgentImageSource;
  type: 'image';
}

export type AgentContentBlock = AgentTextBlock | AgentImageBlock;

/**
 * Prompt input shape for `spawnAgent`. A plain string is sugar for a single
 * text block; the array form supports mixed text + image content. Order is
 * preserved when serialized to the agent's stdin / CLI flags.
 */
export type AgentPromptInput = string | AgentContentBlock[];
