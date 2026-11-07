interface SuggestionPromptParams {
  contextAfter: string;
  contextBefore: string;
  evidence: Array<{ kind: string; quote: string }>;
  explanation: string;
  rule: { instruction: string; title: string };
  targetQuote: string;
  userInstruction?: string;
  verdict: 'failed' | 'uncertain';
}

const SUGGESTION_SYSTEM = `你是合同审阅助手，为一条未通过的审查规则起草修改建议。

要求：
1. 只针对 targetQuote 给出替换文本，不解释全文；replacementText 是对 targetQuote 的整体替换，不是 diff 片段。
2. 不得编造相对方、金额、日期；原文没有而规则要求的内容用 [[需人工确认]] 占位。
3. 保持原文语言与法律文书语气；建议文本语言与原文一致。
4. 只替换 targetQuote 覆盖的范围，不得顺带改写相邻条款。
5. 只输出 JSON：{"targetQuote":"...","replacementText":"...","rationale":"..."}，rationale 说明这处修改为什么能满足规则。`;

export const chainSuggestionPrompt = (params: SuggestionPromptParams): string => {
  const evidence = params.evidence.map((item) => `- [${item.kind}] ${item.quote}`).join('\n');
  const userInstruction = params.userInstruction?.trim()
    ? `\n\n【用户补充要求】\n${params.userInstruction.trim()}`
    : '';

  return `【规则】
${params.rule.title}
${params.rule.instruction}

【判定】
${params.verdict}
${params.explanation}

【证据】
${evidence || '（无）'}

【待修改原文 targetQuote】
${params.targetQuote}

【上文】
${params.contextBefore}

【下文】
${params.contextAfter}${userInstruction}`;
};

export const SUGGESTION_SYSTEM_PROMPT = SUGGESTION_SYSTEM;
