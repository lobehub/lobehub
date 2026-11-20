import { describe, expect, it } from 'vitest';

import {
  parseCommandsFromEditorData,
  parseLocalFileReferencesFromEditorData,
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
  parseSingleAgentMentionDirectRoute,
} from './parseCommands';

const createEditorData = (children: unknown[]) => ({
  root: { children: [{ children, type: 'paragraph' }], type: 'root' },
});

describe('parseCommandsFromEditorData', () => {
  it('should return empty array for undefined editorData', () => {
    expect(parseCommandsFromEditorData(undefined)).toEqual([]);
  });

  it('should return empty array for editorData with no action tags', () => {
    const editorData = createEditorData([{ text: 'hello', type: 'text' }]);
    expect(parseCommandsFromEditorData(editorData)).toEqual([]);
  });

  it('should extract command tags from editorData', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'command',
        actionLabel: 'Send in new topic',
        actionType: 'newTopic',
        type: 'action-tag',
      },
      { text: ' some message', type: 'text' },
    ]);

    const result = parseCommandsFromEditorData(editorData);
    expect(result).toEqual([{ category: 'command', label: 'Send in new topic', type: 'newTopic' }]);
  });

  it('should extract multiple tags in document order', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'command',
        actionLabel: 'Send in new topic',
        actionType: 'newTopic',
        type: 'action-tag',
      },
      {
        actionCategory: 'skill',
        actionLabel: 'Translate',
        actionType: 'translate',
        type: 'action-tag',
      },
      {
        actionCategory: 'tool',
        actionLabel: 'Notebook',
        actionType: 'lobe-notebook',
        type: 'action-tag',
      },
    ]);

    const result = parseCommandsFromEditorData(editorData);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('newTopic');
    expect(result[1].type).toBe('translate');
    expect(result[2].type).toBe('lobe-notebook');
  });
});

describe('parseSelectedSkillsFromEditorData', () => {
  it('should return selected skills only', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'command',
        actionLabel: 'Compact context',
        actionType: 'compact',
        type: 'action-tag',
      },
      {
        actionCategory: 'skill',
        actionLabel: 'User Memory',
        actionType: 'user_memory',
        type: 'action-tag',
      },
      {
        actionCategory: 'skill',
        actionLabel: 'Instruction',
        actionType: 'instruction',
        type: 'action-tag',
      },
    ]);

    expect(parseSelectedSkillsFromEditorData(editorData)).toEqual([
      { identifier: 'user_memory', name: 'User Memory' },
      { identifier: 'instruction', name: 'Instruction' },
    ]);
  });

  it('should deduplicate selected skills by identifier', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'skill',
        actionLabel: 'User Memory',
        actionType: 'user_memory',
        type: 'action-tag',
      },
      {
        actionCategory: 'skill',
        actionLabel: 'User Memory Duplicate',
        actionType: 'user_memory',
        type: 'action-tag',
      },
    ]);

    expect(parseSelectedSkillsFromEditorData(editorData)).toEqual([
      { identifier: 'user_memory', name: 'User Memory' },
    ]);
  });

  it('should ignore tool tags when selecting skills', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'tool',
        actionLabel: 'Notebook',
        actionType: 'lobe-notebook',
        type: 'action-tag',
      },
      {
        actionCategory: 'skill',
        actionLabel: 'User Memory',
        actionType: 'user_memory',
        type: 'action-tag',
      },
    ]);

    expect(parseSelectedSkillsFromEditorData(editorData)).toEqual([
      { identifier: 'user_memory', name: 'User Memory' },
    ]);
  });
});

describe('parseSelectedToolsFromEditorData', () => {
  it('should return selected tools only', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'command',
        actionLabel: 'Compact context',
        actionType: 'compact',
        type: 'action-tag',
      },
      {
        actionCategory: 'tool',
        actionLabel: 'Notebook',
        actionType: 'lobe-notebook',
        type: 'action-tag',
      },
      {
        actionCategory: 'tool',
        actionLabel: 'Artifacts',
        actionType: 'lobe-artifacts',
        type: 'action-tag',
      },
    ]);

    expect(parseSelectedToolsFromEditorData(editorData)).toEqual([
      { identifier: 'lobe-notebook', name: 'Notebook' },
      { identifier: 'lobe-artifacts', name: 'Artifacts' },
    ]);
  });

  it('should deduplicate selected tools by identifier', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'tool',
        actionLabel: 'Notebook',
        actionType: 'lobe-notebook',
        type: 'action-tag',
      },
      {
        actionCategory: 'tool',
        actionLabel: 'Notebook Duplicate',
        actionType: 'lobe-notebook',
        type: 'action-tag',
      },
    ]);

    expect(parseSelectedToolsFromEditorData(editorData)).toEqual([
      { identifier: 'lobe-notebook', name: 'Notebook' },
    ]);
  });
});

