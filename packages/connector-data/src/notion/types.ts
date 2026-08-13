/** Minimal Notion page or database metadata retained as connector evidence. */
export interface NotionItem {
  /** Stable Notion object identifier. */
  id: string;
  /** Whether this object is a content page or database. */
  kind: 'database' | 'page';
  /** ISO timestamp of the latest known edit, when supplied by Notion. */
  lastEditedAt?: string;
  /** Bounded database/page property names that describe its structure. */
  propertyNames: string[];
  /** Stable Notion URL used to ground generated recommendations. */
  sourceUrl: string;
  /** Human-readable title derived from Notion rich text properties. */
  title: string;
}

/** One Notion item enriched with bounded page Markdown when available. */
export interface NotionItemContent {
  /** Directory metadata returned by workspace search. */
  item: NotionItem;
  /** Bounded Notion-flavored Markdown for content analysis. */
  markdown?: string;
}

/** Input for listing accessible Notion pages and databases. */
export interface NotionListItemsInput {
  /** Maximum normalized objects returned to the caller. */
  maxResults?: number;
  /** Optional title query accepted by Composio's Notion fetch tool. */
  query?: string;
}

/** Read-only Notion client used by onboarding source collectors. */
export interface NotionConnectorClient {
  /** Fetches bounded page Markdown for one accessible page. */
  getPageMarkdown: (pageId: string) => Promise<string | undefined>;
  /** Lists bounded metadata for accessible workspace pages and databases. */
  listItems: (input?: NotionListItemsInput) => Promise<NotionItem[]>;
}
