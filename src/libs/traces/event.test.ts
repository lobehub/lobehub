import { TraceEventType } from '@lobechat/types';
import { diffChars } from 'diff';
import { type LangfuseTraceClient } from 'langfuse-core';
import { describe, expect, it } from 'vitest';

import { EventScore, TraceEventClient } from './event';

describe('TraceEventClient', () => {
  it('should correctly initialize with a LangfuseTraceClient instance', () => {
    // 准备
    const mockLangfuseTraceClient = {} as LangfuseTraceClient; // 创建一个空的 mock 对象作为 LangfuseTraceClient 的替身
    // 执行
    const client = new TraceEventClient(mockLangfuseTraceClient);
    // 断言
    expect((client as any)._trace).toBe(mockLangfuseTraceClient); // 使用 any 类型来绕过 TypeScript 的访问限制
  });

  describe('scoreObservation', () => {
    it('should call _trace.client.score when observationId is provided', () => {
      // 准备
      const scoreSpy = vi.fn(); // 创建一个 spy 函数
      const mockLangfuseTraceClient = {
        client: {
          score: scoreSpy, // 使用 spy 函数代替实际的 score 方法
        },
      } as unknown as LangfuseTraceClient; // 使用 unknown 转换绕过类型检查

      const client = new TraceEventClient(mockLangfuseTraceClient);
      const params = {
        name: 'test',
        observationId: 'obs123',
        traceId: 'trace456',
        value: 0.5,
      };

      // 执行
      (client as any).scoreObservation(params); // 使用 any 类型来绕过 TypeScript 的访问限制

      // 断言
      expect(scoreSpy).toHaveBeenCalledWith(params); // 验证 scoreSpy 是否被以正确的参数调用
    });

    it('should not call _trace.client.score when observationId is not provided', () => {
      // 准备
      const scoreSpy = vi.fn();
      const mockLangfuseTraceClient = {
        client: {
          score: scoreSpy,
        },
      } as unknown as LangfuseTraceClient;

      const client = new TraceEventClient(mockLangfuseTraceClient);
      const params = {
        name: 'test',
        // 注意，这里没有提供 observationId
        traceId: 'trace456',
        value: 0.5,
      };

      // 执行
      (client as any).scoreObservation(params);

      // 断言
      expect(scoreSpy).not.toHaveBeenCalled(); // 验证 scoreSpy 没有被调用
    });
  });

  describe('copyMessage', () => {
    it('should trigger _trace.event and scoreObservation with correct parameters', async () => {
      const eventSpy = vi.fn();
      const scoreObservationSpy = vi.fn();
      const mockLangfuseTraceClient = { event: eventSpy } as unknown as LangfuseTraceClient;

      const client = new TraceEventClient(mockLangfuseTraceClient);
      // 使用 spy 替换 scoreObservation 方法
      (client as any).scoreObservation = scoreObservationSpy;

      const params = {
        traceId: 'trace123',
        observationId: 'obs456',
        content: 'test content',
      };

      await client.copyMessage(params as any);

      // 验证 _trace.event 是否被正确调用
      expect(eventSpy).toHaveBeenCalledWith({
        input: params.content,
        metadata: { score: EventScore.Copy },
        name: TraceEventType.CopyMessage,
      });

      // 验证 scoreObservation 是否被正确调用
      expect(scoreObservationSpy).toHaveBeenCalledWith({
        name: 'copy message',
        observationId: params.observationId,
        traceId: params.traceId,
        value: EventScore.Copy,
      });
    });
  });

  describe('modifyMessage', () => {
    it('should trigger _trace.event, _trace.update and scoreObservation with correct parameters', async () => {
      const eventSpy = vi.fn();
      const updateSpy = vi.fn();
      const mockValue = [{ added: true, count: 1, value: 'a' }];

      const mockLangfuseTraceClient = {
        event: eventSpy,
        update: updateSpy,
      } as unknown as LangfuseTraceClient;

      const client = new TraceEventClient(mockLangfuseTraceClient);
      // @ts-ignore
      const spy = vi.spyOn(client, 'scoreObservation').mockImplementation(() => vi.fn());

      const params = {
        content: 'hello',
        nextContent: 'hallo',
        observationId: 'obs789',
        traceId: 'trace321',
      };

      vi.mock('diff', () => ({
        diffChars: vi.fn().mockReturnValue([{ added: true, count: 1, value: 'a' }]),
      }));

      await client.modifyMessage(params as any);

      // 验证 diffChars 是否被调用
      expect(diffChars).toHaveBeenCalledWith(params.content, params.nextContent);

      // 验证 _trace.event 是否被正确调用
      expect(eventSpy).toHaveBeenCalledWith({
        input: params.content,
        metadata: { diffs: mockValue, score: EventScore.Modify },
        name: TraceEventType.ModifyMessage,
        output: params.nextContent,
      });

      // 验证 _trace.update 是否被调用
      expect(updateSpy).toHaveBeenCalledWith({
        output: params.nextContent,
        // tags: [TraceNameMap.UserEvents] // 当支持时添加
      });

      // 验证 scoreObservation 是否被正确调用
      expect(spy).toHaveBeenCalledWith({
        name: 'modify message',
        observationId: params.observationId,
        traceId: params.traceId,
        value: EventScore.Modify,
      });
    });
  });
});
