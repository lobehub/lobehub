import { describe, expect, it } from 'vitest';

import {
  parseCommandsFromEditorData,
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
} from './parseCommands';

describe('parseCommandsFromEditorData', () => {
  it('should return empty array for undefined editorData', () => {
    expect(parseCommandsFromEditorData(undefined)).toEqual([]);
  });

  it('should return empty array for editorData with no action tags', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [{ text: 'hello', type: 'text' }],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };
    expect(parseCommandsFromEditorData(editorData)).toEqual([]);
  });

  it('should extract command tags from editorData', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                actionCategory: 'command',
                actionLabel: 'Send in new topic',
                actionType: 'newTopic',
                type: 'action-tag',
              },
              { text: ' some message', type: 'text' },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    const result = parseCommandsFromEditorData(editorData);
    expect(result).toEqual([{ category: 'command', label: 'Send in new topic', type: 'newTopic' }]);
  });

  it('should extract multiple tags in document order', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    const result = parseCommandsFromEditorData(editorData);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('newTopic');
    expect(result[1].type).toBe('translate');
    expect(result[2].type).toBe('lobe-notebook');
  });
});

describe('parseSelectedSkillsFromEditorData', () => {
  it('should return selected skills only', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseSelectedSkillsFromEditorData(editorData)).toEqual([
      { identifier: 'user_memory', name: 'User Memory' },
      { identifier: 'instruction', name: 'Instruction' },
    ]);
  });

  it('should deduplicate selected skills by identifier', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseSelectedSkillsFromEditorData(editorData)).toEqual([
      { identifier: 'user_memory', name: 'User Memory' },
    ]);
  });

  it('should ignore tool tags when selecting skills', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseSelectedSkillsFromEditorData(editorData)).toEqual([
      { identifier: 'user_memory', name: 'User Memory' },
    ]);
  });
});

describe('parseSelectedToolsFromEditorData', () => {
  it('should return selected tools only', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseSelectedToolsFromEditorData(editorData)).toEqual([
      { identifier: 'lobe-notebook', name: 'Notebook' },
      { identifier: 'lobe-artifacts', name: 'Artifacts' },
    ]);
  });

  it('should deduplicate selected tools by identifier', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

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
    const editorData = {
      root: {
        children: [
          {
            children: [{ text: 'hello', type: 'text' }],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };
    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([]);
  });

  it('should extract agent mentions only (whitelist)', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                label: 'My Agent',
                metadata: { id: 'agent-1', type: 'agent' },
                type: 'mention',
              },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-1', name: 'My Agent' },
    ]);
  });

  it('should exclude topic mentions', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                label: 'Some Topic',
                metadata: { id: 'topic-1', topicId: 'topic-1', type: 'topic' },
                type: 'mention',
              },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([]);
  });

  it('should exclude ALL_MEMBERS and other non-agent mentions', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([]);
  });

  it('should deduplicate agents by id', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-1', name: 'Agent A' },
    ]);
  });

  it('should extract multiple distinct agent mentions', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    const result = parseMentionedAgentsFromEditorData(editorData);
    expect(result).toEqual([
      { id: 'agent-1', name: 'Agent A' },
      { id: 'agent-2', name: 'Agent B' },
    ]);
  });

  it('should only extract agents when mixed with topic mentions', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-y', name: 'Agent Y' },
    ]);
  });

  it('should handle nested children correctly', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
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
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'nested-1', name: 'Nested Agent' },
    ]);
  });

  it('should use id as fallback name when label is empty', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              {
                label: '',
                metadata: { id: 'agent-no-label', type: 'agent' },
                type: 'mention',
              },
            ],
            type: 'paragraph',
          },
        ],
        type: 'root',
      },
    };

    expect(parseMentionedAgentsFromEditorData(editorData)).toEqual([
      { id: 'agent-no-label', name: 'agent-no-label' },
    ]);
  });
});
