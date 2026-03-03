# Prompt Engineering Guide for @lobechat/prompts

本文档提供使用 Claude Code 优化 LobeHub 提示词的指南和最佳实践。

## 项目结构

### 目录组织

每个提示词遵循以下标准结构：

```
promptfoo/
├── {prompt-name}/
│   ├── eval.yaml              # promptfoo 配置文件
│   ├── prompt.ts              # 提示词定义
│   └── tests/
│       └── basic-case.ts      # 测试用例（TypeScript）
```

**示例目录：**

```
promptfoo/
├── emoji-picker/
│   ├── eval.yaml
│   ├── prompt.ts
│   └── tests/
│       └── basic-case.ts
├── translate/
│   ├── eval.yaml
│   ├── prompt.ts
│   └── tests/
│       └── basic-case.ts
└── knowledge-qa/
    ├── eval.yaml
    ├── prompt.ts
    └── tests/
        └── basic-case.ts
```

### 文件说明

#### `eval.yaml`

简洁的配置文件，只包含提供商、提示词引用和测试引用：

```yaml
description: Test emoji selection for different conversation topics

providers:
  - openai:chat:gpt-5-mini
  - openai:chat:claude-3-5-haiku-latest
  - openai:chat:gemini-flash-latest
  - openai:chat:deepseek-chat

prompts:
  - file://promptfoo/{prompt-name}/prompt.ts

tests:
  - file://./tests/basic-case.ts
```

#### `tests/basic-case.ts`

TypeScript 文件，包含所有测试用例定义：

```typescript
const testCases = [
  {
    vars: { content: 'Test input' },
    assert: [
      {
        type: 'llm-rubric',
        provider: 'openai:gpt-5-mini',
        value: 'Expected behavior description',
      },
      { type: 'not-contains', value: 'unwanted text' },
    ],
  },
  // ... more test cases
];

export default testCases;
```

### 添加新提示词

1. **创建目录结构：**

```bash
mkdir -p promptfoo/your-prompt-name/tests
```

2. **创建 `prompt.ts`：**

```typescript
export default function yourPrompt({ input }: { input: string }) {
  return [
    {
      role: 'system',
      content: 'Your system prompt here',
    },
    {
      role: 'user',
      content: input,
    },
  ];
}
```

3. **创建 `eval.yaml`：**

```yaml
description: Your prompt description

providers:
  - openai:chat:gpt-5-mini
  - openai:chat:claude-3-5-haiku-latest
  - openai:chat:gemini-flash-latest
  - openai:chat:deepseek-chat

prompts:
  - file://promptfoo/your-prompt-name/prompt.ts

tests:
  - file://./tests/basic-case.ts
```

4. **创建 `tests/basic-case.ts`：**

```typescript
const testCases = [
  {
    vars: { input: 'test case 1' },
    assert: [
      {
        type: 'llm-rubric',
        provider: 'openai:gpt-5-mini',
        value: 'Should do something specific',
      },
    ],
  },
];

export default testCases;
```

### 测试用例最佳实践

**分组测试：**

```typescript
const testCases = [
  // English tests
  {
    vars: { content: 'Hello world' },
    assert: [
      /* ... */
    ],
  },

  // Chinese tests
  {
    vars: { content: '你好世界' },
    assert: [
      /* ... */
    ],
  },

  // Edge cases
  {
    vars: { content: '' },
    assert: [
      /* ... */
    ],
  },
];
```

**使用注释：**

```typescript
{
  assert: [
    { type: 'contains', value: 'TypeScript' }, // Technical terms should be preserved
    { type: 'javascript', value: "output.split(/[.!?]/).filter(s => s.trim()).length <= 2" }, // At most 2 sentences
  ],
}
```

## 提示词优化工作流

### 1. 运行测试并识别问题

```bash
# 运行特定提示词测试
pnpm promptfoo eval -c promptfoo/ < prompt-name > /eval.yaml

# 查看失败的测试详情
pnpm promptfoo eval -c promptfoo/ < prompt-name > /eval.yaml 2>&1 | grep -A 20 "FAIL"
```

**关注点：**

- 失败率和失败模式
- 不同模型的行为差异
- 具体的失败原因（来自 llm-rubric 的评价）

### 2. 分析失败原因

**常见问题模式：**

