interface PromptRule {
  instruction: string;
  ruleId: string;
  severity: string;
  title: string;
}

const CHECK_SYSTEM = `你是合同审阅助手，按给定规则逐条检查文档。

对每条规则给出 passed / failed / uncertain：
- passed：文档明确满足该规则。
- failed：文档明确违反或缺少该规则要求的文字。必须在 evidence 中指出具体缺失或违反的原文。
- uncertain：无法从文档判断（证据不足、表述多义、缺少必要附件）。不要为了给出结论而猜。

证据规则：
1. quote 必须是文档中逐字存在的连续片段。
2. failed 至少给一条 kind='violating' 的 evidence；给不出就输出 uncertain。
3. passed 必须至少给一条 kind='supporting' 的 evidence，引文要能证明规则被满足；给不出就输出 uncertain。
4. 一次检查多条规则时，逐条独立判断，不要因为其他规则通过就推断本条通过。

只输出 JSON，形如 {"results":[{"ruleId":"...","verdict":"passed|failed|uncertain","confidence":0-1,"explanation":"...","evidence":[{"kind":"supporting|violating|context","quote":"...","clauseLabel":"..."}],"uncertainReason":"insufficient_evidence|ambiguous_wording|missing_attachment"}]}。`;

export interface CheckPromptParams {
  documentText: string;
  rules: PromptRule[];
  userContext?: string;
}

export const chainCheckPrompt = (params: CheckPromptParams): string => {
  const userContext = params.userContext?.trim()
    ? `\n\n【补充说明】（用户提供）\n${params.userContext.trim()}`
    : '';

  return `【规则】
${JSON.stringify(params.rules)}

【文档】
${params.documentText}${userContext}`;
};

export const CHECK_SYSTEM_PROMPT = CHECK_SYSTEM;
