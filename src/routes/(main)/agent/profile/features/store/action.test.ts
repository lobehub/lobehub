import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import type { IEditor } from '@lobehub/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '.';

describe('agent profile store actions', () => {
  const editorContent = {
    json: { root: { children: ['agent-a'] } },
    markdown: 'agent-a draft',
  };
  const editor = {
    getDocument: vi.fn((format: 'json' | 'markdown') => editorContent[format]),
  } as unknown as IEditor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    editorContent.json = { root: { children: ['agent-a'] } };
    editorContent.markdown = 'agent-a draft';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps trailing autosaves isolated by the agent being edited', async () => {
    const profileStore = createStore({ editor });
    const updateConfigById = vi.fn().mockResolvedValue(undefined);

    profileStore.getState().handleContentChange('agent-a', updateConfigById);

    editorContent.json = { root: { children: ['agent-b'] } };
    editorContent.markdown = 'agent-b draft';
    profileStore.getState().handleContentChange('agent-b', updateConfigById);

    await vi.advanceTimersByTimeAsync(EDITOR_DEBOUNCE_TIME);
    await profileStore.getState().flushSave();

    expect(updateConfigById).toHaveBeenNthCalledWith(1, 'agent-a', {
      editorData: { root: { children: ['agent-a'] } },
      systemRole: 'agent-a draft',
    });
    expect(updateConfigById).toHaveBeenNthCalledWith(2, 'agent-b', {
      editorData: { root: { children: ['agent-b'] } },
      systemRole: 'agent-b draft',
    });
    expect(profileStore.getState().promptSaveStatus).toBe('saved');
    expect(profileStore.getState().promptLastUpdatedTime).toBeInstanceOf(Date);
  });

  it('serializes saves emitted by one editor store', async () => {
    const profileStore = createStore({ editor });
    let resolveAgentA: (() => void) | undefined;
    const updateConfigById = vi.fn((agentId: string) => {
      if (agentId !== 'agent-a') return Promise.resolve();

      return new Promise<void>((resolve) => {
        resolveAgentA = resolve;
      });
    });

    profileStore.getState().handleContentChange('agent-a', updateConfigById);
    editorContent.markdown = 'agent-b draft';
    profileStore.getState().handleContentChange('agent-b', updateConfigById);

    vi.advanceTimersByTime(EDITOR_DEBOUNCE_TIME);
    await Promise.resolve();

    expect(updateConfigById).toHaveBeenCalledTimes(1);
    expect(updateConfigById).toHaveBeenLastCalledWith('agent-a', expect.any(Object));

    resolveAgentA?.();
    await Promise.resolve();

    // Agent A's older completion must not mark the newer Agent B draft as saved.
    expect(profileStore.getState().promptSaveStatus).toBe('saving');

    await profileStore.getState().flushSave();

    expect(updateConfigById).toHaveBeenCalledTimes(2);
    expect(updateConfigById).toHaveBeenLastCalledWith('agent-b', expect.any(Object));
  });

  it('reads a delayed change from the editor instance that emitted it', async () => {
    const profileStore = createStore({ editor });
    const sourceEditor = {
      getDocument: vi.fn((format: 'json' | 'markdown') =>
        format === 'json' ? { root: { children: ['agent-a delayed'] } } : 'agent-a delayed draft',
      ),
    } as unknown as IEditor;
    const updateConfigById = vi.fn().mockResolvedValue(undefined);

    editorContent.json = { root: { children: ['agent-b'] } };
    editorContent.markdown = 'agent-b draft';
    profileStore.getState().handleContentChange('agent-a', updateConfigById, sourceEditor);

    await vi.advanceTimersByTimeAsync(EDITOR_DEBOUNCE_TIME);
    await profileStore.getState().flushSave();

    expect(updateConfigById).toHaveBeenCalledWith('agent-a', {
      editorData: { root: { children: ['agent-a delayed'] } },
      systemRole: 'agent-a delayed draft',
    });
  });

  it('keeps a failed Prompt save visible and retries the same draft', async () => {
    const profileStore = createStore({ editor });
    const updateConfigById = vi
      .fn()
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    profileStore.getState().handleContentChange('agent-a', updateConfigById);

    expect(profileStore.getState().promptSaveStatus).toBe('saving');

    await vi.advanceTimersByTimeAsync(EDITOR_DEBOUNCE_TIME);
    await profileStore.getState().flushSave();

    expect(profileStore.getState().promptSaveStatus).toBe('failed');
    expect(profileStore.getState().promptLastUpdatedTime).toBeNull();

    await profileStore.getState().retryPromptSave();

    expect(updateConfigById).toHaveBeenCalledTimes(2);
    expect(updateConfigById).toHaveBeenLastCalledWith('agent-a', {
      editorData: { root: { children: ['agent-a'] } },
      systemRole: 'agent-a draft',
    });
    expect(profileStore.getState().promptSaveStatus).toBe('saved');
    expect(profileStore.getState().promptLastUpdatedTime).toBeInstanceOf(Date);
  });
});
