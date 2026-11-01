import { toRecord } from '@lobechat/utils/object';

import type {
  TwitterPost,
  TwitterPostMetrics,
  TwitterProfile,
  TwitterProfileMetrics,
} from './types';

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_ID_LENGTH = 64;
const MAX_LOCATION_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_POST_TEXT_LENGTH = 4000;
const MAX_USERNAME_LENGTH = 15;
const SAFE_USERNAME = /^\w+$/;
const executionWrappers = ['data', 'result', 'response'] as const;

const boundedString = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== 'string') return;
  const normalized = value.trim().slice(0, limit);
  return normalized || undefined;
};

const boundedNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const readUsername = (value: unknown): string | undefined => {
  const username = boundedString(value, MAX_USERNAME_LENGTH);
  return username && SAFE_USERNAME.test(username) ? username : undefined;
};

const readTimestamp = (value: unknown): string | undefined => {
  const timestamp = boundedString(value, 64);
  if (!timestamp) return;
  const milliseconds = new Date(timestamp).getTime();
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
};

const readProfileMetrics = (value: unknown): TwitterProfileMetrics => {
  const metrics = toRecord(value);
  if (!metrics) return {};
  return {
    followersCount: boundedNumber(metrics.followers_count),
    followingCount: boundedNumber(metrics.following_count),
    listedCount: boundedNumber(metrics.listed_count),
    postCount: boundedNumber(metrics.tweet_count ?? metrics.post_count),
  };
};

const readPostMetrics = (value: unknown): TwitterPostMetrics => {
  const metrics = toRecord(value);
  if (!metrics) return {};
  return {
    bookmarkCount: boundedNumber(metrics.bookmark_count),
    impressionCount: boundedNumber(metrics.impression_count),
    likeCount: boundedNumber(metrics.like_count),
    quoteCount: boundedNumber(metrics.quote_count),
    replyCount: boundedNumber(metrics.reply_count),
    repostCount: boundedNumber(metrics.retweet_count ?? metrics.repost_count),
  };
};

const walkExecutionRecords = (value: unknown): Record<string, unknown>[] => {
  const queue: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  const records: Record<string, unknown>[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const record = toRecord(current.value);
    if (!record) continue;
    records.push(record);
    if (current.depth >= 3) continue;
    for (const key of executionWrappers) {
      if (record[key] !== undefined) queue.push({ depth: current.depth + 1, value: record[key] });
    }
  }
  return records;
};

const readIncludedUsers = (records: Record<string, unknown>[]): Map<string, string> => {
  const users = new Map<string, string>();
  for (const record of records) {
    const includes = toRecord(record.includes);
    if (!Array.isArray(includes?.users)) continue;
    for (const candidate of includes.users.slice(0, 200)) {
      const user = toRecord(candidate);
      const id = boundedString(user?.id, MAX_ID_LENGTH);
      const username = readUsername(user?.username);
      if (id && username) users.set(id, username);
    }
  }
  return users;
};

