import { type Message, parse } from '@lobechat/conversation-flow';
import { describe, expect, it } from 'vitest';

import { projectToolResultControl } from './toolResultControl';

describe('projectToolResultControl council history', () => {
  it.each(['pending', 'blocked'])(
    'keeps council members parallel and hides barrier anchors while %s',
    (status) => {
      const common = { createdAt: 1, updatedAt: 1 };
      const history: Message[] = [
        { ...common, id: 'user', role: 'user', content: 'Discuss together' },
        {
          ...common,
          id: 'supervisor',
          role: 'assistant',
          content: '',
          parentId: 'user',
          tools: [
            {
              id: 'council-call',
              type: 'function',
              function: { name: 'broadcast', arguments: '{}' },
            },
          ],
        },
        {
          ...common,
          id: 'council',
          role: 'tool',
          parentId: 'supervisor',
          tool_call_id: 'council-call',
          content: 'private result',
          metadata: {
            agentCouncil: true,
            toolResultControl: { status },
            privateResult: 'private metadata',
          },
          pluginState: { raw: 'private state' },
        },
        ...['alpha', 'beta'].map((id) => ({
          ...common,
          id,
          agentId: id,
          role: 'assistant' as const,
          content: `${id} member response`,
          parentId: 'supervisor',
        })),
        ...['alpha', 'beta'].map((id) => ({
          ...common,
          id: `${id}-anchor`,
          role: 'tool' as const,
          content: '',
          parentId: 'council',
          tool_call_id: `council-call::${id}`,
        })),
      ];
      const projected = history.map(projectToolResultControl);
      expect(projected[2].metadata).toEqual({ agentCouncil: true });
      expect(JSON.stringify(projected)).not.toContain('private');
      const { flatList } = parse(projected);
      const council = flatList
        .flatMap((message) => message.children ?? [])
        .find((block) => block.council?.length);
      expect(council?.council?.map((member) => member.id)).toEqual(['alpha', 'beta']);
      expect(JSON.stringify(flatList)).not.toContain('-anchor');
    },
  );

  it('does not expose an arbitrary value under the structural metadata key', () => {
    const projected = projectToolResultControl({
      role: 'tool',
      metadata: { agentCouncil: { content: 'private' }, toolResultControl: { status: 'pending' } },
    });
    expect(projected.metadata).toEqual({});
  });
});
