// Pure label utilities for X (Twitter) tool calls — consumed by both the
// LobeHub built-in X (Twitter) skill (bare apiName='get_tweet', …) and
// (potentially) the CC adapter when the same wire names are surfaced via
// MCP.
//
// Kept free of React / antd-style imports so collapsed-summary paths can
// pull these helpers without dragging the inspector component (and its
// style modules) into tests transitively.

export interface ParsedTwitterTool {
  noun: string;
  verb:
    | 'get'
    | 'list'
    | 'search'
    | 'post'
    | 'create'
    | 'delete'
    | 'update'
    | 'like'
    | 'unlike'
    | 'retweet'
    | 'unretweet'
    | 'reply'
    | 'quote'
    | 'follow'
    | 'unfollow'
    | 'mute'
    | 'unmute'
    | 'block'
    | 'unblock'
    | 'bookmark'
    | 'unbookmark'
    | 'add'
    | 'remove'
    | 'other';
}

// Multi-word suffixes that a naive split would mangle.
const NOUN_OVERRIDES: Record<string, string> = {
  home_timeline: 'home timeline',
  to_list: 'to list',
  user_timeline: 'user timeline',
};

export const parseTwitterToolName = (apiName: string): ParsedTwitterTool => {
  const underscoreIdx = apiName.indexOf('_');
  if (underscoreIdx <= 0) return { noun: apiName, verb: 'other' };

  const head = apiName.slice(0, underscoreIdx);
  const tail = apiName.slice(underscoreIdx + 1);
  const noun = NOUN_OVERRIDES[tail] ?? tail.replaceAll('_', ' ');

  switch (head) {
    case 'get':
    case 'list':
    case 'search':
    case 'post':
    case 'create':
    case 'delete':
    case 'update':
    case 'like':
    case 'unlike':
    case 'retweet':
    case 'unretweet':
    case 'reply':
    case 'quote':
    case 'follow':
    case 'unfollow':
    case 'mute':
    case 'unmute':
    case 'block':
    case 'unblock':
    case 'bookmark':
    case 'unbookmark':
    case 'add':
    case 'remove': {
      return { noun, verb: head };
    }
    default: {
      return { noun: apiName.replaceAll('_', ' '), verb: 'other' };
    }
  }
};

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Args-free verb label; the collapsed-summary view has no runtime args.
export const staticTwitterLabelFor = (parsed: ParsedTwitterTool): string => {
  const { verb, noun } = parsed;
  if (verb === 'other') return capitalize(noun);
  // `retweet` / `unretweet` already imply the noun.
  if (verb === 'retweet' || verb === 'unretweet') return capitalize(verb);
  return `${capitalize(verb)} ${noun}`;
};
