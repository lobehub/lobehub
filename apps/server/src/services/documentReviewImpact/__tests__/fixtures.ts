/**
 * 中文采购合同 fixture，对应设计文档里的场景：把「最终验收」改成「分阶段验收」。
 *
 * 付款、质保起算和终止时的交付义务都还写着「最终验收」，它们本身没有被编辑，
 * 但含义被这次修改改变了——正是语义影响（semantic）要覆盖的部分。
 */

const CONTRACT_HEAD = `技术服务采购合同

第 1 条 定义
“最终验收”指甲方在全部交付物提交后一次性进行的验收。

第 2 条 交付
`;

const CONTRACT_TAIL = `
第 3 条 付款
甲方在最终验收合格后 10 个工作日内支付合同价款的 90%，剩余 10% 作为质保金。

第 4 条 质量保证
质保期自最终验收合格之日起 12 个月。

第 5 条 合同终止
合同终止时，双方应就已完成的交付物进行最终验收，乙方应在最终验收合格后 10 个工作日内交付全部工作成果及资料。
`;

export const BASELINE_ACCEPTANCE = '乙方应完成全部交付物，并经甲方最终验收合格。';
export const CURRENT_ACCEPTANCE = '乙方应按附件一约定的阶段完成交付物，并经甲方分阶段验收合格。';

export const BASELINE_CONTRACT = `${CONTRACT_HEAD}${BASELINE_ACCEPTANCE}\n${CONTRACT_TAIL}`;
export const CURRENT_CONTRACT = `${CONTRACT_HEAD}${CURRENT_ACCEPTANCE}\n${CONTRACT_TAIL}`;

/** Minimal Lexical document used as the saved `editorData` for both versions. */
export const editorDataFromText = (text: string): Record<string, any> => ({
  root: {
    children: text.split('\n').map((line) => ({
      children: line ? [{ text: line, type: 'text' }] : [],
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    })),
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
});

/** A plausible model answer for {@link BASELINE_CONTRACT} → {@link CURRENT_CONTRACT}. */
export const MOCK_IMPACT_RESPONSE = {
  items: [
    {
      category: 'textual',
      confidence: 0.97,
      kind: 'related_clause',
      reason: '验收方式由一次性最终验收改为按附件一的分阶段验收，条款文字本身已改变。',
      severity: 'high',
      sourceLabel: '第 2 条 交付',
      sourceQuote: '并经甲方分阶段验收合格',
      title: '验收条款修改',
      trigger: '「并经甲方最终验收合格」改为「并经甲方分阶段验收合格」',
    },
    {
      category: 'semantic',
      confidence: 0.94,
      kind: 'obligation',
      reason:
        '付款仍以「最终验收合格」为触发条件，但合同已不再约定最终验收，付款节点失去确定触发点。',
      relatedLabel: '第 3 条 付款',
      relatedQuote: '甲方在最终验收合格后 10 个工作日内支付合同价款的 90%',
      severity: 'high',
      sourceLabel: '第 2 条 交付',
      sourceQuote: '分阶段验收',
      title: '付款触发条件',
      trigger: '「最终验收」改为「分阶段验收」',
    },
    {
      category: 'semantic',
      confidence: 0.92,
      kind: 'obligation',
      reason:
        '质保期仍自「最终验收合格之日」起算，分阶段验收后该起算点不再存在，需要明确以哪一阶段为准。',
      relatedLabel: '第 4 条 质量保证',
      relatedQuote: '质保期自最终验收合格之日起 12 个月',
      severity: 'high',
      sourceLabel: '第 2 条 交付',
      sourceQuote: '分阶段验收',
      title: '质保起算时间',
      trigger: '「最终验收」改为「分阶段验收」',
    },
    {
      category: 'semantic',
      confidence: 0.88,
      kind: 'obligation',
      reason:
        '终止时的交付义务以「最终验收合格后 10 个工作日」为期限，验收改为分阶段后该期限无法计算。',
      relatedLabel: '第 5 条 合同终止',
      relatedQuote: '乙方应在最终验收合格后 10 个工作日内交付全部工作成果及资料',
      severity: 'medium',
      sourceLabel: '第 2 条 交付',
      sourceQuote: '分阶段验收',
      title: '终止时交付义务',
      trigger: '「最终验收」改为「分阶段验收」',
    },
    {
      category: 'semantic',
      confidence: 0.81,
      kind: 'definition',
      reason: '定义条款仍然只定义「最终验收」为一次性验收，与新的分阶段验收方式不一致。',
      relatedLabel: '第 1 条 定义',
      relatedQuote: '“最终验收”指甲方在全部交付物提交后一次性进行的验收',
      severity: 'medium',
      sourceLabel: '第 2 条 交付',
      sourceQuote: '分阶段验收',
      title: '「最终验收」定义',
      trigger: '「最终验收」改为「分阶段验收」',
    },
    {
      // Deliberately ungrounded: the passage does not exist in the document.
      category: 'semantic',
      confidence: 0.52,
      kind: 'reference',
      reason: '附件二可能引用了最终验收条款，需要人工核对。',
      relatedLabel: '附件二',
      relatedQuote: '附件二第三条约定最终验收的组织方式',
      severity: 'low',
      sourceLabel: '第 2 条 交付',
      sourceQuote: '分阶段验收',
      title: '附件二交叉引用',
      trigger: '「最终验收」改为「分阶段验收」',
    },
  ],
};
