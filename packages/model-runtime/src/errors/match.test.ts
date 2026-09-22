import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isUserSideError, matchErrorPattern } from './match';
import { ERROR_CODE_SPECS, formatErrorRef, parseErrorRef } from './specs';
import { CATEGORY_NUMERIC_PREFIX, CLOUD_TIER_DIGIT } from './taxonomy';

describe('matchErrorPattern', () => {
  it('returns undefined for empty input', () => {
    expect(matchErrorPattern({})).toBeUndefined();
    expect(matchErrorPattern({ message: '' })).toBeUndefined();
  });

  it('matches case-insensitive substring patterns', () => {
    expect(matchErrorPattern({ message: 'PROMPT IS TOO LONG' })?.code).toBe(
      AgentRuntimeErrorType.ExceededContextWindow,
    );
  });

  it('classifies ollamacloud "context window exceeds limit" as ExceededContextWindow, not ProviderBizError', () => {
    // ollamacloud surfaces context-window overflow as a generic 400 that the
    // upstream labels ProviderBizError. The ECW message pattern sits before the
    // 400 / ProviderBizError catch-alls, so the message wins regardless.
    expect(
      matchErrorPattern({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message: '400 "invalid params, context window exceeds limit (ref: 0x123)"',
        provider: 'ollamacloud',
      })?.code,
    ).toBe(AgentRuntimeErrorType.ExceededContextWindow);
  });

  it('classifies free-plan context limit residues as ExceededContextWindow', () => {
    const message = 'Free plan effective context limit reached. Please reduce the conversation.';
    expect(matchErrorPattern({ message })?.code).toBe(AgentRuntimeErrorType.ExceededContextWindow);
  });

  it('disambiguates 429-class rate limit from balance-class quota', () => {
    expect(matchErrorPattern({ message: 'rate_limit_exceeded' })?.code).toBe(
      AgentRuntimeErrorType.RateLimitExceeded,
    );
    expect(matchErrorPattern({ message: 'Insufficient Balance: recharge' })?.code).toBe(
      AgentRuntimeErrorType.InsufficientQuota,
    );
  });

  it('classifies provider 503 overload', () => {
    expect(matchErrorPattern({ message: 'Our servers are currently overloaded' })?.code).toBe(
      AgentRuntimeErrorType.ProviderServiceUnavailable,
    );
  });

  it('classifies an HTTP 413 body as RequestBodyTooLarge', () => {
    expect(matchErrorPattern({ message: '413 Request Entity Too Large' })?.code).toBe(
      AgentRuntimeErrorType.RequestBodyTooLarge,
    );
  });

  it('classifies the observed DeepSeek buffer rejection as RequestBodyTooLarge', () => {
    expect(
      matchErrorPattern({
        message: 'Failed to buffer the request body: length limit exceeded',
      })?.code,
    ).toBe(AgentRuntimeErrorType.RequestBodyTooLarge);
  });

  it('classifies content moderation', () => {
    expect(matchErrorPattern({ message: 'Content Exists Risk' })?.code).toBe(
      AgentRuntimeErrorType.ContentModeration,
    );
  });

  it('classifies router/no-channel failures separately from biz error', () => {
    expect(matchErrorPattern({ message: 'No available keys in pool' })?.code).toBe(
      AgentRuntimeErrorType.NoAvailableChannel,
    );
  });

  it('classifies gemini-bridge proxy bugs as InvalidRequestFormat', () => {
    expect(
      matchErrorPattern({ message: 'For schema with properties, schema type should be OBJECT' })
        ?.code,
    ).toBe(AgentRuntimeErrorType.InvalidRequestFormat);
  });

  it('returns undefined for genuinely unknown errors', () => {
    expect(matchErrorPattern({ message: 'something we have never seen before' })).toBeUndefined();
  });

  it('classifies Drizzle "Failed query:" wraps as DatabasePersistError', () => {
    expect(matchErrorPattern({ message: 'Failed query: rollback params:' })?.code).toBe(
      AgentRuntimeErrorType.DatabasePersistError,
    );
  });

  it('does not let a Failed-query SQL blob trip an unrelated provider pattern', () => {
    // The SQL text embeds parameter values (model names, error_log rows) that
    // contain substrings matching other patterns. DatabasePersistError sits
    // first in the registry, so it must win regardless of the embedded blob.
    const msg =
      'Failed query: insert into "error_logs" ("type") values ($1) -- InsufficientQuota / context length exceeded';
    expect(matchErrorPattern({ message: msg })?.code).toBe(
      AgentRuntimeErrorType.DatabasePersistError,
    );
  });

  it('classifies Redis/Upstash state-store aborts as StateStorePersistError (not provider network)', () => {
    expect(matchErrorPattern({ message: 'Command aborted due to connection close' })?.code).toBe(
      AgentRuntimeErrorType.StateStorePersistError,
    );
    expect(
      matchErrorPattern({ message: 'ERR max request size exceeded. Limit: 10485760 bytes' })?.code,
    ).toBe(AgentRuntimeErrorType.StateStorePersistError);
  });

  it('classifies the Upstash readonly-upgrade write rejection as StateStorePersistError', () => {
    expect(
      matchErrorPattern({
        message: 'READONLY Writes are temporarily rejected due to server upgrade',
      })?.code,
    ).toBe(AgentRuntimeErrorType.StateStorePersistError);
  });

  it('classifies a caller-gone blocking-read abort as StateStoreReadError', () => {
    expect(matchErrorPattern({ message: 'ERR caller gone' })?.code).toBe(
      AgentRuntimeErrorType.StateStoreReadError,
    );
  });

  it('classifies a missing-agent-state read as StateStoreReadError', () => {
    expect(
      matchErrorPattern({
        message: 'Agent state not found for operation op_1781276404066_agt_x_tpc_y_z',
      })?.code,
    ).toBe(AgentRuntimeErrorType.StateStoreReadError);
  });

  it('classifies harness JS runtime crashes as AgentRuntimeError', () => {
    for (const message of [
      'e.trim is not a function',
      "Cannot read properties of undefined (reading '0')",
      'Maximum call stack size exceeded',
      '[object Object]',
    ]) {
      expect(matchErrorPattern({ message })?.code, message).toBe(
        AgentRuntimeErrorType.AgentRuntimeError,
      );
    }
  });

  it('routes context-engine processor crashes to ContextEnginePipelineError', () => {
    expect(
      matchErrorPattern({ message: 'Processor [PlaceholderVariablesProcessor] execution failed' })
        ?.code,
    ).toBe(AgentRuntimeErrorType.ContextEnginePipelineError);
    // …even when the nested cause is a bare TypeError (pipeline wins, not the
    // generic "Cannot read properties" fallback).
    expect(
      matchErrorPattern({
        message:
          "Processor [X] execution failed: Cannot read properties of undefined (reading 'y')",
      })?.code,
    ).toBe(AgentRuntimeErrorType.ContextEnginePipelineError);
  });
});

