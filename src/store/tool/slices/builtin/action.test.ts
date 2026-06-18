import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as workspaceHooks from '@/business/client/hooks/useActiveWorkspaceId';
import * as swr from '@/libs/swr';
import { userService } from '@/services/user';

import { useToolStore } from '../../store';

vi.mock('zustand/traditional');

describe('createBuiltinToolSlice', () => {
  describe('transformApiArgumentsToAiState', () => {
    it('should return early if the tool is already loading', async () => {
      // Given
      const key = 'mockTool';
      const params = { test: 'data' };

      const mockFn = vi.fn();
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: true },
          mockTool: mockFn,
        } as any);
      });

      await act(async () => {
        // When
        const data = await result.current.transformApiArgumentsToAiState(key, params);
        expect(data).toBeUndefined();
      });

      // Then - should not call the action if already loading
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should invoke the specified tool action and return the stringified result', async () => {
      // Given
      const key = 'mockTool';
      const mockResult = { success: true, data: 'test result' };
      const mockFn = vi.fn().mockResolvedValue(mockResult);
      const { result } = renderHook(() => useToolStore());

      const params = {
        input: 'test input',
        option: 'value',
      };

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: false },
          mockTool: mockFn,
        } as any);
      });

      // When
      let resultData: string | undefined;
      await act(async () => {
        resultData = await result.current.transformApiArgumentsToAiState(key, params);
      });

      // Then
      expect(mockFn).toHaveBeenCalledWith({
        input: 'test input',
        option: 'value',
      });
      expect(resultData).toBe(JSON.stringify(mockResult));
    });

    it('should return stringified params if action does not exist', async () => {
      // Given
      const key = 'nonExistentTool';
      const params = { test: 'data' };
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          builtinToolLoading: {},
        });
      });

      // When
      let resultData: string | undefined;
      await act(async () => {
        resultData = await result.current.transformApiArgumentsToAiState(key, params);
      });

      // Then
      expect(resultData).toBe(JSON.stringify(params));
    });

    it('should handle errors and toggle loading state', async () => {
      // Given
      const key = 'mockTool';
      const params = { test: 'data' };
      const error = new Error('Tool execution failed');
      const mockFn = vi.fn().mockRejectedValue(error);
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: false },
          mockTool: mockFn,
        } as any);
      });

      // When/Then
      await act(async () => {
        await expect(result.current.transformApiArgumentsToAiState(key, params)).rejects.toThrow(
          'Tool execution failed',
        );
      });

      // Should have toggled loading state back to false
      expect(result.current.builtinToolLoading[key]).toBe(false);
    });
  });

  describe('uninstalled builtin tools (workspace-scoped)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const mockUserState = (tool: any) =>
      vi.spyOn(userService, 'getUserState').mockResolvedValue({ settings: { tool } } as any);

    it('installBuiltinTool (personal) writes the personal list and preserves other tool settings', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({
        humanIntervention: { approvalMode: 'manual' },
        uninstalledBuiltinTools: ['a', 'b'],
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.installBuiltinTool('a');
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          humanIntervention: { approvalMode: 'manual' },
          uninstalledBuiltinTools: ['b'],
        },
      });
    });

    it('uninstallBuiltinTool (workspace) writes only the per-workspace slot, leaving personal untouched', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({
        uninstalledBuiltinTools: ['personal-tool'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': [] },
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.uninstallBuiltinTool('x');
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          uninstalledBuiltinTools: ['personal-tool'],
          uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['x'] },
        },
      });
    });

    it('install in a workspace reads from the per-workspace slot, not the personal list', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      // 'x' is uninstalled in the workspace; the personal list is unrelated.
      mockUserState({
        uninstalledBuiltinTools: ['a'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['x', 'y'] },
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.installBuiltinTool('x');
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          uninstalledBuiltinTools: ['a'],
          uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['y'] },
        },
      });
    });
  });

  describe('toggleBuiltinToolLoading', () => {
    it('should toggle the loading state for a tool', () => {
      const { result } = renderHook(() => useToolStore());
      const key = 'testTool';

      act(() => {
        result.current.toggleBuiltinToolLoading(key, true);
      });

      expect(result.current.builtinToolLoading[key]).toBe(true);

      act(() => {
        result.current.toggleBuiltinToolLoading(key, false);
      });

      expect(result.current.builtinToolLoading[key]).toBe(false);
    });
  });
});