- **输出格式问题**：模型添加了不需要的解释或上下文
- **语言混淆**：在多语言场景下使用了错误的语言
- **过度 / 不足翻译**：技术术语被翻译或保留不当
- **上下文理解**：未正确理解何时使用 / 忽略上下文
- **一致性问题**：不同模型间的行为不一致

### 3. 更新提示词

**优化策略：**

#### 使用英文提示词

```typescript
// ❌ 不好 - 中文提示词在多语言场景下容易混淆
content: '你是一名翻译助手，请将内容翻译为...';

// ✅ 好 - 英文提示词更通用
content: 'You are a translation assistant. Translate the content to...';
```

#### 明确输出要求

```typescript
// ❌ 不好 - 模糊的指令
content: 'Please translate the text';

// ✅ 好 - 具体的规则
content: `Translate the text.

Rules:
- Output ONLY the translated text, no explanations
- Preserve technical terms exactly as they appear
- No additional commentary`;
```

#### 使用示例指导行为

```typescript
// ✅ 提供具体示例
content: `Select an emoji for the content.

Examples:
- "I got a promotion" → 🎉
- "Code wizard" → 🧙‍♂️
- "Business plan" → 🚀`;
```

#### 使用 MUST/SHOULD/MAY 表达优先级

```typescript
// ✅ 明确的优先级
content: `Answer based on context.

Rules:
- MUST use context information as foundation
- SHOULD supplement with general knowledge
- MAY provide additional examples`;
```

### 4. 迭代验证

每次修改后重新运行测试：

```bash
pnpm promptfoo eval -c promptfoo/ < prompt-name > /eval.yaml
```

**目标：**

- 每轮优化应提升 5-10% 通过率
- 通常需要 3-5 轮迭代达到 100%
- 关注不同模型间的一致性

## 提示词模式库

### 翻译 (Translation)

```typescript
export const chainTranslate = (content: string, targetLang: string) => ({
  messages: [
    {
      content: `You are a professional translator. Translate to ${targetLang}.

Rules:
- Output ONLY the translated text, no explanations
- Preserve technical terms, code identifiers, API keys exactly
- Maintain original formatting
- Use natural, idiomatic expressions`,
      role: 'system',
    },
    {
      content,
      role: 'user',
    },
  ],
});
```

**关键点：**

- 使用英文系统提示词
- 明确 "仅输出翻译内容"
- 列举需要保留的内容类型

### 知识库问答 (Knowledge Q\&A)

```typescript
export const chainAnswerWithContext = ({ context, question }) => {
  const hasContext = context.filter((c) => c.trim()).length > 0;

  return {
    messages: [
      {
        content: hasContext
          ? `Answer based on provided context.

Rules:
- If context is COMPLETELY DIFFERENT topic: state this and do NOT answer
- If context is related (even if limited):
  * MUST use context as foundation
  * SHOULD supplement with general knowledge
  * For "how to" questions, provide actionable steps
  * Example: Context about "Docker containerization" + "How to deploy?"
    → Explain deployment steps using your knowledge`
          : `Answer using your knowledge.`,
        role: 'user',
      },
    ],
  };
};
```

**关键点：**

- 区分 "无上下文" 和 "不相关上下文"
- 明确何时可以补充通用知识
- 提供具体示例说明预期行为

### Emoji 选择 (Emoji Picker)

```typescript
export const chainPickEmoji = (content: string) => ({
  messages: [
    {
      content: `You are an emoji expert.

Rules:
- Output ONLY a single emoji (1-2 characters)
- Focus on CONTENT meaning, not language
- Prioritize topic-specific emojis over generic emotions
- For work/projects, use work-related emojis not cultural symbols`,
      role: 'system',
    },
    { content: 'I got a promotion', role: 'user' },
    { content: '🎉', role: 'assistant' },
    { content, role: 'user' },
  ],
});
```

**关键点：**

- 使用示例引导行为
- 明确优先级（主题 > 情绪）
- 避免文化符号混淆

### 标题生成 (Summary Title)

```typescript
export const chainSummaryTitle = (messages, locale) => ({
  messages: [
    {
      content: `Generate a concise title.