describe('parseMentionedAgentsFromEditorData', () => {
  it('should return empty array for undefined editorData', () => {
    expect(parseMentionedAgentsFromEditorData(undefined)).toEqual([]);
  });

  it('should return empty array for editorData with no mention nodes', () => {
    const editorData = createEditorData([{ text: 'hello', type: 'text' }]);
    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([]);
  });

  it('should extract agent mentions only (whitelist)', () => {
    const editorData = createEditorData([
      {
        label: 'My Agent',
        metadata: { id: 'agent-1', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-1', name: 'My Agent' },
    ]);
  });

  it('should exclude topic mentions', () => {
    const editorData = createEditorData([
      {
        label: 'Some Topic',
        metadata: { id: 'topic-1', topicId: 'topic-1', type: 'topic' },
        type: 'mention',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([]);
  });

  it('should exclude ALL_MEMBERS and other non-agent mentions', () => {
    const editorData = createEditorData([
      {
        label: 'All Members',
        metadata: { id: 'ALL_MEMBERS', type: 'all_members' },
        type: 'mention',
      },
      {
        label: 'Unknown',
        metadata: { id: 'x', type: 'custom' },
        type: 'mention',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([]);
  });

  it('should deduplicate agents by id', () => {
    const editorData = createEditorData([
      {
        label: 'Agent A',
        metadata: { id: 'agent-1', type: 'agent' },
        type: 'mention',
      },
      {
        label: 'Agent A again',
        metadata: { id: 'agent-1', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-1', name: 'Agent A' },
    ]);
  });

  it('should extract multiple distinct agent mentions', () => {
    const editorData = createEditorData([
      {
        label: 'Agent A',
        metadata: { id: 'agent-1', type: 'agent' },
        type: 'mention',
      },
      {
        label: 'Agent B',
        metadata: { id: 'agent-2', type: 'agent' },
        type: 'mention',
      },
    ]);

    const result = parseMentionedAgentsFromEditorData(editorData);
    expect(result).toEqual([
      { id: 'agent-1', name: 'Agent A' },
      { id: 'agent-2', name: 'Agent B' },
    ]);
  });

  it('should only extract agents when mixed with topic mentions', () => {
    const editorData = createEditorData([
      {
        label: 'Topic X',
        metadata: { id: 'topic-1', topicId: 'topic-1', type: 'topic' },
        type: 'mention',
      },
      {
        label: 'Agent Y',
        metadata: { id: 'agent-y', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-y', name: 'Agent Y' },
    ]);
  });

  it('should handle nested children correctly', () => {
    const editorData = createEditorData([
      {
        children: [
          {
            label: 'Nested Agent',
            metadata: { id: 'nested-1', type: 'agent' },
            type: 'mention',
          },
        ],
        type: 'paragraph',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'nested-1', name: 'Nested Agent' },
    ]);
  });

  it('should use id as fallback name when label is empty', () => {
    const editorData = createEditorData([
      {
        label: '',
        metadata: { id: 'agent-no-label', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-no-label', name: 'agent-no-label' },
    ]);
  });
});

describe('parseSingleAgentMentionDirectRoute', () => {
  it('should return undefined for undefined editorData', () => {
    expect(parseSingleAgentMentionDirectRoute(undefined)).toBeUndefined();
  });

  it('should detect a single leading agent mention', () => {
    const editorData = createEditorData([
      {
        label: 'Agent B',
        metadata: { id: 'agent-b', type: 'agent' },
        type: 'mention',
      },
      { text: ' please review this', type: 'text' },
    ]);

    expect(parseSingleAgentMentionDirectRoute(editorData)).toEqual({
      agent: { id: 'agent-b', name: 'Agent B' },
    });
  });

  it('should allow whitespace before the leading agent mention', () => {
    const editorData = createEditorData([
      { text: ' \n\t ', type: 'text' },
      {
        label: 'Agent B',
        metadata: { id: 'agent-b', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseSingleAgentMentionDirectRoute(editorData)).toEqual({
      agent: { id: 'agent-b', name: 'Agent B' },
    });
  });

  it('should reject an agent mention when text appears first', () => {
    const editorData = createEditorData([
      { text: 'please ask ', type: 'text' },
      {
        label: 'Agent B',
        metadata: { id: 'agent-b', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseSingleAgentMentionDirectRoute(editorData)).toBeUndefined();
  });

  it('should reject multiple mention nodes even when only one is an agent', () => {
    const editorData = createEditorData([
      {
        label: 'Agent B',
        metadata: { id: 'agent-b', type: 'agent' },
        type: 'mention',
      },
      {
        label: 'Topic X',
        metadata: { id: 'topic-x', type: 'topic' },
        type: 'mention',
      },
    ]);

    expect(parseSingleAgentMentionDirectRoute(editorData)).toBeUndefined();
  });

  it('should reject a single non-agent mention', () => {
    const editorData = createEditorData([
      {
        label: 'Topic X',
        metadata: { id: 'topic-x', type: 'topic' },
        type: 'mention',
      },
    ]);

    expect(parseSingleAgentMentionDirectRoute(editorData)).toBeUndefined();
  });

  it('should reject when an action tag appears before the mention', () => {
    const editorData = createEditorData([
      {
        actionCategory: 'skill',
        actionLabel: 'User Memory',
        actionType: 'user_memory',
        type: 'action-tag',
      },
      {
        label: 'Agent B',
        metadata: { id: 'agent-b', type: 'agent' },
        type: 'mention',
      },
    ]);

    expect(parseSingleAgentMentionDirectRoute(editorData)).toBeUndefined();
  });
});

describe('parseLocalFileReferencesFromEditorData', () => {
  it('should extract local file mention metadata in document order', () => {
    const editorData = createEditorData([
      {
        label: 'README.md',
        metadata: {
          name: 'README.md',
          path: '/Users/me/project/README.md',
          type: 'localFile',
        },
        type: 'mention',
      },
      {
        label: 'src',
        metadata: {
          isDirectory: true,
          name: 'src',
          path: '/Users/me/project/src',
          type: 'localFile',
        },
        type: 'mention',
      },
    ]);

    expect(parseLocalFileReferencesFromEditorData(editorData)).toEqual([
      { isDirectory: false, name: 'README.md', path: '/Users/me/project/README.md' },
      { isDirectory: true, name: 'src', path: '/Users/me/project/src' },
    ]);
  });
});
