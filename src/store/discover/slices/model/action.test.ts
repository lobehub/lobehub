import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';

import { useDiscoverStore as useStore } from '../../store';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelAction', () => {
  describe('useModelCategories', () => {
    it('should fetch model categories with correct parameters', async () => {
      const mockCategories = [
        { id: 'cat-1', name: 'Category 1' },
        { id: 'cat-2', name: 'Category 2' },
      ];

      vi.spyOn(discoverService, 'getModelCategories').mockResolvedValue(mockCategories as any);

      const params = {} as any;
      const { result } = renderHook(() => useStore.getState().useModelCategories(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockCategories);
      });

      expect(discoverService.getModelCategories).toHaveBeenCalledWith(params);
    });

    it('should fetch model categories with custom parameters', async () => {
      const mockCategories = [{ id: 'cat-1', name: 'AI Models' }];

      vi.spyOn(discoverService, 'getModelCategories').mockResolvedValue(mockCategories as any);

      const params = { category: 'llm', limit: 10 } as any;
      const { result } = renderHook(() => useStore.getState().useModelCategories(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockCategories);
      });

      expect(discoverService.getModelCategories).toHaveBeenCalledWith(params);
    });
  });

  describe('useModelDetail', () => {
    it('should fetch model detail when identifier is provided', async () => {
      const mockDetail = {
        identifier: 'gpt-4',
        name: 'GPT-4',
        description: 'A powerful language model',
        provider: 'openai',
      };

      vi.spyOn(discoverService, 'getModelDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'gpt-4' };
      const { result } = renderHook(() => useStore.getState().useModelDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(discoverService.getModelDetail).toHaveBeenCalledWith(params);
    });

    it('should include locale in SWR key', async () => {
      const mockDetail = {
        identifier: 'gpt-4',
        name: 'GPT-4',
      };

      vi.spyOn(discoverService, 'getModelDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { identifier: 'gpt-4' };
      const { result } = renderHook(() => useStore.getState().useModelDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(globalHelpers.getCurrentLanguage).toHaveBeenCalled();
      expect(discoverService.getModelDetail).toHaveBeenCalledWith(params);
    });

    it('should return undefined when model is not found', async () => {
      vi.spyOn(discoverService, 'getModelDetail').mockResolvedValue(undefined);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'non-existent-model' };
      const { result } = renderHook(() => useStore.getState().useModelDetail(params));

      await waitFor(() => {
        expect(result.current.data).toBeUndefined();
      });

      expect(discoverService.getModelDetail).toHaveBeenCalledWith(params);
    });
  });

  describe('useModelIdentifiers', () => {
    it('should fetch model identifiers', async () => {
      const mockIdentifiers = [
        { identifier: 'gpt-4', lastModified: '2024-01-01' },
        { identifier: 'claude-3', lastModified: '2024-01-02' },
      ];

      vi.spyOn(discoverService, 'getModelIdentifiers').mockResolvedValue(mockIdentifiers);

      const { result } = renderHook(() => useStore.getState().useModelIdentifiers());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockIdentifiers);
      });

      expect(discoverService.getModelIdentifiers).toHaveBeenCalled();
    });
  });

  describe('useModelList', () => {
    it('should fetch model list with default parameters', async () => {
      const mockList = {
        items: [{ identifier: 'gpt-4' }, { identifier: 'claude-3' }],
        total: 2,
      };

      vi.spyOn(discoverService, 'getModelList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const { result } = renderHook(() => useStore.getState().useModelList());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getModelList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
      });
    });

    it('should fetch model list with custom parameters', async () => {
      const mockList = {
        items: [{ identifier: 'gpt-4' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getModelList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { page: 2, pageSize: 10, category: 'llm' } as any;
      const { result } = renderHook(() => useStore.getState().useModelList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getModelList).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        category: 'llm',
      });
    });

    it('should convert page and pageSize to numbers', async () => {
      vi.spyOn(discoverService, 'getModelList').mockResolvedValue({ items: [] } as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { page: 3, pageSize: 15 } as any;
      const { result } = renderHook(() => useStore.getState().useModelList(params));

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(discoverService.getModelList).toHaveBeenCalledWith({
        page: 3,
        pageSize: 15,
      });
    });

    it('should use default page and pageSize when not provided in params', async () => {
      const mockList = {
        items: [{ identifier: 'model-1' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getModelList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { category: 'vision' } as any;
      const { result } = renderHook(() => useStore.getState().useModelList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getModelList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
        category: 'vision',
      });
    });

    it('should include locale in SWR key', async () => {
      const mockList = {
        items: [{ identifier: 'model-1' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getModelList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('ja-JP');

      const { result } = renderHook(() => useStore.getState().useModelList());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(globalHelpers.getCurrentLanguage).toHaveBeenCalled();
    });

    it('should handle search query parameter', async () => {
      const mockList = {
        items: [{ identifier: 'gpt-4' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getModelList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { search: 'gpt', page: 1, pageSize: 10 } as any;
      const { result } = renderHook(() => useStore.getState().useModelList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getModelList).toHaveBeenCalledWith({
        search: 'gpt',
        page: 1,
        pageSize: 10,
      });
    });
  });
});
