import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store/channel', () => ({ channelActions: {} }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: vi.fn(),
}));

const { skillPrompt } = await import('./SkillPromptSend');

describe('skillPrompt', () => {
  it('puts the skill as a composer chip before the ask', () => {
    expect(skillPrompt('pptx', 'pptx', '帮我使用这个技能。')).toBe(
      '<skill name="pptx" label="pptx" /> 帮我使用这个技能。',
    );
  });

  it('keeps a quote in the name from closing the label attribute', () => {
    expect(skillPrompt('x', 'say "hi"', 'go')).toBe('<skill name="x" label="say \'hi\'" /> go');
  });
});
