import { describe, expect, it, vi } from 'vitest';

import { mergeMultipleChatMethodOptions } from './mergeChatMethodOptions';

// Mock debug to avoid console output
vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

describe('mergeMultipleChatMethodOptions', () => {
  it('should return empty options when given empty array', () => {
    const result = mergeMultipleChatMethodOptions([]);

    expect(result).toEqual({
      callback: expect.any(Object),
      headers: {},
      requestHeaders: {},
    });
  });

  it('should merge headers from multiple options', () => {
    const options = [
      { headers: { 'Content-Type': 'application/json' } },
      { headers: { Authorization: 'Bearer token' } },
      { headers: { 'X-Custom': 'value' } },
    ];

    const result = mergeMultipleChatMethodOptions(options);

    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token',
      'X-Custom': 'value',
    });
  });

  it('should merge requestHeaders from multiple options', () => {
    const options = [
      { requestHeaders: { 'User-Agent': 'test' } },
      { requestHeaders: { Accept: 'application/json' } },
    ];

    const result = mergeMultipleChatMethodOptions(options);

    expect(result.requestHeaders).toEqual({
      'User-Agent': 'test',
      'Accept': 'application/json',
    });
  });

  it('should handle header conflicts by using last value', () => {
    const options = [
      { headers: { 'Content-Type': 'application/json' } },
      { headers: { 'Content-Type': 'text/plain' } },
    ];

    const result = mergeMultipleChatMethodOptions(options);

    expect(result.headers).toEqual({
      'Content-Type': 'text/plain',
    });
  });

  it('should handle requestHeaders conflicts by using last value', () => {
    const options = [
      { requestHeaders: { Accept: 'text/plain' } },
      { requestHeaders: { Accept: 'application/json' } },
    ];

    const result = mergeMultipleChatMethodOptions(options);

    expect(result.requestHeaders).toEqual({ Accept: 'application/json' });
  });

  it('should call all onStart callbacks', async () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const options = [{ callback: { onStart: callback1 } }, { callback: { onStart: callback2 } }];

    const result = mergeMultipleChatMethodOptions(options);
    await result.callback?.onStart?.();

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).toHaveBeenCalledOnce();
  });

  it('should call all onText callbacks with data', async () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const testData = 'test text';
    const options = [{ callback: { onText: callback1 } }, { callback: { onText: callback2 } }];

    const result = mergeMultipleChatMethodOptions(options);
    await result.callback?.onText?.(testData);

    expect(callback1).toHaveBeenCalledWith(testData);
    expect(callback2).toHaveBeenCalledWith(testData);
  });

  it('should call all onCompletion callbacks with data', async () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const completionUsageData = {
      text: 'completion text',
      usage: {
        inputTextTokens: 5,
        outputTextTokens: 10,
        totalTokens: 15,
      },
    };
    const options = [
      { callback: { onCompletion: callback1 } },
      { callback: { onCompletion: callback2 } },
    ];

    const result = mergeMultipleChatMethodOptions(options);
    await result.callback?.onCompletion?.(completionUsageData);

    expect(callback1).toHaveBeenCalledWith(completionUsageData);
    expect(callback2).toHaveBeenCalledWith(completionUsageData);
  });

  it('should call all onFinal callbacks with data', async () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const finalUsageData = {
      text: 'final message',
      usage: {
        inputTextTokens: 3,
        outputTextTokens: 7,
        totalTokens: 10,
      },
    };
    const options = [{ callback: { onFinal: callback1 } }, { callback: { onFinal: callback2 } }];

    const result = mergeMultipleChatMethodOptions(options);
    await result.callback?.onFinal?.(finalUsageData);

    expect(callback1).toHaveBeenCalledWith(finalUsageData);
    expect(callback2).toHaveBeenCalledWith(finalUsageData);
  });

  it('should call all onGrounding callbacks from multiple options', async () => {
    const g1 = vi.fn();
    const g2 = vi.fn();
    const grounding = { citations: [{ title: 't', url: 'u' }] };

    const result = mergeMultipleChatMethodOptions([
      { callback: { onGrounding: g1 } },
      { callback: { onGrounding: g2 } },
    ]);

    await result.callback?.onGrounding?.(grounding);
    expect(g1).toHaveBeenCalledWith(grounding);
    expect(g2).toHaveBeenCalledWith(grounding);
  });

  it('should be no-op when invoking missing callback types', async () => {
    const result = mergeMultipleChatMethodOptions([{ headers: { A: 'b' } }]);

    await expect(result.callback?.onThinking?.('t')).resolves.toBeUndefined();
    await expect(result.callback?.onGrounding?.({ citations: [] })).resolves.toBeUndefined();
    await expect(
      result.callback?.onToolsCalling?.({ chunk: [], toolsCalling: [] }),
    ).resolves.toBeUndefined();
    await expect(
      result.callback?.onUsage?.({ inputTextTokens: 1, outputTextTokens: 2, totalTokens: 3 }),
    ).resolves.toBeUndefined();
  });

  it('should pass-through already normalized usage (onUsage)', async () => {
    const onUsage = vi.fn();
    const onUsageData = { inputTextTokens: 2, outputTextTokens: 3, totalTokens: 5 };

    const result = mergeMultipleChatMethodOptions([{ callback: { onUsage } }]);

    await result.callback?.onUsage?.(onUsageData);
    expect(onUsage).toHaveBeenCalledWith(onUsageData);
  });

  it('should isolate errors for non-text callbacks (onFinal)', async () => {
    const err = vi.fn().mockRejectedValue(new Error('boom'));
    const ok = vi.fn();
    const errorTestUsageData = {
      text: 'final',
      usage: { inputTextTokens: 1, outputTextTokens: 1, totalTokens: 2 },
    };

    const result = mergeMultipleChatMethodOptions([
      { callback: { onFinal: err } },
      { callback: { onFinal: ok } },
    ]);

    await expect(result.callback?.onFinal?.(errorTestUsageData)).resolves.toBeUndefined();

    expect(err).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
  });

  it('should isolate errors between different callback types', async () => {
    const errorCallback = vi.fn().mockRejectedValue(new Error('onStart error'));
    const successCallback = vi.fn();

    const result = mergeMultipleChatMethodOptions([
      { callback: { onStart: errorCallback } },
      { callback: { onText: successCallback } },
    ]);

    // onStart throws error but should not affect onText
    await expect(result.callback?.onStart?.()).resolves.toBeUndefined();
    await expect(result.callback?.onText?.('test text')).resolves.toBeUndefined();

    expect(errorCallback).toHaveBeenCalled();
    expect(successCallback).toHaveBeenCalledWith('test text');
  });

  it('should isolate errors in onCompletion between multiple options', async () => {
    const optionACallback = vi.fn().mockRejectedValue(new Error('Option A error'));
    const optionBCallback = vi.fn();
    const completionData = {
      text: 'completion',
      usage: { inputTextTokens: 2, outputTextTokens: 3, totalTokens: 5 },
    };

    const result = mergeMultipleChatMethodOptions([
      { callback: { onCompletion: optionACallback } }, // OptionA with error
      { callback: { onCompletion: optionBCallback } }, // OptionB should still work
    ]);

    await expect(result.callback?.onCompletion?.(completionData)).resolves.toBeUndefined();

    expect(optionACallback).toHaveBeenCalledWith(completionData);
    expect(optionBCallback).toHaveBeenCalledWith(completionData);
  });

  it('should isolate errors in onUsage between multiple options', async () => {
    const errorUsageCallback = vi.fn().mockRejectedValue(new Error('Usage error'));
    const successUsageCallback = vi.fn();
    const usageData = { inputTextTokens: 10, outputTextTokens: 20, totalTokens: 30 };

    const result = mergeMultipleChatMethodOptions([
      { callback: { onUsage: errorUsageCallback } },
      { callback: { onUsage: successUsageCallback } },
    ]);

    await expect(result.callback?.onUsage?.(usageData)).resolves.toBeUndefined();

    expect(errorUsageCallback).toHaveBeenCalledWith(usageData);
    expect(successUsageCallback).toHaveBeenCalledWith(usageData);
  });

  it('should isolate errors across mixed callback types from different options', async () => {
    const errorOnStart = vi.fn().mockRejectedValue(new Error('Start error'));
    const errorOnFinal = vi.fn().mockRejectedValue(new Error('Final error'));
    const successOnText = vi.fn();
    const successOnCompletion = vi.fn();

    const finalData = {
      text: 'final',
      usage: { inputTextTokens: 1, outputTextTokens: 2, totalTokens: 3 },
    };
    const completionData = {
      text: 'completion',
      usage: { inputTextTokens: 3, outputTextTokens: 4, totalTokens: 7 },
    };

    const result = mergeMultipleChatMethodOptions([
      { callback: { onStart: errorOnStart, onText: successOnText } }, // OptionA: error + success
      { callback: { onFinal: errorOnFinal, onCompletion: successOnCompletion } }, // OptionB: error + success
    ]);

    // All callbacks should be executed despite individual errors
    await expect(result.callback?.onStart?.()).resolves.toBeUndefined();
    await expect(result.callback?.onText?.('test')).resolves.toBeUndefined();
    await expect(result.callback?.onFinal?.(finalData)).resolves.toBeUndefined();
    await expect(result.callback?.onCompletion?.(completionData)).resolves.toBeUndefined();

    expect(errorOnStart).toHaveBeenCalled();
    expect(errorOnFinal).toHaveBeenCalledWith(finalData);
    expect(successOnText).toHaveBeenCalledWith('test');
    expect(successOnCompletion).toHaveBeenCalledWith(completionData);
  });

  it('should handle options with no callbacks', async () => {
    const callback1 = vi.fn();
    const options = [
      { headers: { 'Content-Type': 'application/json' } },
      { callback: { onText: callback1 } },
      { requestHeaders: { Accept: 'application/json' } },
    ];

    const result = mergeMultipleChatMethodOptions(options);
    await result.callback?.onText?.('test');

    expect(callback1).toHaveBeenCalledWith('test');
  });

  it('should handle all callback types', async () => {
    const callbacks = {
      onStart: vi.fn(),
      onText: vi.fn(),
      onCompletion: vi.fn(),
      onFinal: vi.fn(),
      onGrounding: vi.fn(),
      onThinking: vi.fn(),
      onToolsCalling: vi.fn(),
      onUsage: vi.fn(),
    };

    const options = [{ callback: callbacks }];
    const result = mergeMultipleChatMethodOptions(options);

    const allTypesUsageData = {
      inputTextTokens: 5,
      outputTextTokens: 5,
      totalTokens: 10,
    };

    const completionData = { text: 'completion', usage: allTypesUsageData };
    const finalData = { text: 'final message', usage: allTypesUsageData };
    const groundingData = { citations: [{ title: 'grounding', url: 'http://example.com' }] };
    const toolsCallingData = {
      chunk: [{ index: 0, id: 'tool1', function: { name: 'test', arguments: '{}' } }],
      toolsCalling: [
        { id: 'tool1', type: 'function', function: { name: 'test', arguments: '{}' } },
      ],
    };

    await result.callback?.onStart?.();
    await result.callback?.onText?.('text');
    await result.callback?.onCompletion?.(completionData);
    await result.callback?.onFinal?.(finalData);
    await result.callback?.onGrounding?.(groundingData);
    await result.callback?.onThinking?.('thinking content');
    await result.callback?.onToolsCalling?.(toolsCallingData);
    await result.callback?.onUsage?.(allTypesUsageData);

    expect(callbacks.onStart).toHaveBeenCalled();
    expect(callbacks.onText).toHaveBeenCalledWith('text');
    expect(callbacks.onCompletion).toHaveBeenCalledWith(completionData);
    expect(callbacks.onFinal).toHaveBeenCalledWith(finalData);
    expect(callbacks.onGrounding).toHaveBeenCalledWith(groundingData);
    expect(callbacks.onThinking).toHaveBeenCalledWith('thinking content');
    expect(callbacks.onToolsCalling).toHaveBeenCalledWith(toolsCallingData);
    expect(callbacks.onUsage).toHaveBeenCalledWith(allTypesUsageData);
  });

  it('should handle mixed options with headers and callbacks', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const options = [
      {
        headers: { 'Content-Type': 'application/json' },
        callback: { onStart: callback1 },
      },
      {
        requestHeaders: { Authorization: 'Bearer token' },
        callback: { onText: callback2 },
      },
    ];

    const result = mergeMultipleChatMethodOptions(options);

    expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(result.requestHeaders).toEqual({ Authorization: 'Bearer token' });
    expect(result.callback).toBeDefined();
  });
});
