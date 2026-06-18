/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EditorCanvas from './index';

const editorProps = vi.hoisted(() => ({
  last: undefined as any,
}));

const editor = {
  getDocument: vi.fn(),
  setDocument: vi.fn(),
};

const handleContentChange = vi.fn();
const updateAgentConfig = vi.fn();

vi.mock('@lobehub/editor/react', () => ({
  Editor: Object.assign(
    vi.fn((props: any) => {
      editorProps.last = props;
      return <div data-testid="profile-editor" />;
    }),
    { withProps: (_plugin: unknown, props: unknown) => ({ props }) },
  ),
}));

vi.mock('@lobehub/editor', () => ({
  ReactMentionPlugin: vi.fn(),
  ReactTablePlugin: vi.fn(),
  ReactToolbarPlugin: vi.fn(),
}));

vi.mock('@/features/ChatInput/InputEditor/plugins', () => ({
  createChatInputRichPlugins: () => [],
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: false, reason: 'requires member' }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) =>
    selector({
      config: {
        editorData: undefined,
        systemRole: 'readonly prompt',
      },
      streamingSystemRole: undefined,
      streamingSystemRoleInProgress: false,
      updateAgentConfig,
    }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: (s: any) => s.config,
  },
}));

vi.mock('../ProfileEditor/MentionList', () => ({
  useMentionOptions: () => undefined,
}));

vi.mock('../store', () => ({
  useProfileStore: (selector: any) =>
    selector({
      editor,
      handleContentChange,
      hasEdited: false,
      lockState: { holderId: null, lockedByOther: false, pending: false },
      setHasEdited: vi.fn(),
    }),
}));

vi.mock('./TypoBar', () => ({
  default: () => <div />,
}));

vi.mock('./useSlashItems', () => ({
  useSlashItems: () => [],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('Agent profile EditorCanvas', () => {
  beforeEach(() => {
    editorProps.last = undefined;
  });

  it('passes editable=false to the editor when workspace permission blocks edits', () => {
    render(<EditorCanvas />);

    expect(editorProps.last?.editable).toBe(false);
  });
});
