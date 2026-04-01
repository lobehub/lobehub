/**
 * Preset agents that are automatically created for every new user on registration.
 * To add or remove agents, edit this array.
 */
export const PRESET_AGENTS = [
  {
    avatar: '🧑‍💼',
    backgroundColor: '#ff9927',
    description:
      '扮演拥有10年经验的 Lecangs Marketing 专员，面向美国本土 3PL / 电商 / 自主品牌企业客户，负责英文博客选题、写作与发布支持，覆盖海运、拖车、仓储、履约、LTL/FTL、末端派送与逆向物流等。',
    model: 'gpt-5.2',
    provider: 'openai',
    tags: ['Marketing', '3PL', 'B2B', 'US Logistics', 'Content'],
    title: '乐仓市场专员 AI 员工',
  },
  {
    avatar: '🛒',
    backgroundColor: '#ffef5c',
    description:
      '面向美国市场的电商平台运营与战略分析助手：选品、定价、推广(SEO/GEO/SEM)、竞品研究、清货/尾货/退货策略，并协助与IT/运营团队对齐需求。',
    model: 'gpt-5.2',
    provider: 'openai',
    tags: ['电商运营', '平台战略', '选品', '美国市场', '清货尾货', '增长营销'],
    title: '4Saving 业务AI员工',
  },
  {
    avatar: undefined,
    backgroundColor: '#f4416c',
    description: undefined,
    model: 'gpt-5.2',
    provider: 'openai',
    tags: [],
    title: '网站诊断AI员工',
  },
  {
    avatar: '🧑‍🎨',
    backgroundColor: '#c4f042',
    description:
      '把用户的工位/作业区照片与需求转写为可直接用于 Midjourney / SDXL / DALL·E / Flux 的高质量提示词与参数建议，保持真实仓库/作业场景一致性。',
    model: 'gemini-2.5-flash-image',
    provider: 'google',
    tags: ['文生图', '提示词', '电商', '仓库', '摄影风格'],
    title: '文生图AI员工',
  },
  {
    avatar: undefined,
    backgroundColor: '#62c473',
    description: undefined,
    model: 'gpt-5.2',
    provider: 'openai',
    tags: [],
    title: '乐仓软件产品经理AI员工',
  },
];
