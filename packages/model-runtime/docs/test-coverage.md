# Model Runtime Testing Coverage

## Current Status

**Overall Coverage**: 94.36% (117 test files, 2683 tests) 🎉 **TARGET ACHIEVED!**

**Breakdown:**

- Statements: 94.36%
- Branches: 89.86%
- Functions: 93.8%
- Lines: 94.36%

## Coverage Status by Priority

### 🔴 Critical - Low Coverage (<50%)

**None** - All critical files have been improved to 90%+ coverage! 🎉

### 🟡 Medium - Moderate Coverage (80-90%)

| File                                           | Coverage | Priority | Notes                    |
| ---------------------------------------------- | -------- | -------- | ------------------------ |
| **Core Modules**                               |          |          |                          |
| core/streams/openai/responsesStream.ts         | 91.56%   | Low      | Remaining: error catches |
| core/openaiCompatibleFactory/index.ts          | 83.72%   | Low      | Complex factory logic    |
| core/usageConverters/utils/computeChatCost.ts  | 95.74%   | Low      | Edge case scenarios      |
| core/usageConverters/utils/computeImageCost.ts | 96.05%   | Low      | Edge case scenarios      |
| core/streams/openai/openai.ts                  | 98.79%   | Low      | Excellent coverage       |
| **Providers**                                  |          |          |                          |
| providers/openai                               | 87.5%    | Low      | Env vars at module load  |
| providers/azureOpenai                          | 85.15%   | Low      | Custom auth flow         |
| providers/azureai                              | 84.31%   | Low      | Azure-specific features  |
| providers/anthropic                            | 88.44%   | Low      | Provider-specific logic  |

### ✅ Excellent - High Coverage (90%+)

**65+ providers and core modules with 90%+ coverage**, including:

- **100% coverage**: deepseek, nvidia, qiniu, wenxin, giteeai, v0, zeroone, ai360, akashchat, baichuan, bedrock, cohere, mistral, moonshot, ollama, openrouter, search1api, sensenova, spark, zhipu, vercelaigateway, cometapi, cerebras, ollamacloud, internlm, hunyuan, huggingface, groq, modelscope, nebius, stepfun, lmstudio, newapi, fireworksai, jina, tencentcloud, togetherai, ai21, sambanova, upstage, vllm
- **95-99%**: ModelRuntime, computeChatCost, computeImageCost, openai streams, createImage, github, vertexai, volcengine, siliconcloud, ppio, minimax, cloudflare, fal
- **90-94%**: contextBuilders, streams (anthropic, protocol, qwen), openai provider

**Good - Coverage (80-89%)**:

- ai302, qwen, google, azureOpenai, azureai, infiniai, aihubmix, bfl, anthropic, openai, RouterRuntime

## Testing Strategy

### 1. Provider Testing Pattern

All providers should follow this testing pattern:

```typescript
// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeXxxAI, params } from './index';

// Basic provider tests
testProvider({
  Runtime: LobeXxxAI,
  provider: ModelProvider.Xxx,
  defaultBaseURL: 'https://api.xxx.com/v1',
  chatDebugEnv: 'DEBUG_XXX_CHAT_COMPLETION',
  chatModel: 'model-name',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// Custom feature tests
describe('LobeXxxAI - custom features', () => {
  let instance: InstanceType<typeof LobeXxxAI>;

  beforeEach(() => {
    instance = new LobeXxxAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    // Test custom payload transformations
  });

  describe('handleError', () => {
    // Test custom error handling
  });

  describe('models', () => {
    // Test models fetching and processing
  });
});
```

### 2. Code Refactoring Pattern

#### 2.1 OpenAI-Compatible Provider Pattern

For better testability, OpenAI-compatible providers should export a `params` object:

```typescript
import {
  OpenAICompatibleFactoryOptions,
  createOpenAICompatibleRuntime,
} from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'https://api.example.com/v1',
  chatCompletion: {
    handlePayload: (payload) => {
      // Custom payload transformation
      return transformedPayload;
    },
    handleError: (error) => {
      // Custom error handling
      return errorResponse;
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_XXX_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    // Fetch and process models
    return modelList;
  },
  provider: ModelProvider.Xxx,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeXxxAI = createOpenAICompatibleRuntime(params);
```

