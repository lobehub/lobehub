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
 * conversation history must stay readable, but nothing may list or post into the owner's
 * Channels.
 */
describe('share gate: the Channel tool of a shared Agent run', () => {
  const channelTool = () =>
    buildToolSet([
      {
        apis: Object.values(ChannelApiName).map((name) => ({ name })),
        identifier: ChannelIdentifier,
      },
    ]);

  it('keeps only the history reads, even with no tool granted', () => {
    const toolSet = channelTool();
    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [] }));

    expect(toolSet.enabledToolIds).toEqual([ChannelIdentifier]);
    expect(toolSet.manifestMap[ChannelIdentifier].api.map((api) => api.name).sort()).toEqual([
      ChannelApiName.readMessage,
      ChannelApiName.readMessages,
    ]);
    expect(toolSet.tools?.map((tool) => tool.function.name).sort()).toEqual(
      [
        toolName(ChannelIdentifier, ChannelApiName.readMessage),
        toolName(ChannelIdentifier, ChannelApiName.readMessages),
      ].sort(),
    );
  });

  it.each([ChannelApiName.readMessage, ChannelApiName.readMessages])('dispatches %s', (apiName) => {
    expect(isShareBlockedBuiltinDispatch({}, ChannelIdentifier, apiName)).toBe(false);
    expect(isShareBlockedDataToolCall({}, ChannelIdentifier, apiName)).toBe(false);
  });

  it.each([ChannelApiName.listChannels, ChannelApiName.sendMessage])(
    'refuses %s, which would act in the owner’s Channels',
    (apiName) => {
      expect(isShareBlockedBuiltinDispatch({}, ChannelIdentifier, apiName)).toBe(true);
      expect(isShareBlockedDataToolCall({}, ChannelIdentifier, apiName)).toBe(true);
    },
  );
});
