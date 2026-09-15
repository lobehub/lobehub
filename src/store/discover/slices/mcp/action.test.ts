import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';

import { useDiscoverStore as useStore } from '../../store';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCPAction', () => {
  describe('useFetchMcpDetail', () => {
    it('should fetch MCP detail when identifier is provided', async () => {
      const mockDetail = {
        identifier: 'test-mcp',
        name: 'Test MCP',
        description: 'A test MCP server',
      };

      vi.spyOn(discoverService, 'getMcpDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'test-mcp', version: '1.0.0' };
      const { result } = renderHook(() => useStore.getState().useFetchMcpDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(discoverService.getMcpDetail).toHaveBeenCalledWith(params);
    });

    it('should not fetch when identifier is undefined', () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchMcpDetail({ identifier: undefined }),
      );

      expect(result.current.data).toBeUndefined();
      expect(discoverService.getMcpDetail).not.toHaveBeenCalled();
    });
  });

  describe('useFetchMcpList', () => {
    it('should fetch MCP list with default parameters', async () => {
      const mockList = {
        items: [{ identifier: 'mcp-1' }, { identifier: 'mcp-2' }],
        total: 2,
      };

      vi.spyOn(discoverService, 'getMcpList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const { result } = renderHook(() => useStore.getState().useFetchMcpList({}));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getMcpList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
      });
    });

    it('should fetch MCP list with custom parameters', async () => {
      const mockList = {
        items: [{ identifier: 'mcp-1' }],
        total: 1,
      };

      vi.spyOn(discoverService, 'getMcpList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { page: 2, pageSize: 10, category: 'data-analysis' } as any;
      const { result } = renderHook(() => useStore.getState().useFetchMcpList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getMcpList).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        category: 'data-analysis',
      });
    });

    it('should convert page and pageSize to numbers', async () => {
      vi.spyOn(discoverService, 'getMcpList').mockResolvedValue({ items: [] } as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { page: 3, pageSize: 15 } as any;
      const { result } = renderHook(() => useStore.getState().useFetchMcpList(params));

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(discoverService.getMcpList).toHaveBeenCalledWith({
        page: 3,
        pageSize: 15,
      });
    });
  });

  describe('useMcpCategories', () => {
    it('should fetch MCP categories with correct parameters', async () => {
      const mockCategories = [
        { id: 'cat-1', name: 'Category 1' },
        { id: 'cat-2', name: 'Category 2' },
      ];

      vi.spyOn(discoverService, 'getMcpCategories').mockResolvedValue(mockCategories as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = {} as any;
      const { result } = renderHook(() => useStore.getState().useMcpCategories(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockCategories);
      });

      expect(discoverService.getMcpCategories).toHaveBeenCalledWith(params);
    });
  });
});