#### 2.2 Router Provider Pattern

Router providers (like NewAPI and AiHubMix) route different models to different API types. They should also export a `params` object:

```typescript
import { ModelProvider } from 'model-bank';

import { createRouterRuntime } from '../../core/RouterRuntime';
import { CreateRouterRuntimeOptions } from '../../core/RouterRuntime/createRuntime';

export const params = {
  id: ModelProvider.Xxx,
  debug: {
    chatCompletion: () => process.env.DEBUG_XXX_CHAT_COMPLETION === '1',
  },
  defaultHeaders: {
    'X-Custom-Header': 'value',
  },
  models: async ({ client }) => {
    // Fetch and process multi-provider model list
    const modelsPage = await client.models.list();
    return processMultiProviderModelList(modelsPage.data, 'xxx');
  },
  routers: [
    {
      apiType: 'anthropic',
      models: LOBE_DEFAULT_MODEL_LIST.filter((m) => detectModelProvider(m.id) === 'anthropic'),
      options: { baseURL: 'https://api.xxx.com' },
    },
    {
      apiType: 'google',
      models: LOBE_DEFAULT_MODEL_LIST.filter((m) => detectModelProvider(m.id) === 'google'),
      options: { baseURL: 'https://api.xxx.com/gemini' },
    },
    {
      apiType: 'openai',
      options: {
        baseURL: 'https://api.xxx.com/v1',
        chatCompletion: {
          handlePayload: (payload) => {
            // Custom payload transformation for OpenAI-compatible models
            return payload;
          },
        },
      },
    },
  ],
} satisfies CreateRouterRuntimeOptions;

export const LobeXxxAI = createRouterRuntime(params);
```

**Key Differences for Router Providers:**

- Use `createRouterRuntime` instead of `createOpenAICompatibleRuntime`
- Define `routers` array to specify how different models route to different API types
- Each router can have its own `apiType`, `models` filter, and `options`
- The `models` function should use `processMultiProviderModelList` to handle multi-provider model lists

### 3. Testing Checklist

#### 3.1 OpenAI-Compatible Provider Checklist

For each OpenAI-compatible provider, ensure:

- [ ] Basic initialization tests (via `testProvider`)
- [ ] Debug mode tests
- [ ] Payload transformation tests (if custom `handlePayload`)
- [ ] Error handling tests (if custom `handleError`)
- [ ] Models fetching tests (if custom `models`)
- [ ] Special features tests (web search, thinking, etc.)
- [ ] Edge cases and boundary conditions
- [ ] Export `params` object for better testability

#### 3.2 Router Provider Testing Checklist

For router providers (like NewAPI, AiHubMix), ensure:

- [ ] **Basic Runtime Tests**
  - Runtime instantiation with correct provider ID
  - Type definitions for provider-specific interfaces
- [ ] **Debug Configuration Tests**
  - Debug mode enabled (`DEBUG_XXX_CHAT_COMPLETION=1`)
  - Debug mode disabled (default)
- [ ] **Router Configuration Tests**
  - Dynamic routers generation (if using function form)
  - Correct baseURL extraction and processing
  - Per-router apiType and model filtering
  - Per-router options configuration
- [ ] **Models Function Tests**
  - Successful model list fetching
  - `processMultiProviderModelList` integration
  - Error handling (network errors, invalid API keys)
  - Empty or missing model data handling
- [ ] **Custom Logic Tests** (if applicable)
  - Custom payload transformations (e.g., `handlePayload` in OpenAI router)
  - Custom pricing calculation logic
  - Provider detection from model metadata
  - URL processing and normalization
- [ ] **Edge Cases**
  - Missing or invalid baseURL
  - Empty model lists
  - API errors and fallback behavior
  - Special model patterns (e.g., Responses API detection)