describe('isUserSideError', () => {
  it('returns true when errorType has a non-failure spec', () => {
    expect(isUserSideError(AgentRuntimeErrorType.InvalidProviderAPIKey)).toBe(true);
    expect(isUserSideError(AgentRuntimeErrorType.RateLimitExceeded)).toBe(true);
    expect(isUserSideError(AgentRuntimeErrorType.ExceededContextWindow)).toBe(true);
  });

  it('resolves the deprecated QuotaLimitReached alias to RateLimitExceeded spec', () => {
    expect(isUserSideError(AgentRuntimeErrorType.QuotaLimitReached)).toBe(true);
  });

  it('returns false for harness-attributed errors', () => {
    expect(isUserSideError(AgentRuntimeErrorType.StreamChunkError)).toBe(false);
    expect(isUserSideError(AgentRuntimeErrorType.OperationInactivityTimeout)).toBe(false);
    expect(isUserSideError(AgentRuntimeErrorType.AgentRuntimeError)).toBe(false);
  });

  it('upgrades a misclassified harness errorType via message pattern', () => {
    // Harness sometimes labels TPM rejections as ExceededContextWindow or 500.
    // The message pattern wins and rescues the classification.
    expect(
      isUserSideError(
        'ExceededContextWindow',
        'Rate limit reached for organization on tokens per minute (TPM)',
      ),
    ).toBe(true);
  });

  it('returns false when neither type nor message matches', () => {
    expect(isUserSideError(undefined, 'random unmatchable upstream error')).toBe(false);
  });

  it('every spec code lookup is symmetric', () => {
    for (const code of Object.keys(ERROR_CODE_SPECS)) {
      expect(ERROR_CODE_SPECS[code as keyof typeof ERROR_CODE_SPECS]?.code).toBe(code);
    }
  });
});

