import { uuid } from '@lobechat/utils';
import { template } from 'es-toolkit/compat';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { globalAgentContextManager } from '../GlobalAgentContextManager';

const placeholderVariablesRegex = /\{\{(.*?)\}\}/g;

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const VARIABLE_GENERATORS = {
  /**
   * Time-related template variables
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{date}}` | 12/25/2023 |
   * | `{{datetime}}` | 12/25/2023, 2:30:45 PM |
   * | `{{day}}` | 25 |
   * | `{{hour}}` | 14 |
   * | `{{iso}}` | 2023-12-25T14:30:45.123Z |
   * | `{{locale}}` | zh-CN |
   * | `{{minute}}` | 30 |
   * | `{{month}}` | 12 |
   * | `{{second}}` | 45 |
   * | `{{time}}` | 2:30:45 PM |
   * | `{{timestamp}}` | 1703538645123 |
   * | `{{timezone}}` | America/New_York |
   * | `{{weekday}}` | Monday |
   * | `{{year}}` | 2023 |
   *
   */
  date: () => new Date().toLocaleDateString(),
  datetime: () => new Date().toLocaleString(),
  day: () => new Date().getDate().toString().padStart(2, '0'),
  hour: () => new Date().getHours().toString().padStart(2, '0'),
  iso: () => new Date().toISOString(),
  locale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  minute: () => new Date().getMinutes().toString().padStart(2, '0'),
  month: () => (new Date().getMonth() + 1).toString().padStart(2, '0'),
  second: () => new Date().getSeconds().toString().padStart(2, '0'),
  time: () => new Date().toLocaleTimeString(),
  timestamp: () => Date.now().toString(),
  timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekday: () => new Date().toLocaleDateString('en-US', { weekday: 'long' }),
  year: () => new Date().getFullYear().toString(),

  /**
   * User information template variables
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{email}}` | demo@lobehub.com |
   * | `{{nickname}}` | Community User |
   * | `{{username}}` | LobeChat |
   *
   */
  email: () => userProfileSelectors.email(useUserStore.getState()) ?? '',
  nickname: () => userProfileSelectors.nickName(useUserStore.getState()) ?? '',
  username: () =>
    userProfileSelectors.displayUserName(useUserStore.getState()) ??
    userProfileSelectors.fullName(useUserStore.getState()) ??
    '',

  /**
   * Random value template variables
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{random}}` | 100041 |
   * | `{{random_bool}}` | true |
   * | `{{random_float}}` | 76.02 |
   * | `{{random_hex}}` | de0dbd |
   * | `{{random_int}}` | 68 |
   * | `{{random_string}}` | wqn9zfrqe7h |
   *
   */
  random: () => Math.floor(Math.random() * 1_000_000 + 1).toString(),
  random_bool: () => (Math.random() > 0.5 ? 'true' : 'false'),
  random_float: () => (Math.random() * 100).toFixed(2),
  random_hex: () =>
    Math.floor(Math.random() * 16_777_215)
      .toString(16)
      .padStart(6, '0'),
  random_int: () => Math.floor(Math.random() * 100 + 1).toString(),
  random_string: () => Math.random().toString(36).slice(2, 15),
  random_digit: () => Math.floor(Math.random() * 10).toString(),

  /**
   * UUID-type template variables
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{uuid}}` | dd90b35-669f-4e87-beb8-ac6877f6995d |
   * | `{{uuid_short}}` | dd90b35 |
   *
   */
  uuid: () => uuid(),
  uuid_short: () => uuid().split('-')[0],

  /**
   * Platform-related template variables
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{language}}` | zh-CN |
   * | `{{platform}}` | MacIntel |
   * | `{{user_agent}}` | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0 |
   *
   */
  language: () => (typeof navigator !== 'undefined' ? navigator.language : ''),
  platform: () => (typeof navigator !== 'undefined' ? navigator.platform : ''),
  user_agent: () => (typeof navigator !== 'undefined' ? navigator.userAgent : ''),

  /**
   * Model-related template variables
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{model}}` | gpt-4o |
   * | `{{provider}}` | openai |
   *
   */
  model: () => agentSelectors.currentAgentModel(useAgentStore.getState()),
  provider: () => agentSelectors.currentAgentModelProvider(useAgentStore.getState()),

  /**
   * Desktop app path-related template variables (only available in Electron)
   *
   * | Value | Example |
   * |-------|---------|
   * | `{{homePath}}` | /Users/username |
   * | `{{desktopPath}}` | /Users/username/Desktop |
   * | `{{documentsPath}}` | /Users/username/Documents |
   * | `{{downloadsPath}}` | /Users/username/Downloads |
   * | `{{musicPath}}` | /Users/username/Music |
   * | `{{picturesPath}}` | /Users/username/Pictures |
   * | `{{videosPath}}` | /Users/username/Videos |
   * | `{{userDataPath}}` | /Users/username/Library/Application Support/LobeChat |
   * | `{{workingDirectory}}` | /Users/username/Projects/my-project |
   *
   */
  homePath: () => globalAgentContextManager.getContext().homePath ?? '',
  desktopPath: () => globalAgentContextManager.getContext().desktopPath ?? '',
  documentsPath: () => globalAgentContextManager.getContext().documentsPath ?? '',
  downloadsPath: () => globalAgentContextManager.getContext().downloadsPath ?? '',
  musicPath: () => globalAgentContextManager.getContext().musicPath ?? '',
  picturesPath: () => globalAgentContextManager.getContext().picturesPath ?? '',
  videosPath: () => globalAgentContextManager.getContext().videosPath ?? '',
  userDataPath: () => globalAgentContextManager.getContext().userDataPath ?? '',
  /**
   * Working directory: Topic-level setting takes priority over Agent-level setting
   */
  workingDirectory: () => {
    // First check topic-level working directory
    const topicWorkingDir = topicSelectors.currentTopicWorkingDirectory(useChatStore.getState());
    if (topicWorkingDir) return topicWorkingDir;

    // Fallback to agent-level working directory
    const agentWorkingDir = agentSelectors.currentAgentWorkingDirectory(useAgentStore.getState());
    return agentWorkingDir ?? '(not specified, use user Desktop directory as default)';
  },
} as Record<string, () => string>;