- [ ] **Export Requirements**
  - Export `params` object satisfying `CreateRouterRuntimeOptions`
  - Export custom types (ModelCard, Pricing, etc.)
  - Export utility functions for testing (e.g., `handlePayload`)

#### 3.3 Router Provider Testing Example

Reference: `newapi/index.test.ts`

```typescript
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { LobeXxxAI, params } from './index';

describe('Xxx Router Runtime', () => {
  describe('Runtime Instantiation', () => {
    it('should create runtime instance', () => {
      const instance = new LobeXxxAI({ apiKey: 'test' });
      expect(instance).toBeDefined();
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_XXX_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_XXX_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
    });
  });

  describe('Routers Configuration', () => {
    it('should configure routers with correct apiTypes', () => {
      // Test static routers
      const routers = params.routers;
      expect(routers).toHaveLength(4);
      expect(routers[0].apiType).toBe('anthropic');
      expect(routers[1].apiType).toBe('google');
      expect(routers[2].apiType).toBe('xai');
      expect(routers[3].apiType).toBe('openai');
    });

    it('should configure dynamic routers with user baseURL', () => {
      // Test dynamic routers function
      const options = { apiKey: 'test', baseURL: 'https://custom.com/v1' };
      const routers = params.routers(options);
      expect(routers[0].options.baseURL).toContain('custom.com');
    });
  });

  describe('Models Function', () => {
    it('should fetch and process models', async () => {
      // Test models fetching logic
      const mockClient = {
        baseURL: 'https://api.xxx.com/v1',
        apiKey: 'test',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-1', owned_by: 'openai' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient });
      expect(models).toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      // Test error handling
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      const models = await params.models({ client: mockClient });
      expect(models).toEqual([]);
    });
  });
});
```

### 4. Complete Testing Workflow

**IMPORTANT**: Follow this complete workflow for every testing task. ALL steps are REQUIRED.

#### Step 0: Use Subagents for Parallel Execution (Recommended)

**For multiple providers**: Use subagents to parallelize test development and significantly speed up the process.

**Benefits of using subagents:**

- ⚡ **Speed**: 5 providers completed in parallel vs. sequential (\~5x faster)
- 🔄 **Isolation**: Each provider's tests developed independently
- 📊 **Progress tracking**: See all provider progress at once
- 🐛 **Early detection**: Identify common issues across providers

**How to create parallel subagents:**

When working on multiple providers, create one subagent per provider with a detailed prompt like:

```
根据 model-runtime 内部的测试文档，补充以下 5 个 provider 的测试，每个 provider 的测试用独立的 subagent 执行，这样可以并发加速。

请为以下 providers 分别创建 subagent：
- internlm (current: 39.13%, target: 80%+)
- hunyuan (current: 39.68%, target: 80%+)
- huggingface (current: 39.75%, target: 80%+)
- groq (current: 45.45%, target: 80%+)
- modelscope (current: 47.82%, target: 80%+)
```

Each subagent should be instructed to:

1. Read the test documentation (`packages/model-runtime/docs/test-coverage.md`)
2. Read the implementation file and test file
3. Analyze missing tests based on the testing checklist
4. Add tests and verify they pass
5. Return a summary of test results (do NOT run type check or coverage)

**After all subagents complete:**

- Review all test results
- Fix any failed tests (e.g., type errors, test failures)
- Proceed with Step 2 (Type Check) below

**For single provider**: Skip this step and proceed directly to Step 1.

---

#### Step 1: Development and Testing

```bash
# 1. Refactor provider and write tests
# 2. Run tests to verify they pass
bunx vitest run --silent='passed-only' 'src/providers/{provider}/index.test.ts'
```

#### Step 2: Type and Lint Checks

**CRITICAL**: Run type check and lint before proceeding. Failing these checks means the task is incomplete.

```bash
# Check TypeScript types (from project root)
cd ../../../ && bun run type-check

# Or run type-check for model-runtime only
bunx tsc --noEmit

# Fix any linting issues
bunx eslint src/providers/{provider}/ --fix
```