const normalizePost = (
  value: unknown,
  usernamesById: ReadonlyMap<string, string>,
): TwitterPost | undefined => {
  const post = toRecord(value);
  const id = boundedString(post?.id, MAX_ID_LENGTH);
  const noteTweet = toRecord(post?.note_tweet);
  const text = boundedString(noteTweet?.text ?? post?.text, MAX_POST_TEXT_LENGTH);
  if (!post || !id || !text) return;
  const authorId = boundedString(post.author_id, MAX_ID_LENGTH);
  const authorUsername = authorId ? usernamesById.get(authorId) : undefined;
  const conversationId = boundedString(post.conversation_id, MAX_ID_LENGTH);
  const createdAt = readTimestamp(post.created_at);
  const inReplyToUserId = boundedString(post.in_reply_to_user_id, MAX_ID_LENGTH);
  const references = Array.isArray(post.referenced_tweets)
    ? post.referenced_tweets.slice(0, 16).flatMap((reference) => {
        const type = boundedString(toRecord(reference)?.type, 32);
        return type ? [type] : [];
      })
    : [];
  return {
    ...(authorId ? { authorId } : {}),
    ...(authorUsername ? { authorUsername } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(createdAt ? { createdAt } : {}),
    id,
    ...(inReplyToUserId ? { inReplyToUserId } : {}),
    metrics: readPostMetrics(post.public_metrics),
    referencedPostTypes: [...new Set(references)],
    sourceUrl: authorUsername
      ? `https://x.com/${authorUsername}/status/${id}`
      : `https://x.com/i/web/status/${id}`,
    text,
  };
};

/**
 * Normalizes Market X recent-search output into bounded public posts.
 *
 * Before:
 * - `{ data: { data: [{ id: "1", text: "Hello", author_id: "2" }], includes: { users: [...] } } }`
 *
 * After:
 * - `[{ id: "1", text: "Hello", authorUsername: "ada", sourceUrl: "https://x.com/ada/status/1" }]`
 */
export const parseTwitterPosts = (
  value: unknown,
  maxCandidates: number,
): TwitterPost[] | undefined => {
  const records = walkExecutionRecords(value);
  const usernamesById = readIncludedUsers(records);
  const collection = records
    .map((record) => {
      if (Array.isArray(record.data)) return record.data;
      if (Array.isArray(record.posts)) return record.posts;
      if (Array.isArray(record.tweets)) return record.tweets;
    })
    .find((candidate): candidate is unknown[] => candidate !== undefined);
  if (!collection) {
    const isExplicitlyEmpty = records.some((record) => {
      const meta = toRecord(record.meta);
      return boundedNumber(meta?.result_count) === 0;
    });
    return isExplicitlyEmpty ? [] : undefined;
  }
  const finiteLimit = Number.isFinite(maxCandidates) ? Math.floor(maxCandidates) : 0;
  const limit = Math.min(Math.max(0, finiteLimit), 100);
  const posts = new Map<string, TwitterPost>();
  for (const candidate of collection.slice(0, limit)) {
    const post = normalizePost(candidate, usernamesById);
    if (post && !posts.has(post.id)) posts.set(post.id, post);
  }
  if (collection.length > 0 && limit > 0 && posts.size === 0) return;
  return [...posts.values()];
};

/**
 * Normalizes Market X authenticated-user output into a bounded profile.
 *
 * Before:
 * - `{ data: { data: { id: "2", username: "ada", name: "Ada" } } }`
 *
 * After:
 * - `{ id: "2", username: "ada", name: "Ada", sourceUrl: "https://x.com/ada" }`
 */
export const parseTwitterProfile = (value: unknown): TwitterProfile | undefined => {
  const records = walkExecutionRecords(value);
  const profile = records.find((record) => {
    const id = boundedString(record.id, MAX_ID_LENGTH);
    const username = readUsername(record.username);
    return Boolean(id && username);
  });
  if (!profile) return;
  const id = boundedString(profile.id, MAX_ID_LENGTH)!;
  const username = readUsername(profile.username)!;
  const name = boundedString(profile.name, MAX_NAME_LENGTH) ?? username;
  const createdAt = readTimestamp(profile.created_at);
  const description = boundedString(profile.description, MAX_DESCRIPTION_LENGTH);
  const location = boundedString(profile.location, MAX_LOCATION_LENGTH);
  const pinnedTweetId = boundedString(profile.pinned_tweet_id, MAX_ID_LENGTH);
  const usernamesById = readIncludedUsers(records);
  const includedTweets = records.flatMap((record) => {
    const includes = toRecord(record.includes);
    return Array.isArray(includes?.tweets) ? includes.tweets.slice(0, 16) : [];
  });
  const pinnedPost = includedTweets
    .map((post) => normalizePost(post, usernamesById))
    .find((post) => post?.id === pinnedTweetId);
  return {
    ...(createdAt ? { createdAt } : {}),
    ...(description ? { description } : {}),
    id,
    ...(location ? { location } : {}),
    metrics: readProfileMetrics(profile.public_metrics),
    name,
    ...(pinnedPost ? { pinnedPost } : {}),
    sourceUrl: `https://x.com/${username}`,
    username,
    ...(typeof profile.verified === 'boolean' ? { verified: profile.verified } : {}),
  };
};
