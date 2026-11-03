import { marketApiService } from '@/services/marketApi';
import type { DiscoverSkillItem } from '@/types/discover';
import { SkillSorts } from '@/types/discover';

const MAX_QUERY_COUNT = 3;
const MAX_RESULT_COUNT = 3;

const QUERY_RULES: Array<{ pattern: RegExp; query: string }> = [
  { pattern: /简历|履历|resume|cv/i, query: 'resume review' },
  {
    pattern: /代码审查|code\s*review|pull\s*request|pr\s*review|review.*code/i,
    query: 'code review',
  },
  {
    pattern: /prd|产品需求|需求文档|产品经理|product\s*(requirement|manager)/i,
    query: 'product requirements',
  },
  { pattern: /调研|研究|资料收集|research/i, query: 'research' },
  { pattern: /旅行|旅游|行程|travel|trip/i, query: 'travel planning' },
  { pattern: /翻译|translate|translation/i, query: 'translation' },
  { pattern: /写作|文案|文章|公众号|copywriting|writing/i, query: 'writing' },
  { pattern: /会议|纪要|meeting|minutes/i, query: 'meeting notes' },
  { pattern: /邮件|email|mail/i, query: 'email writing' },
  { pattern: /数据|表格|excel|csv|analysis|analytics/i, query: 'data analysis' },
  { pattern: /ui|ux|前端|界面|设计|frontend|design/i, query: 'frontend design' },
  { pattern: /代码|编程|开发|debug|bug|programming|coding/i, query: 'coding' },
  { pattern: /健康|健身|health|fitness/i, query: 'health' },
];

const SKILL_INTENT_PATTERNS: RegExp[] = [
  /方法|流程|工作流|模板|检查清单|核对表|评分表|规则|规范|步骤|SOP|转换器|生成器|格式化|提取器|分类器|校验器|自动化|批量|复用|可复用/i,
  /\b(method|workflow|process|template|checklist|rubric|framework|playbook|sop|converter|generator|formatter|extractor|classifier|validator|automation|batch|reusable)\b/i,
];

const AGENT_INTENT_PATTERNS: RegExp[] = [
  /长期|持续|跨会话|记住|记忆|偏好|陪伴|跟进|监督|每天|每周|习惯|备考|学习计划|历史|固定人格|固定人设|固定语气|专属语气|人格本身|人设本身|语气本身/,
  /\b(long[-\s]?term|memory|remember|preference|follow[-\s]?up|daily|weekly|habit|companion|historical|persistent)\b/i,
];

const ROLE_FRAMING_PATTERNS: RegExp[] = [
  /角色|专家|顾问|助理|助手|智能体|机器人|导师|教练|分析师|审查员|编辑|翻译官|规划师|经理|设计师|工程师|客服|运营/,
  /\b(agent|assistant|bot|advisor|expert|coach|tutor|mentor|analyst|reviewer|editor|translator|planner|manager|designer|engineer)\b/i,
];

const removeAgentShell = (prompt: string) =>
  prompt
    .replaceAll(/https?:\/\/\S+/g, ' ')
    .replaceAll(/[`*_#>(){}]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replaceAll(
      /(帮我|请|我想|我希望|希望|需要|想要|能不能|可以)?\s*(创建|新建|做一个|做个|做|搭建|生成|配置|制作|build|create|make|set up)/gi,
      ' ',
    )
    .replaceAll(/\b(agent|assistant|bot|advisor|expert|coach)\b/gi, ' ')
    .replaceAll(
      /(一个|一位|一名|专门|能够|可以|用于|用来|负责|智能体|助手|助理|机器人|专家|顾问|教练)/g,
      ' ',
    )
    .replaceAll(/\s+/g, ' ')
    .trim();

const matchesAny = (patterns: RegExp[], text: string) =>
  patterns.some((pattern) => pattern.test(text));

const pushUnique = (items: string[], value: string) => {
  const query = value.trim();
  if (!query || items.includes(query)) return;
  items.push(query);
};

export interface AgentSkillSuggestionResult {
  items: DiscoverSkillItem[];
  query: string;
}

export const isHighConfidenceSkillSuggestionPrompt = (prompt: string): boolean => {
  const cleaned = removeAgentShell(prompt);
  const text = `${prompt} ${cleaned}`;
  const hasReusableSkillIntent = matchesAny(SKILL_INTENT_PATTERNS, text);
  const hasRoleFraming = matchesAny(ROLE_FRAMING_PATTERNS, prompt);
  const hasSkillCategoryMatch = QUERY_RULES.some(
    (rule) => rule.pattern.test(prompt) || rule.pattern.test(cleaned),
  );

  return (
    (hasReusableSkillIntent || (hasRoleFraming && hasSkillCategoryMatch)) &&
    !matchesAny(AGENT_INTENT_PATTERNS, text)
  );
};

export const buildAgentSkillSuggestionQueries = (prompt: string): string[] => {
  const cleaned = removeAgentShell(prompt);
  const queries: string[] = [];

  for (const rule of QUERY_RULES) {
    if (rule.pattern.test(prompt) || rule.pattern.test(cleaned)) {
      pushUnique(queries, rule.query);
    }
    if (queries.length >= MAX_QUERY_COUNT) break;
  }

  return queries.slice(0, MAX_QUERY_COUNT);
};

export const searchAgentSkillSuggestion = async (
  prompt: string,
): Promise<AgentSkillSuggestionResult | undefined> => {
  if (!isHighConfidenceSkillSuggestionPrompt(prompt)) return;

  const queries = buildAgentSkillSuggestionQueries(prompt);
  if (queries.length === 0) return;

  for (const query of queries) {
    const result = await marketApiService.searchSkill({
      page: 1,
      pageSize: MAX_RESULT_COUNT,
      q: query,
      sort: SkillSorts.Relevance,
    });

    if (result.items.length > 0) {
      return {
        items: result.items.slice(0, MAX_RESULT_COUNT),
        query,
      };
    }
  }
};