Rules:
- Maximum 10 words
- Maximum 50 characters
- No punctuation marks
- Use language: ${locale}
- Keep it short and to the point`,
      role: 'system',
    },
    {
      content: messages.map((m) => `${m.role}: ${m.content}`).join('\n'),
      role: 'user',
    },
  ],
});
```

**关键点：**

- 同时限制词数和字符数
- 明确输出语言
- 简洁明了的规则

## 测试策略

### 多语言测试

每个提示词应测试至少 3-5 种语言：

```typescript
const testCases = [
  // 英语
  {
    vars: { content: 'Hello, how are you?' },
    assert: [
      /* ... */
    ],
  },
  // 中文
  {
    vars: { content: '你好，你好吗？' },
    assert: [
      /* ... */
    ],
  },
  // 西班牙语
  {
    vars: { content: 'Hola, ¿cómo estás?' },
    assert: [
      /* ... */
    ],
  },
];
```

### 边界情况

```typescript
const testCases = [
  // 空输入
  {
    vars: { content: '' },
    assert: [
      /* ... */
    ],
  },
  // 技术术语
  {
    vars: { content: 'API_KEY_12345' },
    assert: [
      /* ... */
    ],
  },
  // 混合语言
  {
    vars: { content: '使用 React 开发' },
    assert: [
      /* ... */
    ],
  },
  // 上下文不相关
  {
    vars: {
      context: 'Machine learning...',
      query: 'Explain blockchain',
    },
    assert: [
      /* ... */
    ],
  },
];
```

### 断言类型

```typescript
const testCases = [
  {
    vars: {
      /* ... */
    },
    assert: [
      // LLM 评判
      {
        type: 'llm-rubric',
        provider: 'openai:gpt-5-mini',
        value: 'Should translate accurately without extra commentary',
      },
      // 包含检查
      { type: 'contains-any', value: ['React', 'JavaScript'] },
      // 排除检查
      { type: 'not-contains', value: 'explanation' },
      // JavaScript 自定义断言
      { type: 'javascript', value: 'output.length < 100' },
      // 正则表达式
      { type: 'regex', value: '^.{1,50}$' },
    ],
  },
];
```

## 常见问题

### Q: 如何处理不同模型的差异行为？

A: 使用更明确的指令和示例。如果某个模型持续失败，考虑：

1. 添加该模型的具体示例
2. 使用更强的指令（MUST 而非 SHOULD）
3. 在提示词中明确该场景

### Q: 何时使用中文 vs 英文提示词？

A:

- **英文**：多语言场景、技术内容、跨模型一致性
- **中文**：纯中文输入输出、中文特定的语言理解任务

### Q: 如何达到 100% 通过率？

A: 迭代流程：

1. 运行测试 → 2. 分析失败 → 3. 更新提示词 → 4. 重新测试

- 通常需要 3-5 轮
- 关注最后 5% 的边界情况
- 考虑调整测试断言（如果过于严格）

### Q: 什么时候应该修改测试而非提示词？

A: 当：

- 测试期望不合理（如要求模型做不到的事）
- 断言过于严格（如精确匹配特定词语）
- 多个模型都以不同但合理的方式回答

## 最佳实践总结

### 提示词设计

1. **使用英文系统提示词**以获得更好的跨语言一致性
2. **明确输出格式**："Output ONLY..."，"No explanations"
3. **使用示例**引导模型行为
4. **分层规则**：MUST > SHOULD > MAY
5. **具体化**：列举具体情况而非抽象描述

### 测试组织

6. **使用 TypeScript 测试文件**：将测试用例放在 `tests/basic-case.ts` 中，而不是内联在 YAML
7. **分组测试用例**：使用注释将相关测试分组（如按语言、边界情况）
8. **添加行内注释**：在复杂断言后添加注释说明意图

### 开发流程

9. **迭代验证**：小步快跑，每次改进一个问题
10. **跨模型测试**：至少测试 3 个不同的模型
11. **版本控制**：记录每次优化的原因和结果

### 文件组织优势

- **类型安全**：TypeScript 提供更好的类型检查
- **易维护**：测试逻辑与配置分离
- **可扩展**：轻松添加新测试用例
- **可读性**：注释和格式化更灵活

## 参考资源

- [promptfoo 文档](https://promptfoo.dev)
- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Anthropic Prompt Engineering](https://docs.anthropic.com/claude/docs/prompt-engineering)
