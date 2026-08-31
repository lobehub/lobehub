/**
 * @vitest-environment happy-dom
 */
import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { copyOperationIdAction } from './copyOperationId';

interface MockOperation {
  id: string;
  isRuntimeRoot?: boolean;
  metadata: { serverOperationId?: string };
  parentOperationId?: string;
}

const mocks = vi.hoisted(() => ({
  isDevMode: true,
  copyToClipboard: vi.fn(),
  messageOperationMap: {} as Record<string, string>,
  messageSuccess: vi.fn(),
  operations: {} as Record<string, MockOperation>,
}));

vi.mock('@lobehub/ui', () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { success: mocks.messageSuccess },
}));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: { useApp: () => ({ message: { success: mocks.messageSuccess } }) },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      messageOperationMap: mocks.messageOperationMap,
      operations: mocks.operations,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    config: () => ({ isDevMode: mocks.isDevMode }),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    // Test double for the parent-chain walk: climbs `parentOperationId` until
    // an op flagged `isRuntimeRoot` (stand-in for AI_RUNTIME_OPERATION_TYPES).
    findRootRuntimeOperation:
      (operationId: string) => (s: { operations: Record<string, MockOperation> }) => {
        let op: MockOperation | undefined = s.operations[operationId];
        while (op && !op.isRuntimeRoot) {
          op = op.parentOperationId ? s.operations[op.parentOperationId] : undefined;
        }
        return op;
      },
  },
}));

const build = (
  data: Partial<UIChatMessage> = {},
  role: MessageActionContext['role'] = 'assistant',
  contentBlock?: Partial<AssistantContentBlock>,
) =>
  renderHook(() =>
    copyOperationIdAction.useBuild({
      contentBlock: contentBlock as AssistantContentBlock,
      data: { content: 'Hello', role: 'assistant', ...data } as UIChatMessage,
      id: 'message-1',
      role,
    }),
  ).result.current;

describe('copyOperationIdAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDevMode = true;
    mocks.messageOperationMap = {};
    mocks.operations = {};
  });

  it('is absent when Advanced Tools (dev mode) is off', () => {
    mocks.isDevMode = false;

    expect(build({ metadata: { operationId: 'op-server' } })).toBeNull();
  });

  it('is absent when no operation id is resolvable', () => {
    expect(build()).toBeNull();
  });

  it('copies the provenance stamp persisted on the message', async () => {
    const action = build({ metadata: { operationId: 'op-durable' } });

    await act(async () => action?.handleClick?.());

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('op-durable');
    expect(mocks.messageSuccess).toHaveBeenCalled();
  });

  it('prefers the durable stamp over the live runtime operation', async () => {
    mocks.messageOperationMap = { 'message-1': 'op-local' };
    mocks.operations = {
      'op-local': { id: 'op-local', isRuntimeRoot: true, metadata: {} },
    };

    const action = build({ metadata: { operationId: 'op-durable' } });

    await act(async () => action?.handleClick?.());

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('op-durable');
  });

  it('prefers the block-level stamp for group messages', async () => {
    const action = build({ metadata: { operationId: 'op-message' } }, 'group', {
      id: 'block-1',
      metadata: { operationId: 'op-block' },
    });

    await act(async () => action?.handleClick?.());

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('op-block');
  });

  it('walks the runtime chain to the root and prefers its server operation id', async () => {
    mocks.messageOperationMap = { 'message-1': 'op-child' };
    mocks.operations = {
      'op-child': { id: 'op-child', metadata: {}, parentOperationId: 'op-root' },
      'op-root': {
        id: 'op-root',
        isRuntimeRoot: true,
        metadata: { serverOperationId: 'op-server' },
      },
    };

    const action = build();

    await act(async () => action?.handleClick?.());

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('op-server');
  });

  it('falls back to the local runtime operation id without a server id', async () => {
    mocks.messageOperationMap = { 'message-1': 'op-local' };
    mocks.operations = {
      'op-local': { id: 'op-local', isRuntimeRoot: true, metadata: {} },
    };

    const action = build();

    await act(async () => action?.handleClick?.());

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('op-local');
  });

  it('is absent when the mapped operation has no AI-runtime ancestor', () => {
    // messageOperationMap is last-write-wins: a later translate/tts operation
    // can own the slot. Its id must not surface as the message's operation id.
    mocks.messageOperationMap = { 'message-1': 'op-translate' };
    mocks.operations = {
      'op-translate': { id: 'op-translate', metadata: {} },
    };

    expect(build()).toBeNull();
  });

  it('resolves the runtime operation through the content block id for groups', async () => {
    mocks.messageOperationMap = { 'block-1': 'op-block-local' };
    mocks.operations = {
      'op-block-local': { id: 'op-block-local', isRuntimeRoot: true, metadata: {} },
    };

    const action = build({}, 'group', { id: 'block-1' });

    await act(async () => action?.handleClick?.());

    expect(mocks.copyToClipboard).toHaveBeenCalledWith('op-block-local');
  });
});
