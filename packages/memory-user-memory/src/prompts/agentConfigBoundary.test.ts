import { describe, expect, it } from 'vitest';

import { gatekeeperPrompt } from './gatekeeper';
import { preferencePrompt } from './layers/preference';

/**
 * @example
 * "你是我的文案助理，以后你负责帮我整理文案，你的工作空间是我 win 电脑上的文档目录" configures
 * the agent the user is talking to. User memory is shared by every agent of the user, so the
 * extraction pipeline must not turn it into a preference memory.
 */
describe('agent self-configuration boundary in memory extraction prompts', () => {
  /**
   * @example
   * The gatekeeper filters the role, duties, name and workspace for every layer, including
   * Chinese phrasing with the "以后" long-term marker, but keeps facts about the user.
   */
  it('gatekeeper rejects agent self-configuration across layers', () => {
    expect(gatekeeperPrompt).toContain('Agent self-configuration filter (applies to EVERY layer)');
    expect(gatekeeperPrompt).toContain('你是我的文案助理');
    expect(gatekeeperPrompt).toContain('以后你负责帮我整理文案');
    expect(gatekeeperPrompt).toContain('你的工作空间是我 win 电脑上的文档目录');
    expect(gatekeeperPrompt).toContain('Facts about the user that appear in the same message');
  });

  /**
   * @example
   * The preference extractor lists agent self-configuration under "Not preferences".
   */
  it('preference extractor does not treat agent self-configuration as a preference', () => {
    const notPreferences = preferencePrompt.slice(
      preferencePrompt.indexOf('Not preferences (do not extract):'),
      preferencePrompt.indexOf('## Memory Type Classifications'),
    );

    expect(notPreferences).toContain('Configuration of the assistant itself');
    expect(notPreferences).toContain('你是我的文案助理');
    expect(notPreferences).toContain('working directory / workspace / device');
  });
});