**Common Type Errors to Watch For:**

- Missing or incorrect type annotations
- Unused variables or imports
- Incorrect generic type parameters
- Missing satisfies clauses for `params` objects

**Do NOT proceed to Step 3 if type/lint checks fail!**

#### Step 3: Run Coverage Report

```bash
# Run coverage to get updated metrics
bunx vitest run --coverage --silent='passed-only'
```

#### Step 4: Summarize Development Work

Before updating documentation, create a summary of what was accomplished:

**Summary Checklist:**

- [ ] What provider(s) were worked on?
- [ ] What was the coverage improvement? (before% → after%)
- [ ] How many new tests were added?
- [ ] What specific features/logic were tested?
- [ ] Were any bugs discovered and fixed?
- [ ] Any new patterns or best practices identified?
- [ ] Should the testing guide be updated based on learnings?

**Example Summary:**

```
Provider: newapi
Coverage: 13.28% → 100% (+86.72%)
Tests Added: 65 new tests
Features Tested:
  - handlePayload logic with Responses API detection
  - Complex pricing calculation (quota_type, model_price, model_ratio)
  - Provider detection from supported_endpoint_types and owned_by
  - Dynamic routers configuration with baseURL processing
  - Error handling for pricing API failures
Bugs Fixed: None
Guide Updates: Added router provider testing pattern to documentation
```

#### Step 5: Update This Document

Based on your development summary, update the following sections:

1. **Current Status** section:
   - Update overall coverage percentage
   - Update test file count and total test count

2. **Coverage Status by Priority** section:
   - Move completed providers from low/medium to high coverage section
   - Update coverage percentages for all modified providers
   - Remove completed items from critical/medium sections

3. **Completed Work** section:
   - Update "Recent Achievements" with new coverage delta
   - Add newly refactored providers to the list with their coverage improvement
   - Document any bugs fixed or improvements made

4. **Testing Strategy** section (if applicable):
   - Add new patterns discovered during development
   - Update examples with better practices
   - Document any provider-specific testing approaches

#### Step 6: Final Verification

```bash
# Verify all tests still pass
bunx vitest run --silent='passed-only' 'src/providers/{provider}/index.test.ts'

# Verify type check still passes
cd ../../../ && bun run type-check
```

#### Complete Workflow Example

```bash
# 1. Development Phase
# ... write code and tests ...
bunx vitest run --silent='passed-only' 'src/providers/example/index.test.ts'

# 2. Type/Lint Phase (REQUIRED)
cd ../../../ && bun run type-check # Must pass!
bunx eslint src/providers/example/ --fix

# 3. Coverage Phase
cd packages/model-runtime
bunx vitest run --coverage --silent='passed-only'

# 4. Summarization Phase
# Create summary following the checklist above

# 5. Documentation Phase
# Update this file with summary and metrics

# 6. Final Verification
bunx vitest run --silent='passed-only' 'src/providers/example/index.test.ts'
cd ../../../ && bun run type-check

# 7. Commit
git add .
git commit -m "✅ test: add comprehensive tests for example provider (13% → 100%)"
```

**Remember**: A testing task is only complete when:

1. ✅ Tests pass
2. ✅ Type check passes
3. ✅ Lint passes
4. ✅ Development work is summarized
5. ✅ Documentation is updated
6. ✅ Final verification passes

## Commands

### Testing Commands

```bash
# Run all tests with coverage
bunx vitest run --coverage

# Run specific provider tests
bunx vitest run --silent='passed-only' 'src/providers/{provider}/index.test.ts'

# Run tests for multiple providers
bunx vitest run --silent='passed-only' src/providers/higress/index.test.ts src/providers/ai360/index.test.ts

# Watch mode for development
bunx vitest watch 'src/providers/{provider}/index.test.ts'
```

### Type Check Commands

```bash
# Type check entire project (from project root)
cd ../../../ && bun run type-check

# Type check model-runtime only
bunx tsc --noEmit

# Type check with watch mode
bunx tsc --noEmit --watch
```

