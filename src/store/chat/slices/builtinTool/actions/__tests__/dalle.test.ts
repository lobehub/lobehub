import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { imageGenerationService } from '@/services/textToImage';
import { uploadService } from '@/services/upload';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';
import { DallEImageItem } from '@/types/tool/dalle';

describe('chatToolSlice - dalle', () => {
  describe('generateImageFromPrompts', () => {
    it('should generate images from prompts, update items, and upload images', async () => {
      const { result } = renderHook(() => useChatStore());

      const initialMessageContent = JSON.stringify([
        { prompt: 'test prompt', previewUrl: 'old-url', imageId: 'old-id' },
      ]);

      vi.spyOn(chatSelectors, 'getMessageById').mockImplementationOnce(
        (id) => () =>
          ({
            id,
            content: initialMessageContent,
          }) as UIChatMessage,
      );

      const messageId = 'message-id';
      const prompts = [
        { prompt: 'test prompt 1' },
        { prompt: 'test prompt 2' },
      ] as DallEImageItem[];
      const mockUrl = 'https://example.com/image.png';
      const mockId = 'image-id';

      vi.spyOn(imageGenerationService, 'generateImage').mockResolvedValue(mockUrl);
      vi.spyOn(uploadService, 'getImageFileByUrlWithCORS').mockResolvedValue(
        new File(['1'], 'file.png', { type: 'image/png' }),
      );

      // Mock the new uploadWithProgress method from useFileStore
      vi.spyOn(useFileStore, 'getState').mockReturnValue({
        uploadWithProgress: vi.fn().mockResolvedValue({
          id: mockId,
          url: '',
          dimensions: { width: 512, height: 512 },
          filename: 'file.png',
        }),
      } as any);

      // Mock store methods that are called in the implementation
      vi.spyOn(result.current, 'toggleDallEImageLoading');
      vi.spyOn(result.current, 'updatePluginState').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.generateImageFromPrompts(prompts, messageId);
      });
      // For each prompt, loading is toggled on and then off
      expect(imageGenerationService.generateImage).toHaveBeenCalledTimes(prompts.length);
      expect(useFileStore.getState().uploadWithProgress).toHaveBeenCalledTimes(prompts.length);
      expect(result.current.toggleDallEImageLoading).toHaveBeenCalledTimes(prompts.length * 2);
    });
  });

  describe('updateImageItem', () => {
    it('should update image item correctly', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'message-id';
      const initialMessageContent = JSON.stringify([
        { prompt: 'test prompt', previewUrl: 'old-url', imageId: 'old-id' },
      ]);
      const updateFunction = (draft: any) => {
        draft[0].previewUrl = 'new-url';
        draft[0].imageId = 'new-id';
      };
      vi.spyOn(result.current, 'internal_updateMessageContent').mockResolvedValue(undefined);

      // 模拟 getMessageById 返回消息内容
      vi.spyOn(chatSelectors, 'getMessageById').mockImplementationOnce(
        (id) => () =>
          ({
            id,
            content: initialMessageContent,
          }) as UIChatMessage,
      );
      vi.spyOn(messageService, 'updateMessage').mockResolvedValueOnce(undefined);

      await act(async () => {
        await result.current.updateImageItem(messageId, updateFunction);
      });

      // 验证 internal_updateMessageContent 是否被正确调用以更新内容
      expect(result.current.internal_updateMessageContent).toHaveBeenCalledWith(
        messageId,
        JSON.stringify([{ prompt: 'test prompt', previewUrl: 'new-url', imageId: 'new-id' }]),
      );
    });
  });

  describe('text2image', () => {
    it('should call generateImageFromPrompts with provided data', async () => {
      const { result } = renderHook(() => useChatStore());
      const id = 'message-id';
      const data = [{ prompt: 'prompt 1' }, { prompt: 'prompt 2' }] as DallEImageItem[];

      // Mock generateImageFromPrompts
      const generateImageFromPromptsMock = vi
        .spyOn(result.current, 'generateImageFromPrompts')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.text2image(id, data);
      });

      expect(generateImageFromPromptsMock).toHaveBeenCalledWith(data, id);
    });
  });
});
