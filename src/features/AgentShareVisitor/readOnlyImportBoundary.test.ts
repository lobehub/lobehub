// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (name: string) => readFileSync(path.join(import.meta.dirname, name), 'utf8');

describe('shared-agent visitor import boundary', () => {
  it('keeps the owner composer graph out of the visitor entry path', () => {
    const visitorSource = readSource('VisitorConversation.tsx');
    const readOnlySource = readSource('ReadOnlyConversationArea.tsx');

    expect(visitorSource).not.toContain('AgentConversation/ConversationArea');
    expect(readOnlySource).not.toContain('AgentConversation/ConversationArea');
    expect(readOnlySource).not.toContain('MainChatInput');
    expect(readOnlySource).not.toContain('HeterogeneousChatInput');
    expect(readOnlySource).not.toContain('ComposerDraftReceiver');
  });
});
