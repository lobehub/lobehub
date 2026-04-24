/**
 * Dev-only preview: run realistic LLM-style markdown through stripMarkdown
 * and print before/after side-by-side for eyeball review.
 *
 * Run: bunx tsx scripts/previewStripMarkdown.ts
 */
import { stripMarkdown } from '../src/server/services/bot/platforms/stripMarkdown';

interface Sample {
  input: string;
  name: string;
}

const samples: Sample[] = [
  {
    input: ['| 待办 |', '|------|', '| 写 PR 描述 |', '| 跑 E2E |', '| 发布 canary |'].join('\n'),
    name: '1 列表格(应渲染为无序列表)',
  },
  {
    input: ['| Name | Age |', '|------|-----|', '| Alice | 30 |', '| Bob | 25 |'].join('\n'),
    name: '2 列表格(窄表,单行记录)',
  },
  {
    input: [
      '| Model | Context | Price |',
      '|-------|---------|-------|',
      '| GPT-5 | 1M | $3/M |',
      '| Claude Opus 4.7 | 1M | $15/M |',
      '| Gemini 2.5 | 2M | $1.25/M |',
    ].join('\n'),
    name: '3 列表格(窄表临界)',
  },
  {
    input: [
      '| 姓名 | 年龄 | 职位 | 城市 |',
      '|------|------|------|------|',
      '| Alice | 30 | 工程师 | 上海 |',
      '| Bob | 25 | 设计师 | 北京 |',
    ].join('\n'),
    name: '4 列表格(宽表,多行记录块)',
  },
  {
    input: [
      '# 📊 今日销售简报',
      '',
      '这是 **Q4 第 3 周** 的关键数据,请重点关注 *华东区*。',
      '',
      '## 核心指标',
      '',
      '| 指标 | 值 | 环比 |',
      '|------|----|----|',
      '| GMV | ¥1.2M | +12% |',
      '| 订单数 | 3,421 | +8% |',
      '| 客单价 | ¥350 | +3% |',
      '',
      '## 待办事项',
      '',
      '1. 跟进 [华东区报告](https://example.com/report-q4w3)',
      '2. 回复 `sales@company.com` 的邮件',
      '3. 准备 ***周会 PPT***',
      '',
      '## 示例代码',
      '',
      '```ts',
      'const revenue = orders.reduce((s, o) => s + o.amount, 0);',
      '// 注意:这里不应被转换 # 或 **',
      '```',
      '',
      '> 提醒:周五下班前提交',
      '',
      '---',
      '',
      '附:~~废弃方案~~已移除。',
    ].join('\n'),
    name: '5 真实 LLM 输出(全要素)',
  },
  {
    input: [
      '支持的功能:',
      '- 文本对话 with `markdown` 渲染',
      '- 图片输入: ![示例](https://img.example.com/x.png)',
      '- 工具调用(见 [文档](https://docs.example.com))',
      '  - 嵌套项 A',
      '  - 嵌套项 B',
      '- **重要**:暂不支持语音',
    ].join('\n'),
    name: '6 列表 + 行内格式 + 图片 + 嵌套',
  },
  {
    input: [
      '变量命名遵循 `snake_case`,例如 `user_id`、`created_at`。',
      '不要与 _italic_ 混淆 —— 后者前后需有空格。',
    ].join('\n'),
    name: '7 下划线边界(snake_case vs italic)',
  },
];

const divider = (char: string, len = 72) => char.repeat(len);

for (const { name, input } of samples) {
  console.log('\n' + divider('='));
  console.log('CASE: ' + name);
  console.log(divider('='));
  console.log('--- INPUT ---');
  console.log(input);
  console.log('--- OUTPUT ---');
  console.log(stripMarkdown(input));
}
console.log('\n' + divider('='));
