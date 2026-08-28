/** Public engagement counters retained from an X profile. */
export interface TwitterProfileMetrics {
  /** Number of accounts following this profile. */
  followersCount?: number;
  /** Number of accounts this profile follows. */
  followingCount?: number;
  /** Number of public lists containing this profile. */
  listedCount?: number;
  /** Number of posts reported by X for this profile. */
  postCount?: number;
}

/** Public engagement counters retained from an X post. */
export interface TwitterPostMetrics {
  /** Number of bookmarks reported for this post, when visible. */
  bookmarkCount?: number;
  /** Number of impressions reported for this post, when visible. */
  impressionCount?: number;
  /** Number of likes reported for this post. */
  likeCount?: number;
  /** Number of quote posts reported for this post. */
  quoteCount?: number;
  /** Number of replies reported for this post. */
  replyCount?: number;
  /** Number of reposts reported for this post. */
  repostCount?: number;
}

/** Bounded public profile metadata for the authenticated X account. */
export interface TwitterProfile {
  /** ISO account creation timestamp, when returned by X. */
  createdAt?: string;
  /** Public profile biography. */
  description?: string;
  /** Stable X user identifier. */
  id: string;
  /** Public free-form profile location. */
  location?: string;
  /** Public engagement counters. */
  metrics: TwitterProfileMetrics;
  /** Display name shown by X. */
  name: string;
  /** Expanded pinned post, when the account has one and X returns it. */
  pinnedPost?: TwitterPost;
  /** Canonical public profile URL. */
  sourceUrl: string;
  /** X handle without the leading at-sign. */
  username: string;
  /** Whether X reports the account as verified. */
  verified?: boolean;
}

/** Bounded public post metadata returned by recent X search. */
export interface TwitterPost {
  /** Stable X identifier for the author, when returned. */
  authorId?: string;
  /** X handle for the author, when expanded. */
  authorUsername?: string;
  /** Conversation identifier used to group replies. */
  conversationId?: string;
  /** ISO creation timestamp, when returned by X. */
  createdAt?: string;
  /** Stable post identifier. */
  id: string;
  /** X user identifier being replied to, when applicable. */
  inReplyToUserId?: string;
  /** Public engagement counters. */
  metrics: TwitterPostMetrics;
  /** Relationship types such as replied_to, quoted, or retweeted. */
  referencedPostTypes: string[];
  /** Canonical public post URL. */
  sourceUrl: string;
  /** Bounded post text, including long-form note text when returned. */
  text: string;
}

/** Input for one bounded X recent-search request. */
export interface TwitterSearchRecentPostsInput {
  /** Maximum normalized posts returned to the caller. */
  maxResults?: number;
  /** X recent-search query, limited to the platform's seven-day window. */
  query: string;
}

/** Read-only X client used by onboarding source collectors. */
export interface TwitterConnectorClient {
  /** Loads public metadata for the authenticated X account. */
  getProfile: () => Promise<TwitterProfile>;
  /** Searches public posts from the most recent seven days. */
  searchRecentPosts: (input: TwitterSearchRecentPostsInput) => Promise<TwitterPost[]>;
}
