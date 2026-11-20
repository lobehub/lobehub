/**
 * Prompts and output schemas for memory consolidation. Calibrated on a 200-memory replay and a
 * full 1586-memory run with DeepSeek flash: a blind judge rated 91% of online placements
 * reasonable and dossier coherence 4.7 / 5. An English translation scored lower on the same
 * replay (4.4 / 5, 88%), so the prompts stay in the wording they were calibrated in; titles and
 * summaries follow the language of the memories.
 */

export const CLASSIFY_SYSTEM = [
  '你在整理一个用户的历史记忆。每条记忆是从一次对话里抽出来的。逐条判断它该去哪里：',
  '- evidence：某件持续推进的事（项目、功能、客户合作、融资、交易）的一次进展或经过，包括单次开发流水；',
  '- fact：关于某个人、公司、产品的稳定事实（身份、关系、改名、定位），不随事情推进而变；',
  '- preference：某人（通常是用户本人，也可能是客户/投资人）的偏好、习惯、要求；',
  '- drop：一次性技术问答、调研/论文解读、闲聊、与任何持续事项无关的内容。',
  'domain 用「大类/方向」写一个简短的领域键（如 product/task-system、customer/acme、company/fundraising），同一件事用同一个键。entities 列出提到的具体人、公司、产品、仓库（不要写 User/用户）。preference 时 holder 填偏好的持有者（用户本人填 self）。',
  '每条输入记忆都要返回一项，保留它的 id。',
].join('\n');

export const CLASSIFY_SCHEMA = {
  name: 'memory_consolidation_classify',
  schema: {
    additionalProperties: false,
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            domain: { type: 'string' },
            entities: { items: { type: 'string' }, type: 'array' },
            holder: { type: 'string' },
            id: { type: 'string' },
            route: { enum: ['evidence', 'fact', 'preference', 'drop'], type: 'string' },
            value: { enum: ['high', 'medium', 'low'], type: 'string' },
          },
          required: ['id', 'route', 'value', 'domain', 'entities', 'holder'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['items'],
    type: 'object' as const,
  },
  strict: true,
};

export const NORMALIZE_SYSTEM = [
  '下面是从记忆里得到的领域键和条数，其中很多是同一个领域的不同写法或过细的拆分。把它们归并成一份统一的领域列表：同一个项目方向、同一个客户、同一件公司事务归成一个领域；不同的项目方向不要硬并。每个原始键都必须映射到一个统一键。',
].join('\n');

export const NORMALIZE_SCHEMA = {
  name: 'memory_consolidation_normalize',
  schema: {
    additionalProperties: false,
    properties: {
      mapping: {
        items: {
          additionalProperties: false,
          properties: { domain: { type: 'string' }, raw: { type: 'string' } },
          required: ['raw', 'domain'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['mapping'],
    type: 'object' as const,
  },
  strict: true,
};

export const SYNTHESIZE_SYSTEM = [
  '你在为一个用户把同一领域下的历史记忆整理成两级结构：',
  '- context（第一级）：一个项目方向 / 一个客户合作 / 一件公司事务，例如「某产品的任务系统」「与某客户的合作」「种子轮融资」。一个领域通常只有 1–3 个 context，不要把同一个项目方向拆成多个 context；',
  '- 档案（第二级）：context 下的一个功能、一笔交易或一个持续子任务，例如「任务调度后端（heartbeat/cron）」「任务详情页与路由」「一笔过桥借款」。档案通常跨多次对话：同一功能的每次开发、修 bug、提 PR、rebase 都是这份档案的经过，必须放进同一份档案，不要按会话、按 PR、按单个 bug 拆档案。只有和其它记忆确实无关的才单独成一份档案。',
  '每条记忆必须且只能放进一份档案（members 写记忆 id），或放进 unplaced（与这个领域的持续事项都无关）。已有结构（来自更早的记忆）给出时，属于已有档案的记忆用 existing_dossier 填那份档案的 id，不要另开。now 写这件事现在的状态（基于最新的记忆，一两句），next_steps / open_questions 只写记忆里明确出现的。',
  '标题和摘要使用记忆原文的语言书写。',
].join('\n');

export const SYNTHESIZE_SCHEMA = {
  name: 'memory_consolidation_synthesize',
  schema: {
    additionalProperties: false,
    properties: {
      contexts: {
        items: {
          additionalProperties: false,
          properties: {
            dossiers: {
              items: {
                additionalProperties: false,
                properties: {
                  existing_dossier: { type: 'string' },
                  members: { items: { type: 'string' }, type: 'array' },
                  now: { type: 'string' },
                  title: { type: 'string' },
                },
                required: ['existing_dossier', 'title', 'now', 'members'],
                type: 'object',
              },
              type: 'array',
            },
            existing_context: { type: 'string' },
            next_steps: { items: { type: 'string' }, type: 'array' },
            now: { type: 'string' },
            open_questions: { items: { type: 'string' }, type: 'array' },
            title: { type: 'string' },
          },
          required: [
            'existing_context',
            'title',
            'now',
            'next_steps',
            'open_questions',
            'dossiers',
          ],
          type: 'object',
        },
        type: 'array',
      },
      unplaced: { items: { type: 'string' }, type: 'array' },
    },
    required: ['contexts', 'unplaced'],
    type: 'object' as const,
  },
  strict: true,
};

export const ROUTE_SYSTEM = [
  '你在维护一个用户的记忆。结构：context（一个项目方向/客户合作/公司事务）→ 档案（一个功能、一笔交易或一个持续子任务）→ 证据（每次对话的进展）。',
  '新来一条从对话里抽出的记忆。先判断 route：evidence（某件持续推进的事的进展，包括单次开发流水）/ fact（关于人或公司的稳定事实）/ preference（某人的偏好或要求）/ drop（一次性技术问答、调研、闲聊）。',
  '如果是 evidence，从下面的 context 列表里选出它所属的 context（context 填 id）；确实没有任何一个相关时填 new，并给 new_context_title。同一项目方向的工作都属于同一个 context，不要因为是新的子功能就新开 context。confidence 是你对 context 选择的把握。',
  '标题和摘要使用记忆原文的语言书写。',
].join('\n');

export const ROUTE_SCHEMA = {
  name: 'memory_consolidation_route',
  schema: {
    additionalProperties: false,
    properties: {
      confidence: { type: 'number' },
      context: { type: 'string' },
      new_context_title: { type: 'string' },
      reason: { type: 'string' },
      route: { enum: ['evidence', 'fact', 'preference', 'drop'], type: 'string' },
    },
    required: ['route', 'context', 'new_context_title', 'confidence', 'reason'],
    type: 'object' as const,
  },
  strict: true,
};

export interface ClassifiedItem {
  domain: string;
  entities: string[];
  holder: string;
  id: string;
  route: 'drop' | 'evidence' | 'fact' | 'preference';
  value: 'high' | 'low' | 'medium';
}

export interface SynthesizedContext {
  dossiers: { existing_dossier: string; members: string[]; now: string; title: string }[];
  existing_context: string;
  next_steps: string[];
  now: string;
  open_questions: string[];
  title: string;
}

export interface SynthesisResult {
  contexts: SynthesizedContext[];
  unplaced: string[];
}

export interface RouteResult {
  confidence: number;
  context: string;
  new_context_title: string;
  reason: string;
  route: 'drop' | 'evidence' | 'fact' | 'preference';
}