describe('numericId contract', () => {
  const specs = Object.values(ERROR_CODE_SPECS).filter((spec) => spec !== undefined);

  it('every spec has a 4-digit numericId', () => {
    for (const spec of specs) {
      expect(spec.numericId).toBeGreaterThanOrEqual(1000);
      expect(spec.numericId).toBeLessThanOrEqual(9999);
    }
  });

  it('numericIds are globally unique', () => {
    const ids = specs.map((s) => s.numericId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leading digit matches category prefix', () => {
    for (const spec of specs) {
      const expectedPrefix = CATEGORY_NUMERIC_PREFIX[spec.category];
      const actualPrefix = Math.floor(spec.numericId / 1000);
      expect(
        actualPrefix,
        `${spec.code} (category=${spec.category}) has numericId ${spec.numericId} — expected prefix ${expectedPrefix}`,
      ).toBe(expectedPrefix);
    }
  });

  it('spec entries appear in source order sorted by numericId', () => {
    // JS object keys preserve insertion order — this guard prevents future
    // additions from being wedged into the wrong section.
    const ids = specs.map((s) => s.numericId);
    const sortedIds = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sortedIds);
  });

  it('tier digit is 0 (OSS) or the cloud digit', () => {
    for (const spec of specs) {
      const tier = Math.floor(spec.numericId / 100) % 10;
      expect([0, CLOUD_TIER_DIGIT], `${spec.code} numericId ${spec.numericId}`).toContain(tier);
    }
  });

  it('classifies the Cloud-only ChatErrorType codes under the cloud tier', () => {
    for (const code of [
      ChatErrorType.FreePlanLimit,
      ChatErrorType.InsufficientBudgetForModel,
      ChatErrorType.LobeHubModelDeprecated,
    ]) {
      const spec = ERROR_CODE_SPECS[code];
      expect(spec, code).toBeDefined();
      expect(Math.floor(spec!.numericId / 100) % 10, code).toBe(CLOUD_TIER_DIGIT);
    }
  });
});

describe('formatErrorRef / parseErrorRef', () => {
  it('formats known code as Exxxx', () => {
    expect(formatErrorRef(AgentRuntimeErrorType.InvalidProviderAPIKey)).toBe('E1001');
    expect(formatErrorRef(AgentRuntimeErrorType.RateLimitExceeded)).toBe('E3001');
    expect(formatErrorRef(AgentRuntimeErrorType.OperationInactivityTimeout)).toBe('E7002');
  });

  it('resolves the deprecated QuotaLimitReached alias via the spec', () => {
    expect(formatErrorRef(AgentRuntimeErrorType.QuotaLimitReached)).toBe('E3001');
  });

  it('returns undefined for unknown / empty code', () => {
    expect(formatErrorRef(undefined)).toBeUndefined();
    expect(formatErrorRef('NotARealCode')).toBeUndefined();
  });

  it('parseErrorRef inverts formatErrorRef', () => {
    expect(parseErrorRef('E1001')).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
    expect(parseErrorRef('E3001')).toBe(AgentRuntimeErrorType.RateLimitExceeded);
  });

  it('parseErrorRef rejects malformed input', () => {
    expect(parseErrorRef(undefined)).toBeUndefined();
    expect(parseErrorRef('')).toBeUndefined();
    expect(parseErrorRef('1001')).toBeUndefined();
    expect(parseErrorRef('E10')).toBeUndefined();
    expect(parseErrorRef('E99999')).toBeUndefined();
    expect(parseErrorRef('E9999')).toBeUndefined();
  });
});

