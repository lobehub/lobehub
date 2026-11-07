interface ProposalPromptRule {
  instruction: string;
  title: string;
}

const PROPOSAL_SYSTEM = `你是合同审阅助手，负责为「规则清单」起草候选审查规则。你起草的只是草案，必须由用户勾选并确认后才会生效；不要假设它们已经生效，也不要对文档下任何「通过/失败」结论。

只输出 JSON，形如 {"drafts":[...]}。每条草案包含 title、instruction、severity、sourceHint、rationale。

起草规则：
1. 每条规则只检查一件事，必须能对任意一份同类文档独立判定为通过 / 失败 / 无法判断。
2. instruction 必须写明「什么算通过」，可直接说「文档应……」，并尽量写出可在原文中找到的判定要素（条款、期限、触发条件、主体、金额口径）。不得写成「注意……」「关注……」这类无法判定的提醒。
3. title 不超过 80 字，概括被检查的要求，不带编号、不带结论。
4. severity 只能是 high / medium / low：法律后果或付款、验收、责任相关的硬性要求用 high；行业惯例或建议性要求用 medium；锦上添花的用 low。拿不准时用 medium。
5. 不得编造文档中不存在的金额、日期、比例、当事人名称；规则里需要具体数值而文档未提供时，用「约定的」「明确的」等措辞表达要求，不要自己填数。
6. 不要输出与【已有规则】标题或含义重复的规则；同一批草案之间也不要重复。
7. 宁少勿滥：没有值得固定检查的要求时输出 {"drafts":[]}；条数不得超过【数量上限】。

sourceHint 规则：
- 规则来源于文档某处具体条款时，kind='clause'，quote 必须是文档中逐字存在的连续片段（不得改写、拼接、加省略号），clauseLabel 填条款标签（如「第 5 条」）；
- 规则来源于用户描述或一类通用模式、在文档中没有对应原文时，kind='pattern'，不填 quote；
- 无法给出来源时 sourceHint 为 null。

rationale 用一到两句话说明为什么建议固定检查这条要求（例如它约束了付款触发条件或验收标准）。

不要输出 Markdown，不要输出解释性前后缀。`;

const formatExistingRules = (rules: ProposalPromptRule[]): string =>
  JSON.stringify(rules.slice(0, 60).map(({ title, instruction }) => ({ instruction, title })));

export interface FromDocumentPromptParams {
  documentText: string;
  existingRules: ProposalPromptRule[];
  limit: number;
}

export const chainProposalFromDocument = (params: FromDocumentPromptParams): string =>
  `【任务】从下面的文档中提炼值得固定检查的审查规则。

【数量上限】
${params.limit}

【已有规则】（用于去重，可能为空）
${formatExistingRules(params.existingRules)}

【文档内容】
${params.documentText}`;

export interface FromDescriptionPromptParams {
  description: string;
  documentText?: string;
  existingRules: ProposalPromptRule[];
  limit: number;
}

export const chainProposalFromDescription = (params: FromDescriptionPromptParams): string => {
  const reference = params.documentText
    ? `\n\n【参考文档】（用于让规则贴合文档的条款结构与用语）\n${params.documentText}`
    : '';

  return `【任务】把用户的描述转换为可执行的审查规则。只转换描述中提出的要求，不要追加描述之外的规则。

【用户描述】
${params.description}

【数量上限】
${params.limit}

【已有规则】（用于去重，可能为空）
${formatExistingRules(params.existingRules)}${reference}`;
};

export const PROPOSAL_SYSTEM_PROMPT = PROPOSAL_SYSTEM;
