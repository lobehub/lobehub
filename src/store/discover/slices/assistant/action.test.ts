import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';

import { useDiscoverStore as useStore } from '../../store';

vi.mock('zustand/traditional');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssistantAction', () => {
  describe('useAssistantCategories', () => {
    it('should fetch assistant categories with correct parameters', async () => {
      const mockCategories = [
        { id: 'cat-1', name: 'Category 1' },
        { id: 'cat-2', name: 'Category 2' },
      ];

      vi.spyOn(discoverService, 'getAssistantCategories').mockResolvedValue(mockCategories as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = {} as any;
      const { result } = renderHook(() => useStore.getState().useAssistantCategories(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockCategories);
      });

      expect(discoverService.getAssistantCategories).toHaveBeenCalledWith(params);
    });

    it('should fetch assistant categories with custom parameters', async () => {
      const mockCategories = [{ id: 'cat-1', name: 'Custom Category' }];

      vi.spyOn(discoverService, 'getAssistantCategories').mockResolvedValue(mockCategories as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { filter: 'popular' } as any;
      const { result } = renderHook(() => useStore.getState().useAssistantCategories(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockCategories);
      });

      expect(discoverService.getAssistantCategories).toHaveBeenCalledWith(params);
    });
  });

  describe('useAssistantDetail', () => {
    it('should fetch assistant detail when identifier is provided', async () => {
      const mockDetail = {
        identifier: 'test-assistant',
        name: 'Test Assistant',
        description: 'A test assistant',
      };

      vi.spyOn(discoverService, 'getAssistantDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'test-assistant' };
      const { result } = renderHook(() => useStore.getState().useAssistantDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(discoverService.getAssistantDetail).toHaveBeenCalledWith(params);
    });

    it('should respect locale changes', async () => {
      const mockDetail = {
        identifier: 'test-assistant',
        name: '测试助理',
        description: '一个测试助理',
      };

      vi.spyOn(discoverService, 'getAssistantDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { identifier: 'test-assistant' };
      const { result } = renderHook(() => useStore.getState().useAssistantDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(globalHelpers.getCurrentLanguage).toHaveBeenCalled();
    });
  });

  describe('useAssistantIdentifiers', () => {
    it('should fetch assistant identifiers', async () => {
      const mockIdentifiers = [
        { identifier: 'assistant-1', lastModified: '2024-01-01' },
        { identifier: 'assistant-2', lastModified: '2024-01-02' },
      ];

      vi.spyOn(discoverService, 'getAssistantIdentifiers').mockResolvedValue(mockIdentifiers);

      const { result } = renderHook(() => useStore.getState().useAssistantIdentifiers());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockIdentifiers);
      });

      expect(discoverService.getAssistantIdentifiers).toHaveBeenCalled();
    });
  });

  describe('useAssistantList', () => {
    it('should fetch assistant list with default parameters', async () => {
      const mockList = {
        items: [{ identifier: 'assistant-1' }, { identifier: 'assistant-2' }],
        total: 2,
      };

      vi.spyOn(discoverService, 'getAssistantList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const { result } = renderHook(() => useStore.getState().useAssistantList());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getAssistantList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
      });
    });

    it('should fetch assistant list with custom parameters', async () => {
      const mockList = {
        items: [{ identifier: 'assistant-1' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getAssistantList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { page: 2, pageSize: 10, category: 'productivity' } as any;
      const { result } = renderHook(() => useStore.getState().useAssistantList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getAssistantList).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        category: 'productivity',
      });
    });

    it('should convert page and pageSize to numbers', async () => {
      vi.spyOn(discoverService, 'getAssistantList').mockResolvedValue({ items: [] } as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { page: 3, pageSize: 15 } as any;
      const { result } = renderHook(() => useStore.getState().useAssistantList(params));

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(discoverService.getAssistantList).toHaveBeenCalledWith({
        page: 3,
        pageSize: 15,
      });
    });

    it('should work with search query parameter', async () => {
      const mockList = {
        items: [{ identifier: 'search-result-1' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getAssistantList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { search: 'coding', page: 1, pageSize: 21 } as any;
      const { result } = renderHook(() => useStore.getState().useAssistantList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getAssistantList).toHaveBeenCalledWith({
        search: 'coding',
        page: 1,
        pageSize: 21,
      });
    });

    it('should work with multiple filter parameters', async () => {
      const mockList = {
        items: [{ identifier: 'filtered-assistant' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getAssistantList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = {
        category: 'development',
        search: 'code',
        page: 1,
        pageSize: 10,
      } as any;
      const { result } = renderHook(() => useStore.getState().useAssistantList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getAssistantList).toHaveBeenCalledWith({
        category: 'development',
        search: 'code',
        page: 1,
        pageSize: 10,
      });
    });
  });
});