describe('matchErrorPattern — refines the UpstreamHttpError fallback bucket', () => {
  // Real messages that were landing as the bare-HTTP fallback (a 4xx
  // ProviderBizError whose message matched nothing → codeFromHttpStatus →
  // UpstreamHttpError). Each must now resolve to a precise code.
  const cases: [string, string][] = [
    [
      'Hệ thống đang bận, vui lòng thử lại sau ít phút.',
      AgentRuntimeErrorType.ProviderServiceUnavailable,
    ],
    ['服务器问题调试中', AgentRuntimeErrorType.ProviderServiceUnavailable],
    ['1m 上下文已经全量可用，请启用 1m 上下文后重试', AgentRuntimeErrorType.ExceededContextWindow],
    ["Model 'glm-5.2:cloud' is not allowed on this server.", AgentRuntimeErrorType.ModelNotFound],
    ['User has been banned (request id: 2026...)', AgentRuntimeErrorType.PermissionDenied],
    ['Only Codex clients can use this group', AgentRuntimeErrorType.PermissionDenied],
    [
      "messages.content.type 参数非法，取值范围 ['text']",
      AgentRuntimeErrorType.InvalidRequestFormat,
    ],
    ['参数错误超过100个', AgentRuntimeErrorType.InvalidRequestFormat],
    ['max_tokens must be at least 1, got -1.', AgentRuntimeErrorType.InvalidRequestFormat],
  ];

  it.each(cases)('classifies %j', (message, expected) => {
    expect(
      matchErrorPattern({ errorType: AgentRuntimeErrorType.ProviderBizError, message })?.code,
    ).toBe(expected);
  });
});