/**
 * Extract all {{variable}} placeholder variable names from text
 * @param text String containing template variables
 * @returns Array of variable names, e.g., ['date', 'nickname']
 */
const extractPlaceholderVariables = (text: string): string[] => {
  const matches = [...text.matchAll(placeholderVariablesRegex)];
  return matches.map((m) => m[1].trim());
};

/**
 * Replace template variables with actual values, supporting recursive parsing of nested variables
 * @param text - Original text containing variables
 * @param depth - Recursion depth, default 1, set higher to support {{date}} within {{text}} etc.
 * @returns Replaced text
 */
export const parsePlaceholderVariables = (text: string, depth = 2): string => {
  let result = text;

  // Recursive parsing to handle cases where {{text}} contains additional preset variables
  for (let i = 0; i < depth; i++) {
    try {
      const variables = Object.fromEntries(
        extractPlaceholderVariables(result)
          .map((key) => [key, VARIABLE_GENERATORS[key]?.()])
          .filter(([, value]) => value !== undefined),
      );

      const replaced = template(result, { interpolate: placeholderVariablesRegex })(variables);
      if (replaced === result) break;

      result = replaced;
    } catch {
      break;
    }
  }

  return result;
};

/**
 * Parse message content, replace placeholder variables
 * @param messages Original message array
 * @returns Processed message array
 */
export const parsePlaceholderVariablesMessages = (messages: any[]): any[] =>
  messages.map((message) => {
    if (!message?.content) return message;

    const { content } = message;

    // Process string type directly
    if (typeof content === 'string') {
      return { ...message, content: parsePlaceholderVariables(content) };
    }

    // Process text elements in array type
    if (Array.isArray(content)) {
      return {
        ...message,
        content: content.map((item) =>
          item?.type === 'text' ? { ...item, text: parsePlaceholderVariables(item.text) } : item,
        ),
      };
    }

    return message;
  });
