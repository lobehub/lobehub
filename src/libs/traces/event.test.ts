import { TraceEventType } from '@lobechat/types';
import { diffChars } from 'diff';
import { type LangfuseTraceClient } from 'langfuse-core';
import { describe, expect, it } from 'vitest';

import { EventScore, TraceEventClient } from './event';

describe('TraceEventClient', () => {
  it('should correctly initialize with a LangfuseTraceClient instance', () => {
    // Arrange
    const mockLangfuseTraceClient = {} as LangfuseTraceClient; // Create an empty mock object as a stand-in for LangfuseTraceClient
    // Act
    const client = new TraceEventClient(mockLangfuseTraceClient);
    // Assert
    expect((client as any)._trace).toBe(mockLangfuseTraceClient); // Use any type to bypass TypeScript access restrictions
  });

  describe('scoreObservation', () => {
    it('should call _trace.client.score when observationId is provided', () => {
      // Arrange
      const scoreSpy = vi.fn(); // Create a spy function
      const mockLangfuseTraceClient = {
        client: {
          score: scoreSpy, // Use spy function in place of the actual score method
        },
      } as unknown as LangfuseTraceClient; // Use unknown cast to bypass type checking

      const client = new TraceEventClient(mockLangfuseTraceClient);
      const params = {
        name: 'test',
        observationId: 'obs123',
        traceId: 'trace456',
        value: 0.5,
      };

      // Act
      (client as any).scoreObservation(params); // Use any type to bypass TypeScript access restrictions

      // Assert
      expect(scoreSpy).toHaveBeenCalledWith(params); // Verify scoreSpy was called with the correct parameters
    });

    it('should not call _trace.client.score when observationId is not provided', () => {
      // Arrange
      const scoreSpy = vi.fn();
      const mockLangfuseTraceClient = {
        client: {
          score: scoreSpy,
        },
      } as unknown as LangfuseTraceClient;

      const client = new TraceEventClient(mockLangfuseTraceClient);
      const params = {
        name: 'test',
        // Note: observationId is not provided here
        traceId: 'trace456',
        value: 0.5,
      };

      // Act
      (client as any).scoreObservation(params);

      // Assert
      expect(scoreSpy).not.toHaveBeenCalled(); // Verify scoreSpy was not called
    });
  });

  describe('copyMessage', () => {
    it('should trigger _trace.event and scoreObservation with correct parameters', async () => {
      const eventSpy = vi.fn();
      const scoreObservationSpy = vi.fn();
      const mockLangfuseTraceClient = { event: eventSpy } as unknown as LangfuseTraceClient;

      const client = new TraceEventClient(mockLangfuseTraceClient);
      // Replace scoreObservation method with a spy
      (client as any).scoreObservation = scoreObservationSpy;

      const params = {
        traceId: 'trace123',
        observationId: 'obs456',
        content: 'test content',
      };

      await client.copyMessage(params as any);

      // Verify _trace.event was called correctly
      expect(eventSpy).toHaveBeenCalledWith({
        input: params.content,
        metadata: { score: EventScore.Copy },
        name: TraceEventType.CopyMessage,
      });

      // Verify scoreObservation was called correctly
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

      // Verify diffChars was called
      expect(diffChars).toHaveBeenCalledWith(params.content, params.nextContent);

      // Verify _trace.event was called correctly
      expect(eventSpy).toHaveBeenCalledWith({
        input: params.content,
        metadata: { diffs: mockValue, score: EventScore.Modify },
        name: TraceEventType.ModifyMessage,
        output: params.nextContent,
      });

      // Verify _trace.update was called
      expect(updateSpy).toHaveBeenCalledWith({
        output: params.nextContent,
        // tags: [TraceNameMap.UserEvents] // add when supported
      });

      // Verify scoreObservation was called correctly
      expect(spy).toHaveBeenCalledWith({
        name: 'modify message',
        observationId: params.observationId,
        traceId: params.traceId,
        value: EventScore.Modify,
      });
    });
  });
});
