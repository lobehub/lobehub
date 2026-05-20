import type { TopicReferenceItem } from '../../providers/TopicReferenceContextInjector';

/**
 * Parsed refer_topic tag info
 */
export interface ParsedTopicReference {
  topicId: string;
  topicTitle?: string;
}

/**
 * Topic lookup result (common interface for both client store and server DB)
 */
export interface TopicLookupResult {
  historySummary?: string | null;
  title?: string | null;
}

/**
 * Message item returned by lookupMessages
 */
export interface TopicMessageItem {
  content?: string | null;
  role: string;
}

/** Max recent messages to fetch as fallback */
const MAX_RECENT_MESSAGES = 5;
/** Max characters per message content */
const MAX_MESSAGE_LENGTH = 300;

/**
 * Parse <refer_topic> tags from message contents
 */
export function parseReferTopicTags(
  messages: Array<{ content: string | unknown }>,
): ParsedTopicReference[] {
  const topicIds = new Set<string>();
  const topicNames = new Map<string, string>();

  for (const msg of messages) {
    // Strip markdown escape backslashes (e.g. \< → <, \_ → _) before parsing
    const raw = typeof msg.content === 'string' ? msg.content : '';
    const content = raw.replaceAll(/\\([<>_*[\]()#`~|])/g, '$1');
    const tagRegex = /<refer_topic\s([^>]*)>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(content)) !== null) {
      const attrs = tagMatch[1];
      const idMatch = /id="([^"]+)"/.exec(attrs);
      const nameMatch = /name="([^"]*)"/.exec(attrs);
      if (idMatch) {
        topicIds.add(idMatch[1]);
        if (nameMatch) topicNames.set(idMatch[1], nameMatch[1]);
      }
    }
  }

  return [...topicIds].map((topicId) => ({
    topicId,
    topicTitle: topicNames.get(topicId),
  }));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

/**
 * Resolve topic references by looking up each topic via the provided function.
 * Works with both sync (client store) and async (server DB) data sources.
 *
 * When a topic has no historySummary and lookupMessages is provided,
 * fetches the last 5 user/assistant messages as fallback context (each truncated to 300 chars).
 */
export async function resolveTopicReferences(
  messages: Array<{ content: string | unknown }>,
  lookupTopic: (topicId: string) => Promise<TopicLookupResult | null | undefined>,
  lookupMessages?: (topicId: string) => Promise<TopicMessageItem[]>,
): Promise<TopicReferenceItem[] | undefined> {
  const parsed = parseReferTopicTags(messages);
  if (parsed.length === 0) return undefined;

  const refs: TopicReferenceItem[] = [];

  for (const { topicId, topicTitle } of parsed) {
    try {
      const topic = await lookupTopic(topicId);
      const title = topic?.title || topicTitle;

      if (topic?.historySummary) {
        refs.push({ summary: topic.historySummary, topicId, topicTitle: title });
        continue;
      }

      // Fallback: fetch recent messages
      if (lookupMessages) {
        try {
          const allMessages = await lookupMessages(topicId);

          // Filter to user/assistant only, take last N, truncate content.
          // Guard typeof: historical messages may carry non-string content
          // (multimodal parts array, null tool turns) — calling `.trim()` on
          // those throws `e.trim is not a function` and kills the whole engine.
          const recent = allMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .filter((m) => typeof m.content === 'string' && m.content.trim())
            .slice(-MAX_RECENT_MESSAGES)
            .map((m) => ({
              content: truncate((m.content as string).trim(), MAX_MESSAGE_LENGTH),
              role: m.role,
            }));

          if (recent.length > 0) {
            refs.push({ recentMessages: recent, topicId, topicTitle: title });
            continue;
          }
        } catch {
          // fallthrough to no-context
        }
      }

      refs.push({ topicId, topicTitle: title });
    } catch {
      refs.push({ topicId, topicTitle });
    }
  }

  return refs.length > 0 ? refs : undefined;
}