describe('matchErrorPattern — second residue convergence round', () => {
  const cases: [string, string][] = [
    ['The provided model identifier is invalid.', AgentRuntimeErrorType.ModelNotFound],
    [
      'Incorrect model ID. Please request to view the model page',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    ['<html><head><title>403 Forbidden</title></head>', AgentRuntimeErrorType.PermissionDenied],
    [
      'Access denied due to Virtual Network/Firewall rules.',
      AgentRuntimeErrorType.PermissionDenied,
    ],
    [
      'This channel does not allow the current client (detected: r9)',
      AgentRuntimeErrorType.PermissionDenied,
    ],
    [
      "However, the model's context length is 200000 tokens.",
      AgentRuntimeErrorType.ExceededContextWindow,
    ],
    [
      'Image inference is not supported on this endpoint. Please use /images/generations',
      AgentRuntimeErrorType.CapabilityNotSupported,
    ],
    ['当前模型不支持SSE调用方式。', AgentRuntimeErrorType.CapabilityNotSupported],
    [
      'This model is unavailable for free. The paid version is available now',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    ['fetch failed', AgentRuntimeErrorType.ProviderNetworkError],
    [
      'Unable to download content from the provided URL before the timeout.',
      AgentRuntimeErrorType.RemoteMediaDownloadTimeout,
    ],
    ['404 page not found', AgentRuntimeErrorType.UserConfigError],
    [
      '{"errors":[{"code":7003,"message":"No route for that URI"}]}',
      AgentRuntimeErrorType.UserConfigError,
    ],
    [
      'invalid params, invalid reasoning.type: "enabled" (allowed: adaptive, disabled)',
      AgentRuntimeErrorType.InvalidRequestFormat,
    ],
    [
      'Error from provider (Moonshot AI): invalid thinking: only type=enabled is allowed',
      AgentRuntimeErrorType.InvalidRequestFormat,
    ],
    [
      'function_declarations[0].parameters.properties[set]',
      AgentRuntimeErrorType.InvalidRequestFormat,
    ],
    ['<!doctype html><meta charset="utf-8">', AgentRuntimeErrorType.UpstreamGatewayError],
  ];

  it.each(cases)('classifies %j', (message, expected) => {
    expect(
      matchErrorPattern({ errorType: AgentRuntimeErrorType.ProviderBizError, message })?.code,
    ).toBe(expected);
  });

  it('does NOT classify a payload-size (413) rejection as ExceededContextWindow', () => {
    // A request-body / 413 size limit is not the same as the model context
    // window — it must stay out of ExceededContextWindow.
    const code = matchErrorPattern({
      errorType: AgentRuntimeErrorType.ProviderBizError,
      message: 'Request body too large for gpt-4o model. Max size: 1000000 tokens.',
    })?.code;
    expect(code).not.toBe(AgentRuntimeErrorType.ExceededContextWindow);
  });
});

describe('matchErrorPattern — gateway user/upstream residues by category', () => {
  const groups: { cases: [string, string, string?][]; name: string }[] = [
    {
      cases: [
        [
          'Your balance is used up. Please top up to continue.',
          AgentRuntimeErrorType.InsufficientQuota,
        ],
        ['have reached your weekly usage limit', AgentRuntimeErrorType.InsufficientQuota],
        ['已达到 Token Plan 用量上限', AgentRuntimeErrorType.InsufficientQuota],
        ['Token Plan usage limit reached', AgentRuntimeErrorType.InsufficientQuota],
        ['The free quota has been exhausted', AgentRuntimeErrorType.InsufficientQuota],
      ],
      name: 'quota and plan limits',
    },
    {
      cases: [
        ['Too many requests', AgentRuntimeErrorType.RateLimitExceeded],
        ['LLM stream error: Console API returned 429', AgentRuntimeErrorType.RateLimitExceeded],
        ['rate limit exceeded: per-user model TPM limit', AgentRuntimeErrorType.RateLimitExceeded],
        ['"quota exceeded"', AgentRuntimeErrorType.RateLimitExceeded],
      ],
      name: 'rate limiting',
    },
    {
      cases: [
        ['no channel available for model', AgentRuntimeErrorType.NoAvailableChannel],
        ['All available accounts exhausted', AgentRuntimeErrorType.NoAvailableChannel],
        ['"code":"NOT_FOUND","msg":"route not found"', AgentRuntimeErrorType.NoAvailableChannel],
        ['Unknown Model, please check the model code', AgentRuntimeErrorType.ModelNotFound],
        ['Requested model is not valid', AgentRuntimeErrorType.ModelNotFound],
        ['invalid params, unknown model', AgentRuntimeErrorType.ModelNotFound],
        ['404 page not found', AgentRuntimeErrorType.UserConfigError],
        ['OpenAIException - {"detail":"Not Found"}', AgentRuntimeErrorType.UserConfigError],
      ],
      name: 'routing, model, and endpoint configuration',
    },
    {
      cases: [
        [
          'Authentication is not set up. Please provide either a project and location',
          AgentRuntimeErrorType.InvalidVertexCredentials,
          'vertexai',
        ],
        ['No active credentials for provider', AgentRuntimeErrorType.InvalidProviderAPIKey],
        ['API key is disabled.', AgentRuntimeErrorType.InvalidProviderAPIKey],
        ['This API key has been suspended.', AgentRuntimeErrorType.InvalidProviderAPIKey],
        ['<h1>403 Forbidden</h1>', AgentRuntimeErrorType.PermissionDenied],
        ['403 | Forbidden', AgentRuntimeErrorType.PermissionDenied],
        ['You have no permission to access this resource', AgentRuntimeErrorType.PermissionDenied],
      ],
      name: 'credentials and access',
    },
    {
      cases: [
        [
          'The model rejected this request. It may not support the input you sent',
          AgentRuntimeErrorType.CapabilityNotSupported,
        ],
        ['sensitive words detected', AgentRuntimeErrorType.ContentModeration],
        ['请勿发送探测请求', AgentRuntimeErrorType.ContentModeration],
      ],
      name: 'capability and moderation',
    },
    {
      cases: [
        ['Request body too large for deepseek-r1 model', AgentRuntimeErrorType.RequestBodyTooLarge],
        [
          'error getting file type: failed to download file from https://example.com/a.png',
          AgentRuntimeErrorType.InvalidRequestFormat,
        ],
        [
          'error getting file type: failed to download file, status code: 404',
          AgentRuntimeErrorType.InvalidRequestFormat,
        ],
        [
          'Unable to download the file. Please verify the URL and try again.',
          AgentRuntimeErrorType.InvalidRequestFormat,
        ],
        [
          'The request is invalid for this endpoint. Check your model name, messages, tools, and parameters.',
          AgentRuntimeErrorType.InvalidRequestFormat,
        ],
        ['422 status code (no body)', AgentRuntimeErrorType.InvalidRequestFormat],
      ],
      name: 'request format and file retrieval',
    },
    {
      cases: [
        ['503 "Service Unavailable"', AgentRuntimeErrorType.ProviderServiceUnavailable],
        ['Hệ thống đang bận', AgentRuntimeErrorType.ProviderServiceUnavailable],
        [
          'Vision is temporarily unavailable. Send text-only requests for now.',
          AgentRuntimeErrorType.ProviderServiceUnavailable,
        ],
      ],
      name: 'service unavailable',
    },
  ];

  for (const { cases, name } of groups) {
    it.each(cases)(`classifies ${name}: %j`, (message, expected, provider) => {
      expect(
        matchErrorPattern({
          errorType: AgentRuntimeErrorType.ProviderBizError,
          message,
          provider,
        })?.code,
      ).toBe(expected);
      expect(isUserSideError(AgentRuntimeErrorType.ProviderBizError, message, provider)).toBe(true);
    });
  }

  it('keeps Vertex setup errors on the Vertex credential code', () => {
    const message =
      'Authentication is not set up. Please provide either a project and location, or an API key, or a custom base URL.';

    expect(
      matchErrorPattern({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message,
      }),
    ).toBeUndefined();
    expect(
      matchErrorPattern({
        errorType: AgentRuntimeErrorType.ProviderBizError,
        message,
        provider: 'vertexai',
      })?.code,
    ).toBe(AgentRuntimeErrorType.InvalidVertexCredentials);
  });
});

describe('2026-09 triage harvest (production residue)', () => {
  // Real messages sampled from `agent_operations` rows that landed in the
  // UpstreamHttpError / bare-500 / bare-403 residue over 30 days. Every pattern
  // here was audited to match zero `provider = 'lobehub'` rows first — first-party
  // provider errors are our own bugs and must stay visible.
  const cases: [string, string][] = [
    ['Sorry, your account balance is insufficient', AgentRuntimeErrorType.InsufficientQuota],
    [
      '403 {"error":{"type":"Aihubmix_api_error","message":"Your account balance is insufficient. Please recharge your account to continue using the API."}}',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'LLM stream error: You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      '404 Model "gpt-5.6-luna" is not supported by any configured account in this group',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    [
      'This model models/gemini-2.5-pro is no longer available to new users. Please update your code to use a newer model.',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    [
      '404 This model is only available through the Batch API. Use the /api/beta/batches endpoint instead.',
      AgentRuntimeErrorType.CapabilityNotSupported,
    ],
    [
      '400 当前模型或商家不支持请求中的能力。 原因：请求使用了当前渠道不支持的能力，例如图片、PDF、tools、response_format、thinking 或特定协议能力。',
      AgentRuntimeErrorType.CapabilityNotSupported,
    ],
    [
      '400 data: {"error":{"code":"data_inspection_failed","param":null,"message":"Input text data may contain inappropriate content."}}',
      AgentRuntimeErrorType.ContentModeration,
    ],
    [
      'LLM stream error: provider temporarily unavailable. Error id: glm-7f67a83c5d74',
      AgentRuntimeErrorType.ProviderServiceUnavailable,
    ],
    [
      'The bound service account is deleted or disabled. The service account bound to the API key is unavailable.',
      AgentRuntimeErrorType.InvalidProviderAPIKey,
    ],
  ];

  it.each(cases)('classifies %j', (message, expected) => {
    expect(matchErrorPattern({ message })?.code).toBe(expected);
    expect(isUserSideError(undefined, message)).toBe(true);
  });

  it('keeps first-party lobehub failures unclassified so they stay visible', () => {
    // The bare `Forbidden` body behind 2.4k lobehub-provider rows must NOT be
    // swept into a user-side code by any pattern added here.
    expect(matchErrorPattern({ message: 'Forbidden', provider: 'lobehub' })).toBeUndefined();
  });
});

describe('2026-09 production residue — second harvest', () => {
  // Every message below is a verbatim upstream error observed in production.
  // None of the patterns they exercise match first-party provider errors.
  const cases: [string, string][] = [
    // ExceededContextWindow
    [
      'Input token count (272370) exceeds system limit (262144) (request id: 021789663165372e56)',
      AgentRuntimeErrorType.ExceededContextWindow,
    ],
    [
      'channel input token limit exceeded: estimated input tokens 141238 > limit 131072 (request id: 2026092210)',
      AgentRuntimeErrorType.ExceededContextWindow,
    ],
    // InsufficientQuota
    [
      'need pre-deduct ＄0.061, balance ＄0.000 is insufficient (request id: 2026092211)',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'The request failed because your account has an overdue balance. Request id: 021789663165',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      "User's credit limit is insufficient, remaining credit limit: ＄0.00 (request id: 2026092212)",
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'hết credit (ví Pay-as-you-go), số dư: 0 (request id: 2026092213)',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      "You've reached your usage limit for this billing cycle. Your quota will be refreshed in the next cycle.",
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'This prompt is longer than the free tier allows for a single request. Shorten it, or add credits to use this model.',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'user [12] quota [3400] preConsumedQuota [51000] is not enough',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      '403 "You have run out of credits or need a Grok subscription. Add credits at https://x.ai or upgrade."',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      "Not enough credit to cover this request's estimated maximum cost. Shorten the request, or top up.",
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'You have reached your specified workspace API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      '403 "Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on the billing page."',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    ['403 "insufficient_gpt_quota"', AgentRuntimeErrorType.InsufficientQuota],
    [
      '订阅额度不足或未配置订阅: subscription quota insufficient, need=1 (request id: 2026092214)',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    [
      'You have insufficient credits to make this request. Please purchase more credits to continue using the service.',
      AgentRuntimeErrorType.InsufficientQuota,
    ],
    ['{"error":"余额不足"}', AgentRuntimeErrorType.InsufficientQuota],
    ['403 No active subscription found for this group', AgentRuntimeErrorType.InsufficientQuota],
    // RateLimitExceeded
    [
      'LLM stream error: ResourceExhausted: Worker local total request limit reached (8/8)',
      AgentRuntimeErrorType.RateLimitExceeded,
    ],
    [
      "429 Rate limit exceeded. Refer to 'x-ratelimit-*' headers for details, and 'retry-after' header for when to retry.",
      AgentRuntimeErrorType.RateLimitExceeded,
    ],
    [
      '您已达到总请求数限制：5分钟内最多请求5次，包括失败次数，请检查您的请求是否正确 (request id: 2026092215)',
      AgentRuntimeErrorType.RateLimitExceeded,
    ],
    // ProviderServiceUnavailable
    [
      'This model is temporarily at capacity. Please try again shortly or use a different model.',
      AgentRuntimeErrorType.ProviderServiceUnavailable,
    ],
    // NoAvailableChannel
    ['{"detail":"暂无可用凭证"}', AgentRuntimeErrorType.NoAvailableChannel],
    [
      'No available Gemini accounts: no available accounts',
      AgentRuntimeErrorType.NoAvailableChannel,
    ],
    // ModelNotFound
    [
      'Publisher model `projects/open-command-1/locations/global/publishers/google/models/gemini-3.1-pro-preview` was not found or your project does not have access to it.',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    [
      'Invalid model. Please select a different model to continue.',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    [
      "Unknown model 'zyloo/claude-sonnet-5'. See zyloo.io/models for the supported list.",
      AgentRuntimeErrorType.ModelNotFound,
    ],
    [
      'The model gemini-2.5-flash-free has been retired and is no longer available. (tid: 2026092216)',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    [
      '{"error":{"message":"Requested model DeepSeek-V4-Flash not supported","type":"invalid_request_error","param":null,"code":null}}',
      AgentRuntimeErrorType.ModelNotFound,
    ],
    // InvalidProviderAPIKey
    [
      'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.',
      AgentRuntimeErrorType.InvalidProviderAPIKey,
    ],
    ['API key 已过期', AgentRuntimeErrorType.InvalidProviderAPIKey],
    // PermissionDenied
    [
      "Permission denied: Consumer 'api_key:AIzaSyXXXX' has been suspended.",
      AgentRuntimeErrorType.PermissionDenied,
    ],
    [
      'Access to model denied. Please make sure you are eligible for using the model.',
      AgentRuntimeErrorType.PermissionDenied,
    ],
    [
      'The latest version of this model is only available hosted in China and requires explicit opt in: https://example.com/docs',
      AgentRuntimeErrorType.PermissionDenied,
    ],
    // CapabilityNotSupported
    [
      'registry.ollama.ai/library/gemma3:4b does not support tools',
      AgentRuntimeErrorType.CapabilityNotSupported,
    ],
    [
      'The requested model does not support the coding plan feature. Please refer to the documentation to select a compatible model.',
      AgentRuntimeErrorType.CapabilityNotSupported,
    ],
    [
      'Reasoning is mandatory for this endpoint and cannot be disabled.',
      AgentRuntimeErrorType.CapabilityNotSupported,
    ],
    // ContentModeration
    [
      'Your prompt or reference material was rejected by content moderation. Please revise it and submit again. (request id: 2026092217)',
      AgentRuntimeErrorType.ContentModeration,
    ],
    // UserConfigError
    [
      'anthropic-workspace-id is required when authenticating with an identity-linked API key; send the id of the workspace.',
      AgentRuntimeErrorType.UserConfigError,
    ],
    [
      'This host has been retired. Point your base URL at https://api.example.com — your API key is unchanged.',
      AgentRuntimeErrorType.UserConfigError,
    ],
    ['404 Replit AI Integrations is not configured', AgentRuntimeErrorType.UserConfigError],
    [
      'The product is not activated, please confirm that you have activated products and try again after activation.',
      AgentRuntimeErrorType.UserConfigError,
    ],
  ];

  it.each(cases)('classifies %j', (message, expected) => {
    expect(
      matchErrorPattern({ errorType: AgentRuntimeErrorType.ProviderBizError, message })?.code,
    ).toBe(expected);
    expect(isUserSideError(AgentRuntimeErrorType.ProviderBizError, message)).toBe(true);
  });

  it('keeps `Requested model` as the model-not-found discriminator', () => {
    // The relay wraps both rejections in the same JSON envelope, so a bare
    // `not supported","type":"invalid_request_error"` substring would also
    // claim parameter rejections and hand the user model-not-found guidance.
    expect(
      matchErrorPattern({
        message:
          '{"error":{"message":"Parameter temperature is not supported","type":"invalid_request_error","param":null,"code":null}}',
      })?.code,
    ).not.toBe(AgentRuntimeErrorType.ModelNotFound);
  });

  it('leaves plain account-suspension messages on AccountDeactivated', () => {
    // The PermissionDenied section is matched before AccountDeactivated, so the
    // consumer-suspension entry must stay scoped to the Google wording.
    for (const message of [
      'Your account has been suspended.',
      '403 Your account has been suspended. Please contact support.',
    ]) {
      expect(matchErrorPattern({ message })?.code).toBe(AgentRuntimeErrorType.AccountDeactivated);
    }
  });

  it('leaves the two first-party-colliding candidates unclassified', () => {
    // Both phrases also reach us from the first-party provider, so they were
    // held back from this round rather than narrowed: keeping our own failures
    // visible outranks classifying a few more upstream rows.
    for (const message of [
      'System protection triggered by request burst. Please slow down traffic growth.',
      'The current model cannot be routed at the moment, please try again later. (tid: 2026092218)',
    ]) {
      expect(matchErrorPattern({ message, provider: 'lobehub' })).toBeUndefined();
    }
  });
});