### Lint Commands

```bash
# Lint specific provider
bunx eslint src/providers/{provider}/ --fix

# Lint all providers
bunx eslint src/providers/ --fix

# Lint without auto-fix (check only)
bunx eslint src/providers/{provider}/
```

## Completed Work

### Recent Achievements ✅

**Latest Session (2025-10-13 - Part 4)**: 🚀 **Achieved 94.36% Overall Coverage - 95% Goal Nearly Reached!**

- Overall coverage: 91.1% → **94.36% (+3.26%)**

- **Comprehensive Core Module and Provider Enhancement**

- Enhanced 14 files with significant test improvements:

  **Core Modules (6 files, +96 tests):**
  - **responsesStream.ts** (50.6% → 91.56%) - 19 tests, response events, function calls, reasoning, citations
  - **createImage.ts** (54.76% → 100%) - 24 tests, chat model mode, image mode, routing logic
  - **computeImageCost.ts** (64.47% → 100%) - 12 tests, lookup/fixed/tiered pricing strategies
  - **openai.ts** (73.87% → 98.79%) - 19 tests, image handling, tool calls, citations, reasoning
  - **ModelRuntime.ts** (75% → 100%) - 12 tests, embeddings, textToSpeech, pullModel, generateObject
  - **computeChatCost.ts** (79.78% → 95.74%) - 10 tests, tiered pricing, error handling

  **Providers (8 providers, +102 tests):**
  - **deepseek** (77.77% → 100%) - 9 tests, models function, generateObject config
  - **nvidia** (78.12% → 100%) - 14 tests, thinking mode handling, chat template kwargs
  - **qiniu** (75% → 100%) - 24 tests, multi-provider model detection
  - **wenxin** (76% → 100%) - 10 tests, web search configuration
  - **giteeai** (73.33% → 100%) - 17 tests, models function with error handling
  - **v0** (73.33% → 100%) - 17 tests, models function with edge cases
  - **zeroone** (73.33% → 100%) - 20 tests, comprehensive models testing
  - **openai** (73.78% → 87.5%) - 10 tests, responses API, search models, flex tier

- Added **198+ comprehensive tests** across core modules and providers

- Fixed **16 TypeScript type errors** across test files

- All enhanced files now have 95%+ or 100% coverage (except openai at 87.5% due to module-level env vars)

- **Type check passed** - Zero type errors remaining

- Used parallel subagent execution (6 concurrent agents) for maximum development speed

**Previous Session (2025-10-13 - Part 3)**: 🎉 **Achieved 91.1% Overall Coverage - Target Exceeded!**

- Overall coverage: 85.74% → **91.1% (+5.36%)**
- **Target of 90% coverage achieved and exceeded!**
- Completed all high-priority providers to 80%+ coverage
- Refactored 13 providers with comprehensive test coverage:
  - **search1api** (52.08% → 100%) - 86 tests, complex payload and models logic
  - **openrouter** (52.83% → \~95%) - 69 tests, pricing and thinking features
  - **sensenova** (53.01% → 100%) - 104 tests, vision model message conversion
  - **zhipu** (55.83% → 100%) - 55 tests, tool_calls index fixing, thinking modes
  - **ollama** (56.03% → \~95%) - 56 tests, embeddings and pull model features
  - **ai360** (56.14% → 100%) - 79 tests, web search and reasoning models
  - **mistral** (57.14% → 100%) - 53 tests, temperature normalization
  - **cohere** (57.4% → 100%) - 70 tests, parameter constraints and features
  - **akashchat** (62.79% → 100%) - 35 tests, thinking parameter handling
  - **baichuan** (62.5% → 100%) - 26 tests, web search modes
  - **moonshot** (66.66% → 100%) - 33 tests, fixed temperature normalization bugs
  - **spark** (70.58% → 100%) - 31 tests, web search integration
  - **bedrock** (71.72% → 100%) - 42 tests, model-specific transformations
