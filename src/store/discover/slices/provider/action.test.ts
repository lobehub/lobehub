import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';

import { useDiscoverStore as useStore } from '../../store';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProviderAction', () => {
  describe('useProviderDetail', () => {
    it('should fetch provider detail when identifier is provided', async () => {
      const mockDetail = {
        description: 'OpenAI provider',
        identifier: 'openai',
        modelCount: 10,
        models: [
          { displayName: 'GPT-4', id: 'gpt-4' },
          { displayName: 'GPT-3.5 Turbo', id: 'gpt-3.5-turbo' },
        ],
        name: 'OpenAI',
        related: [],
      };

      vi.spyOn(discoverService, 'getProviderDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'openai' };
      const { result } = renderHook(() => useStore.getState().useProviderDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(discoverService.getProviderDetail).toHaveBeenCalledWith(params);
    });

    it('should fetch provider detail with readme when withReadme is true', async () => {
      const mockDetail = {
        description: 'Anthropic provider',
        identifier: 'anthropic',
        modelCount: 5,
        models: [],
        name: 'Anthropic',
        readme: '# Anthropic Provider\n\nThis is the Anthropic provider.',
        related: [],
      };

      vi.spyOn(discoverService, 'getProviderDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'anthropic', withReadme: true };
      const { result } = renderHook(() => useStore.getState().useProviderDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(discoverService.getProviderDetail).toHaveBeenCalledWith(params);
    });

    it('should use current language in the request', async () => {
      const mockDetail = {
        identifier: 'google',
        modelCount: 8,
        models: [],
        name: 'Google',
        related: [],
      };

      vi.spyOn(discoverService, 'getProviderDetail').mockResolvedValue(mockDetail as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { identifier: 'google' };
      const { result } = renderHook(() => useStore.getState().useProviderDetail(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockDetail);
      });

      expect(globalHelpers.getCurrentLanguage).toHaveBeenCalled();
      expect(discoverService.getProviderDetail).toHaveBeenCalledWith(params);
    });

    it('should return undefined when provider is not found', async () => {
      vi.spyOn(discoverService, 'getProviderDetail').mockResolvedValue(undefined);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { identifier: 'non-existent' };
      const { result } = renderHook(() => useStore.getState().useProviderDetail(params));

      await waitFor(() => {
        expect(result.current.data).toBeUndefined();
      });
    });
  });

  describe('useProviderIdentifiers', () => {
    it('should fetch provider identifiers', async () => {
      const mockIdentifiers = [
        { identifier: 'openai', lastModified: '2024-01-01' },
        { identifier: 'anthropic', lastModified: '2024-01-02' },
        { identifier: 'google', lastModified: '2024-01-03' },
      ];

      vi.spyOn(discoverService, 'getProviderIdentifiers').mockResolvedValue(mockIdentifiers);

      const { result } = renderHook(() => useStore.getState().useProviderIdentifiers());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockIdentifiers);
      });

      expect(discoverService.getProviderIdentifiers).toHaveBeenCalled();
    });
  });

  describe('useProviderList', () => {
    it('should fetch provider list with default parameters', async () => {
      const mockList = {
        currentPage: 1,
        items: [
          { identifier: 'openai', modelCount: 10, name: 'OpenAI' },
          { identifier: 'anthropic', modelCount: 5, name: 'Anthropic' },
        ],
        pageSize: 21,
        totalCount: 2,
        totalPages: 1,
      };

      vi.spyOn(discoverService, 'getProviderList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const { result } = renderHook(() => useStore.getState().useProviderList());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getProviderList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
      });
    });

    it('should fetch provider list with custom parameters', async () => {
      const mockList = {
        currentPage: 2,
        items: [{ identifier: 'openai', modelCount: 10, name: 'OpenAI' }],
        pageSize: 10,
        totalCount: 15,
        totalPages: 2,
      };

      vi.spyOn(discoverService, 'getProviderList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const params = { page: 2, pageSize: 10, q: 'openai' } as any;
      const { result } = renderHook(() => useStore.getState().useProviderList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getProviderList).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        q: 'openai',
      });
    });

    it('should convert page and pageSize to numbers', async () => {
      const mockList = {
        currentPage: 3,
        items: [],
        pageSize: 15,
        totalCount: 0,
        totalPages: 0,
      };

      vi.spyOn(discoverService, 'getProviderList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { page: 3, pageSize: 15 } as any;
      const { result } = renderHook(() => useStore.getState().useProviderList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getProviderList).toHaveBeenCalledWith({
        page: 3,
        pageSize: 15,
      });
    });

    it('should use current language in the request', async () => {
      const mockList = {
        currentPage: 1,
        items: [],
        pageSize: 21,
        totalCount: 0,
        totalPages: 0,
      };

      vi.spyOn(discoverService, 'getProviderList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');

      const { result } = renderHook(() => useStore.getState().useProviderList());

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(globalHelpers.getCurrentLanguage).toHaveBeenCalled();
    });

    it('should handle sort parameter', async () => {
      const mockList = {
        currentPage: 1,
        items: [
          { identifier: 'anthropic', modelCount: 5, name: 'Anthropic' },
          { identifier: 'openai', modelCount: 10, name: 'OpenAI' },
        ],
        pageSize: 21,
        totalCount: 2,
        totalPages: 1,
      };

      vi.spyOn(discoverService, 'getProviderList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { order: 'asc', sort: 'identifier' } as any;
      const { result } = renderHook(() => useStore.getState().useProviderList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getProviderList).toHaveBeenCalledWith({
        order: 'asc',
        page: 1,
        pageSize: 21,
        sort: 'identifier',
      });
    });

    it('should handle search query parameter', async () => {
      const mockList = {
        currentPage: 1,
        items: [{ identifier: 'openai', modelCount: 10, name: 'OpenAI' }],
        pageSize: 21,
        totalCount: 1,
        totalPages: 1,
      };

      vi.spyOn(discoverService, 'getProviderList').mockResolvedValue(mockList as any);
      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');

      const params = { q: 'openai' } as any;
      const { result } = renderHook(() => useStore.getState().useProviderList(params));

      await waitFor(() => {
        expect(result.current.data).toEqual(mockList);
      });

      expect(discoverService.getProviderList).toHaveBeenCalledWith({
        page: 1,
        pageSize: 21,
        q: 'openai',
      });
    });
  });
});
