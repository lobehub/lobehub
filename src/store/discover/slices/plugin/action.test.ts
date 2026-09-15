import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';

import { useDiscoverStore as useStore } from '../../store';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PluginAction', () => {
  describe('usePluginCategories', () => {
    it('should fetch plugin categories with correct parameters', async () => {
      const mockCategories = [
        { id: 'cat-1', name: 'Category 1' },
        { id: 'cat-2', name: 'Category 2' },
      ];

      vi.spyOn(discoverService, 'getPluginCategories').mockResolvedValue(mockCategories as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = {} as any;
      const { result } = renderHook(() => useStore.getState().usePluginCategories(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockCategories);
      });

      expect(discoverService.getPluginCategories).toHaveBeenCalledWith(params);
    });
  });

  describe('usePluginDetail', () => {
    it('should fetch plugin detail when identifier is provided', async () => {
      const mockDetail = {
        identifier: 'test-plugin',
        name: 'Test Plugin',
        description: 'A test plugin',
      };

      vi.spyOn(discoverService, 'getPluginDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'test-plugin', withManifest: true };
      const { result } = renderHook(() => useStore.getState().usePluginDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(discoverService.getPluginDetail).toHaveBeenCalledWith(params);
    });

    it('should not fetch when identifier is undefined', () => {
      const { result } = renderHook(() =>
        useStore.getState().usePluginDetail({ identifier: undefined }),
      );

      expect(result.current.data).toBeUndefined();
      expect(discoverService.getPluginDetail).not.toHaveBeenCalled();
    });
  });

  describe('usePluginIdentifiers', () => {
    it('should fetch plugin identifiers', async () => {
      const mockIdentifiers = [
        { identifier: 'plugin-1', lastModified: '2024-01-01' },
        { identifier: 'plugin-2', lastModified: '2024-01-02' },
      ];

      vi.spyOn(discoverService, 'getPluginIdentifiers').mockResolvedValue(mockIdentifiers);

      const { result } = renderHook(() => useStore.getState().usePluginIdentifiers());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockIdentifiers);
      });

      expect(discoverService.getPluginIdentifiers).toHaveBeenCalled();
    });
  });

  describe('usePluginList', () => {
    it('should fetch plugin list with default parameters', async () => {
      const mockList = {
        items: [{ identifier: 'plugin-1' }, { identifier: 'plugin-2' }],
        total: 2,
      };

      vi.spyOn(discoverService, 'getPluginList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const { result } = renderHook(() => useStore.getState().usePluginList());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getPluginList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
      });
    });

    it('should fetch plugin list with custom parameters', async () => {
      const mockList = {
        items: [{ identifier: 'plugin-1' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getPluginList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { page: 2, pageSize: 10, category: 'development' } as any;
      const { result } = renderHook(() => useStore.getState().usePluginList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getPluginList).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        category: 'development',
      });
    });

    it('should convert page and pageSize to numbers', async () => {
      vi.spyOn(discoverService, 'getPluginList').mockResolvedValue({ items: [] } as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { page: 3, pageSize: 15 } as any;
      const { result } = renderHook(() => useStore.getState().usePluginList(params));

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(discoverService.getPluginList).toHaveBeenCalledWith({
        page: 3,
        pageSize: 15,
      });
    });
  });
});
