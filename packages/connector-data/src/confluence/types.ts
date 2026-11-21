/** Bounded Confluence page metadata and text. */
export interface ConfluencePage {
  /** Stable Confluence page identifier. */
  id: string;
  /**
   * Whether the page lives in someone's personal space (space keys starting with
   * `~`); `true` when the space can't be read from the page link.
   */
  isPersonalSpace: boolean;
  /** Space key read from the page link, such as `SD`. */
  spaceKey?: string;
  /** Plain text of the page body, bounded. */
  text?: string;
  /** Page title. */
  title: string;
  /** ISO timestamp of the current version. */
  updatedAt?: string;
  /** Browser URL of the page. */
  url: string;
}

/** Read-only Confluence client used by Connector Data consumers. */
export interface ConfluenceConnectorClient {
  /** Lists the most recently modified current pages with bounded body text. */
  listRecentPages: (input?: { maxResults?: number }) => Promise<ConfluencePage[]>;
}
