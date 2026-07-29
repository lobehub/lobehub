/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { restoreToInputAction } from './restoreToInput';

const editor = {
  focus: vi.fn(),
  setDocument: vi.fn(),
  setJSONState: vi.fn(),
};
const updateInputMessage = vi.fn();
const clearChatUploadFileList = vi.fn();
const dispatchChatUploadFileList = vi.fn();

vi.mock('../../../../store', () => ({
  useConversationStore: (selector: (s: any) => any) => selector({ editor, updateInputMessage }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: {
    getState: () => ({ clearChatUploadFileList, dispatchChatUploadFileList }),
  },
}));

const messageSuccess = vi.fn();
vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { success: messageSuccess } }) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const build = (data: Partial<UIChatMessage>, role: MessageActionContext['role'] = 'user') =>
  renderHook(() => restoreToInputAction.useBuild({ data: data as UIChatMessage, id: 'm1', role }))
    .result.current;

describe('restoreToInputAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-user messages', () => {
    expect(build({ content: 'hi' }, 'assistant')).toBeNull();
  });

  it('restores editorData as JSON when present', () => {
    const editorData = { root: { children: [] } };
    build({ content: 'hello', editorData })!.handleClick!();

    expect(editor.setJSONState).toHaveBeenCalledWith(editorData);
    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(updateInputMessage).toHaveBeenCalledWith('hello');
    expect(editor.focus).toHaveBeenCalled();
    expect(messageSuccess).toHaveBeenCalledWith('restoreToInputSuccess');
  });

  it('falls back to markdown (with speaker tag stripped) when editorData is empty', () => {
    build({ content: '<speaker name="Bot" />\nhello', editorData: {} })!.handleClick!();

    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'hello');
    expect(editor.setJSONState).not.toHaveBeenCalled();
    expect(updateInputMessage).toHaveBeenCalledWith('hello');
  });

  it('rebuilds pending attachments from imageList and fileList', () => {
    build({
      content: 'with files',
      fileList: [{ fileType: 'application/pdf', id: 'f1', name: 'a.pdf', size: 100, url: 'u-f1' }],
      imageList: [{ alt: 'pic', id: 'i1', url: 'u-i1' }],
    })!.handleClick!();

    expect(clearChatUploadFileList).toHaveBeenCalled();
    expect(dispatchChatUploadFileList).toHaveBeenCalledWith({
      files: [
        expect.objectContaining({
          fileUrl: 'u-i1',
          id: 'i1',
          previewUrl: 'u-i1',
          status: 'success',
        }),
        expect.objectContaining({
          fileUrl: 'u-f1',
          id: 'f1',
          previewUrl: 'u-f1',
          status: 'success',
        }),
      ],
      type: 'addFiles',
    });

    const [{ files }] = dispatchChatUploadFileList.mock.calls[0];
    expect(files[0].file.type).toBe('image/*');
    expect(files[1].file).toMatchObject({ name: 'a.pdf', size: 100, type: 'application/pdf' });
  });

  it('clears the upload list but skips dispatch when there are no attachments', () => {
    build({ content: 'no files' })!.handleClick!();

    expect(clearChatUploadFileList).toHaveBeenCalled();
    expect(dispatchChatUploadFileList).not.toHaveBeenCalled();
  });
});
