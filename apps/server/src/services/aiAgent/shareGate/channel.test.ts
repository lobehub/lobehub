import { ChannelApiName, ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import { describe, expect, it } from 'vitest';

import {
  applyShareGateToToolSet,
  isShareBlockedBuiltinDispatch,
  isShareBlockedDataToolCall,
} from '.';
import { buildGate, buildToolSet, toolName } from './testUtils';

/**
 * A Channel runs another person's shared Agent for a visitor as its owner. The visitor's own
 * conversation history stays readable, and the Agent may list and post where it is itself a
 * member (the services narrow both to those Channels); asking the owner's Agents stays blocked.
 */
const ALLOWED = [
  ChannelApiName.listChannels,
  ChannelApiName.postMessage,
  ChannelApiName.readMessage,
  ChannelApiName.readMessages,
] as const;

describe('share gate: the Channel tool of a shared Agent run', () => {
  const channelTool = () =>
    buildToolSet([
      {
        apis: Object.values(ChannelApiName).map((name) => ({ name })),
        identifier: ChannelIdentifier,
      },
    ]);

  it('keeps the history reads and reaching people, even with no tool granted', () => {
    const toolSet = channelTool();
    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [] }));

    expect(toolSet.enabledToolIds).toEqual([ChannelIdentifier]);
    expect(toolSet.manifestMap[ChannelIdentifier].api.map((api) => api.name).sort()).toEqual(
      [...ALLOWED].sort(),
    );
    expect(toolSet.tools?.map((tool) => tool.function.name).sort()).toEqual(
      ALLOWED.map((apiName) => toolName(ChannelIdentifier, apiName)).sort(),
    );
  });

  it.each(ALLOWED)('dispatches %s', (apiName) => {
    expect(isShareBlockedBuiltinDispatch({}, ChannelIdentifier, apiName)).toBe(false);
    expect(isShareBlockedDataToolCall({}, ChannelIdentifier, apiName)).toBe(false);
  });

  it.each(
    Object.values(ChannelApiName).filter((name) => !(ALLOWED as readonly string[]).includes(name)),
  )('refuses %s, which would act in the owner’s Channels', (apiName) => {
    expect(isShareBlockedBuiltinDispatch({}, ChannelIdentifier, apiName)).toBe(true);
    expect(isShareBlockedDataToolCall({}, ChannelIdentifier, apiName)).toBe(true);
  });
});