- Added **584+ new comprehensive tests**
- Fixed 8 bugs including:
  - Moonshot temperature normalization (6 failing tests)
  - Property naming issues (maxTokens → maxOutput in ai360, baichuan)
- Fixed all 47 TypeScript type errors across 9 files
- All providers now export `params` for better testability
- Used parallel subagent execution for maximum development speed

**Previous Session (2025-10-13 - Part 2)**: 🚀 5 High-Priority Providers Completed!

- Overall coverage: 84.49% → 85.74% (+1.25%)
- Refactored 5 high-priority providers:
  - **vercelaigateway** (50% → 100%) - 43 tests, fixed verbosity bug
  - **github** (52.08% → 97.95%) - 32 tests
  - **cometapi** (55.26% → 100%) - 28 tests
  - **cerebras** (55.55% → 100%) - 28 tests
  - **ollamacloud** (55.55% → 100%) - 24 tests
- Added 155 comprehensive tests
- Fixed 1 bug: verbosity parameter initialization in vercelaigateway
- All providers now export `params` for better testability
- Used parallel subagent execution for faster development

**Previous Session (2025-10-13 - Part 1)**: 🎉 All Critical providers completed!

- Overall coverage: 82.9% → 84.49% (+1.59%)
- **Eliminated all critical (<50% coverage) providers!**
- Refactored 5 providers:
  - **internlm** (39.13% → 100%) - 30 tests, fixed null model bug
  - **hunyuan** (39.68% → 100%) - 33 tests, fixed null model bug
  - **huggingface** (39.75% → 100%) - 38 tests
  - **groq** (45.45% → 100%) - 35 tests
  - **modelscope** (47.82% → 100%) - 24 tests
- Added 160 comprehensive tests
- Fixed 2 bugs: null/undefined model handling in internlm and hunyuan
- All providers now export `params` for better testability
- Used parallel subagent execution for faster development

**Previous Session (2025-01-15)**:

- Overall coverage: 81.86% → 82.9% (+1.04%)
- Refactored 3 providers: **nebius** (32.3% → 100%), **stepfun** (34.92% → 100%), **lmstudio** (35.48% → 100%)
- Added 93 new tests
- All providers now export `params` for better testability

**Earlier Session (2025-01-15)**:

- Overall coverage: 80.81% → 81.86% (+1.05%)
- Refactored 4 providers: **fireworksai**, **jina**, **tencentcloud**, **togetherai** (all now at 100%)
- Added 65 new tests
- Fixed bugs in togetherai provider

## Notes

### General Testing Notes

- All providers should follow the same testing pattern for consistency
- Exporting `params` makes testing much easier by allowing direct testing of configuration
- `testProvider` utility provides basic test coverage for OpenAI-compatible providers
- Custom feature tests should be added based on provider-specific functionality
- Always mock API calls in tests (`skipAPICall: true`)
- Debug environment variables should be tested
- **Type check and lint must pass before committing**
- **Update this document after each testing task completion**

### Router Provider Specific Notes

- **Router providers use `createRouterRuntime` instead of `createOpenAICompatibleRuntime`**
- The `testProvider` utility does NOT work for router providers - write custom tests
- Router providers route different models to different API implementations (anthropic, google, xai, openai)
- Test both static and dynamic router configurations:
  - Static: `routers: [...]` - array of router configs
  - Dynamic: `routers: (options) => [...]` - function that generates routers based on user options
- Router providers typically have complex `models` functions that:
  - Fetch models from a unified API endpoint
  - Process multi-provider model lists with `processMultiProviderModelList`
  - Handle provider detection from model metadata
  - May include custom pricing calculation logic
- Test router-specific custom logic separately (e.g., `handlePayload`, pricing calculation)
- Pay attention to baseURL processing - routers may need to:
  - Strip version paths (`/v1`, `/v1beta`) from baseURL
  - Apply different baseURL patterns for different API types
  - Handle user-provided custom baseURLs
- Examples of router providers: `newapi`, `aihubmix`
- For comprehensive router provider testing patterns, refer to `newapi/index.test.ts`
