export default {
  about: {
    title: '关于',
  },
  agentTab: {
    chat: '聊天偏好',
    meta: '助手信息',
    modal: '模型设置',
    opening: '开场设置',
    plugin: '插件设置',
    prompt: '角色设定',
    tts: '语音服务',
  },
  analytics: {
    telemetry: {
      desc: '通过选择发送遥测数据，你可以帮助我们改善 {{appName}} 整体用户体验',
      title: '发送匿名使用数据',
    },
    title: '数据统计',
  },
  danger: {
    clear: {
      action: '立即清除',
      confirm: '确认清除所有聊天数据？',
      desc: '将会清除所有会话数据，包括助手、文件、消息、插件等',
      success: '已清除所有会话消息',
      title: '清除所有会话消息',
    },
    reset: {
      action: '立即重置',
      confirm: '确认重置所有设置？',
      currentVersion: '当前版本',
      desc: '重置所有设置，使用默认值',
      success: '已重置所有设置',
      title: '重置所有设置',
    },
  },
  groupTab: {
    chat: '聊天',
    members: '成员',
    meta: '基本信息',
  },
  header: {
    desc: '偏好与模型设置',
    global: '全局设置',
    group: '团队设置',
    groupDesc: '管理 Agent 团队与聊天偏好',
    session: '会话设置',
    sessionDesc: '角色设定与会话偏好',
    sessionWithName: '会话设置 · {{name}}',
    title: '设置',
  },
  hotkey: {
    conflicts: '与现有快捷键冲突',
    errors: {
      CONFLICT: '快捷键冲突：该快捷键已被其他功能占用',
      INVALID_FORMAT: '快捷键格式无效：请使用正确的格式（如 CommandOrControl+E）',
      INVALID_ID: '无效的快捷键ID',
      NO_MODIFIER: '快捷键必须包含修饰键（Ctrl、Alt、Shift等）',
      SYSTEM_OCCUPIED: '快捷键已被系统或其他应用程序占用',
      UNKNOWN: '更新失败：未知错误',
    },
    group: {
      conversation: '会话',
      desktop: '桌面端',
      essential: '基础',
    },
    invalidCombination: '快捷键需要至少包含一个修饰键 (Ctrl, Alt, Shift) 和一个常规键',
    record: '按下按键以录制快捷键',
    reset: '重置为默认快捷键',
    title: '快捷键',
    updateError: '快捷键更新失败：网络或系统错误',
    updateSuccess: '快捷键更新成功',
  },
  llm: {
    aesGcm: '您的秘钥与代理地址等将使用 <1>AES-GCM</1> 加密算法进行加密',
    apiKey: {
      desc: '请填写你的 {{name}} API Key',
      placeholder: '{{name}} API Key',
      title: 'API Key',
    },
    checker: {
      button: '检查',
      desc: '测试 Api Key 与代理地址是否正确填写',
      pass: '检查通过',
      title: '连通性检查',
    },
    customModelCards: {
      addNew: '创建并添加 {{id}} 模型',
      config: '配置模型',
      confirmDelete: '即将删除该自定义模型，删除后将不可恢复，请谨慎操作。',
      modelConfig: {
        azureDeployName: {
          extra: '在 Azure OpenAI 中实际请求的字段',
          placeholder: '请输入 Azure 中的模型部署名称',
          title: '模型部署名称',
        },
        displayName: {
          placeholder: '请输入模型的展示名称，例如 ChatGPT、GPT-4 等',
          title: '模型展示名称',
        },
        files: {
          extra: '当前文件上传实现仅为一种 Hack 方案，仅限自行尝试。完整文件上传能力请等待后续实现',
          title: '支持文件上传',
        },
        functionCall: {
          extra:
            '此配置将仅开启应用中的函数调用能力，是否支持函数调用完全取决于模型本身，请自行测试该模型的函数调用能力可用性',
          title: '支持函数调用',
        },
        id: {
          extra: '将作为模型标签进行展示',
          placeholder: '请输入模型id，例如 gpt-4-turbo-preview 或 claude-2.1',
          title: '模型 ID',
        },
        modalTitle: '自定义模型配置',
        tokens: {
          title: '最大 token 数',
        },
        vision: {
          extra:
            '此配置将仅开启应用中的图片上传配置，是否支持识别完全取决于模型本身，请自行测试该模型的视觉识别能力可用性',
          title: '支持视觉识别',
        },
      },
    },
    fetchOnClient: {
      desc: '客户端请求模式将从浏览器直接发起会话请求，可提升响应速度',
      title: '使用客户端请求模式',
    },
    fetcher: {
      clear: '清除获取的模型',
      fetch: '获取模型列表',
      fetching: '正在获取模型列表...',
      latestTime: '上次更新时间：{{time}}',
      noLatestTime: '暂未获取列表',
    },
    helpDoc: '配置教程',
    modelList: {
      desc: '选择在会话中展示的模型，选择的模型会在模型列表中展示',
      placeholder: '请从列表中选择模型',
      title: '模型列表',
      total: '共 {{count}} 个模型可用',
    },
    proxyUrl: {
      desc: '除默认地址外，必须包含 http(s)://',
      title: 'API 代理地址',
    },
    waitingForMore: '更多模型正在 <1>计划接入</1> 中，敬请期待',
  },
  message: {
    success: '更新成功',
  },
  plugin: {
    addMCPPlugin: '添加 MCP 插件',
    addTooltip: '自定义插件',
    clearDeprecated: '移除无效插件',
    empty: '暂无已安装插件，欢迎前往 <1>插件商店</1> 探索',
    installStatus: {
      deprecated: '已卸载',
    },
    settings: {
      hint: '请根据描述填写以下配置',
      title: '{{id}} 插件配置',
      tooltip: '插件配置',
    },
    store: '插件商店',
  },

  settingAgent: {
    avatar: {
      title: '助手头像',
    },
    backgroundColor: {
      title: '头像背景色',
    },
    description: {
      desc: '简单介绍你的助手，不作为角色设定',
      placeholder: '请输入助手描述',
      title: '助手描述',
    },
    name: {
      placeholder: '请输入助手名称',
      title: '名称',
    },
    prompt: {
      placeholder: '请输入角色 Prompt 提示词',
      title: '角色设定',
    },
    submit: '更新助手信息',
    tag: {
      desc: '助手标签将在助手市场中展示',
      placeholder: '请输入标签',
      title: '标签',
    },
    title: '助手信息',
  },

  settingAppearance: {
    animationMode: {
      agile: '敏捷',
      desc: '选择应用程序的操作响应的动画速度',
      disabled: '关闭',
      elegant: '优雅',
      title: '响应动画',
    },
    neutralColor: {
      desc: '不同色彩倾向的灰阶自定义',
      title: '中性色',
    },
    noAnimation: {
      desc: '禁用应用程序中的所有动画效果',
      title: '无动画模式',
    },
    preview: {
      title: '调色盘',
    },
    primaryColor: {
      desc: '自定义主题色',
      title: '主题色',
    },
    title: '应用外观',
  },
  settingChat: {
    autoCreateTopicThreshold: {
      desc: '当前消息数超过设定该值后，将自动创建话题',
      title: '消息阈值',
    },
    chatStyleType: {
      title: '聊天窗口样式',
      type: {
        chat: '对话模式',
        docs: '文档模式',
      },
    },
    compressThreshold: {
      desc: '当未压缩的历史消息超过该值时，将进行压缩',
      title: '历史消息长度压缩阈值',
    },
    enableAutoCreateTopic: {
      desc: '会话过程中是否自动创建话题，仅在临时话题中生效',
      title: '自动创建话题',
    },
    enableCompressHistory: {
      title: '开启历史消息自动总结',
    },
    enableHistoryCount: {
      alias: '不限制',
      limited: '只包含 {{number}} 条会话消息',
      setlimited: '使用历史消息数',
      title: '限制历史消息数',
      unlimited: '不限历史消息数',
    },
    enableStreaming: {
      desc: '启用流式输出以实时显示响应。禁用后仅显示完整响应。',
      title: '启用流式输出',
    },
    historyCount: {
      desc: '每次请求携带的消息数（包括最新编写的提问。每个提问和回答都计算1）',
      title: '附带消息数',
    },
    inputTemplate: {
      desc: '用户最新的一条消息会填充到此模板',
      placeholder: '预处理模版 {{text}} 将替换为实时输入信息',
      title: '用户输入预处理',
    },
    submit: '更新聊天偏好',
    title: '聊天设置',
  },
  settingChatAppearance: {
    fontSize: {
      desc: '聊天内容的字体大小',
      marks: {
        normal: '标准',
      },
      title: '字体大小',
    },
    highlighterTheme: {
      title: '代码高亮主题',
    },
    mermaidTheme: {
      title: 'Mermaid 主题',
    },
    title: '聊天外观',
    transitionMode: {
      desc: '聊天消息的过渡动画',
      options: {
        fadeIn: '淡入',
        none: {
          desc: '这取决于模型的响应输出方式，请自行测试。',
          value: '无',
        },
        smooth: '平滑',
      },
      title: '过渡动画',
    },
  },
  settingCommon: {
    lang: {
      autoMode: '跟随系统',
      title: '语言',
    },
    themeMode: {
      auto: '自动',
      dark: '深色',
      light: '浅色',
      title: '主题',
    },
    title: '通用设置',
  },
  settingGroup: {
    description: {
      placeholder: '请输入团队描述',
      title: '团队描述',
    },
    name: {
      placeholder: '请输入团队名称',
      title: '团队名称',
    },
    scene: {
      desc: '选择团队场景',
      options: {
        casual: '休闲',
        productive: '生产力',
      },
      title: '团队场景',
    },
    submit: '更新团队',
    systemPrompt: {
      placeholder: '请输入主持人系统提示词',
      title: '主持人系统提示词',
    },
    title: 'Agent 团队信息',
  },
  settingGroupChat: {
    allowDM: {
      desc: '关闭后，你仍然可以主动向助手发送私信',
      title: '允许助手发送私信',
    },
    enableSupervisor: {
      desc: '启用 Agent 团队主持人功能，主持人将管理团队对话流程',
      title: '启用主持人',
    },
    maxResponseInRow: {
      desc: '选择成员可以连续回复多少条消息。设置为 0 则禁用此限制。',
      title: '连续回复消息数',
    },
    model: {
      desc: '群成员发言不受影响。部分模型无法作为主持人模型使用。',
      title: '主持人模型',
    },
    orchestratorTitle: '主持人设置',
    responseOrder: {
      desc: '代理将按照在聊天中设置的顺序进行回复',
      options: {
        natural: '自然',
        sequential: '顺序',
      },
      placeholder: '选择回复顺序',
      title: '回复顺序',
    },
    responseSpeed: {
      desc: '控制聊天的整体进行速度',
      options: {
        fast: '快速',
        medium: '中等',
        slow: '慢速',
      },
      placeholder: '选择回复速度',
      title: '回复速度',
    },
    revealDM: {
      desc: '使发送给其他成员的私信内容对你可见。',
      title: '显示私信内容',
    },
    submit: '更新设置',
    systemPrompt: {
      desc: '群聊对话主持人的自定义系统提示词。这可能影响默认的主持人行为。',
      placeholder: '请输入自定义主持人系统提示词...',
      title: '主持人系统提示词',
    },
    title: '聊天设置',
  },
  settingGroupMembers: {
    addToGroup: '加入群组',
    availableAgents: '可用助手',
    createMember: '创建成员',
    defaultAgent: '自定义助手',
    disableHost: '关闭主持助手',
    edit: '编辑成员',
    empty: '该团队中暂无成员。点击 + 按钮添加成员。',
    enableHost: '启用主持助手',
    groupHost: '群主持',
    groupMembers: '群组成员',
    host: {
      description: '主持人在群组中时，群聊将自动化运行，适合发散性任务。',
      title: '主持人',
    },
    noAvailableAgents: '暂无可用助手',
    noDescription: '暂无描述',
    noMembersInGroup: '群组暂无成员',
    owner: '你（所有者）',
    remove: '移除成员',
    removeFromGroup: '移出群组',
    you: '你',
  },
  settingImage: {
    defaultCount: {
      desc: '设置图像生成面板在创建新任务时的默认图片数量。',
      label: '默认图片数量',
      title: 'AI 绘画设置',
    },
  },
  settingModel: {
    enableMaxTokens: {
      title: '开启单次回复限制',
    },
    enableReasoningEffort: {
      title: '开启推理强度调整',
    },
    frequencyPenalty: {
      desc: '值越大，用词越丰富多样；值越低，用词更朴实简单',
      title: '词汇丰富度',
    },
    maxTokens: {
      desc: '单次交互所用的最大 Token 数',
      title: '单次回复限制',
    },
    model: {
      desc: '{{provider}} 模型',
      title: '模型',
    },
    params: {
      title: '高级参数',
    },
    presencePenalty: {
      desc: '值越大，越倾向不同的表达方式，避免概念重复；值越小，越倾向使用重复的概念或叙述，表达更具一致性',
      title: '表述发散度',
    },
    reasoningEffort: {
      desc: '值越大，推理能力越强，但可能会增加响应时间和 Token 消耗',
      options: {
        high: '高',
        low: '低',
        medium: '中',
      },
      title: '推理强度',
    },
    submit: '更新模型设置',
    temperature: {
      desc: '数值越大，回答越有创意和想象力；数值越小，回答越严谨',
      title: '创意活跃度',
      warning: '创意活跃度数值过大，输出可能会产生乱码',
    },
    title: '模型设置',
    topP: {
      desc: '考虑多少种可能性，值越大，接受更多可能的回答；值越小，倾向选择最可能的回答。不推荐和创意活跃度一起更改',
      title: '思维开放度',
    },
  },
  settingOpening: {
    openingMessage: {
      desc: '打开会话时的开场消息，用来介绍助手的功能',
      placeholder: '你好，我是自定义助手。你可以立即与我开始对话，也可以前往助手设置完善我的信息。',
      title: '开场消息',
    },
    openingQuestions: {
      desc: '会话开始时展示的引导性问题',
      empty: '暂无问题',
      placeholder: '请输入问题',
      repeat: '问题已存在',
      title: '开场问题',
    },
    title: '开场设置',
  },
  settingPlugin: {
    title: '插件列表',
  },
  settingSystem: {
    accessCode: {
      desc: '管理员已开启加密访问',
      placeholder: '请输入访问密码',
      title: '访问密码',
    },
    oauth: {
      info: {
        desc: '已登录',
        title: '账户信息',
      },
      signin: {
        action: '登录',
        desc: '使用 SSO 登录以解锁应用',
        title: '登录账号',
      },
      signout: {
        action: '退出登录',
        confirm: '确认退出？',
        success: '退出登录成功',
      },
    },
    title: '系统设置',
  },
  settingTTS: {
    openai: {
      sttModel: 'OpenAI 语音识别模型',
      title: 'OpenAI',
      ttsModel: 'OpenAI 语音合成模型',
    },
    showAllLocaleVoice: {
      desc: '关闭则只显示当前语种的声源',
      title: '显示所有语种声源',
    },
    stt: '语音识别设置',
    sttAutoStop: {
      desc: '关闭后，语音识别将不会自动结束，需要手动点击结束按钮',
      title: '自动结束语音识别',
    },
    sttLocale: {
      desc: '语音输入的语种，此选项可提高语音识别准确率',
      title: '语音识别语种',
    },
    sttService: {
      desc: '其中 browser 为浏览器原生的语音识别服务',
      title: '语音识别服务',
    },
    submit: '更新语音服务',
    title: '语音服务',
    tts: '语音合成设置',
    ttsService: {
      desc: '如使用 OpenAI 语音合成服务，需要保证 OpenAI 模型服务已开启',
      title: '语音合成服务',
    },
    voice: {
      desc: '为当前助手挑选一个声音，不同 TTS 服务支持的声源不同',
      preview: '试听声源',
      title: '语音合成声源',
    },
  },
  storage: {
    actions: {
      export: {
        button: '导出',
        exportType: {
          agent: '导出助手设定',
          agentWithMessage: '导出助手和消息',
          all: '导出全局设置和所有助手数据',
          allAgent: '导出所有助手设定',
          allAgentWithMessage: '导出所有助手和消息',
          globalSetting: '导出全局设置',
        },
        title: '导出数据',
      },
      import: {
        button: '导入',
        title: '导入数据',
      },
      title: '高级操作',
    },
    desc: '当前浏览器中的存储用量',
    embeddings: {
      used: '向量存储',
    },
    title: '数据存储',
    used: '存储用量',
  },
  submitAgentModal: {
    button: '提交助手',
    identifier: 'identifier 助手标识符',
    metaMiss: '请补全助手信息后提交，需要包含名称、描述和标签',
    placeholder: '请输入助手的标识符，需要是唯一的，比如 web-development',
    tooltips: '分享到助手市场',
  },
  submitFooter: {
    reset: '重置',
    submit: '保存',
    unSaved: '未保存更改',
    unSavedWarning: '当前有未保存的更改',
  },
  sync: {
    device: {
      deviceName: {
        hint: '添加名称以便于识别',
        placeholder: '请输入设备名称',
        title: '设备名称',
      },
      title: '设备信息',
      unknownBrowser: '未知浏览器',
      unknownOS: '未知系统',
    },
    warning: {
      tip: '经过较长一段时间社区公测，WebRTC 同步可能无法稳定满足通用的数据同步诉求。请自行 <1>部署信令服务器</1> 后使用。',
    },
    webrtc: {
      channelName: {
        desc: 'WebRTC 将使用此名创建同步频道，确保频道名称唯一',
        placeholder: '请输入同步频道名称',
        shuffle: '随机生成',
        title: '同步频道名称',
      },
      channelPassword: {
        desc: '添加密码确保频道私密性，只有密码正确时，设备才可加入频道',
        placeholder: '请输入同步频道密码',
        title: '同步频道密码',
      },
      desc: '实时、点对点的数据通信，需设备同时在线才可同步',
      enabled: {
        invalid: '请填写信令服务器和同步频道名称后再开启',
        title: '开启同步',
      },
      signaling: {
        desc: 'WebRTC 将使用该地址进行同步',
        placeholder: '请输入信令服务器地址',
        title: '信令服务器',
      },
      title: 'WebRTC 同步',
    },
  },
  systemAgent: {
    agentMeta: {
      label: '助理元数据生成模型',
      modelDesc: '指定用于生成助理名称、描述、头像、标签的模型',
      title: '自动生成助理信息',
    },
    customPrompt: {
      addPrompt: '添加自定义提示',
      desc: '填写后，系统助理将在生成内容时使用自定义提示',
      placeholder: '请输入自定义提示词',
      title: '自定义提示词',
    },
    generationTopic: {
      label: 'AI 绘画话题命名模型',
      modelDesc: '指定用于 AI 绘画自动命名话题的模型',
      title: 'AI 绘画自动命名话题',
    },
    helpInfo: '当创建新助手时，将以默认助手设置作为预设值。',
    historyCompress: {
      label: '会话历史模型',
      modelDesc: '指定用于压缩会话历史的模型',
      title: '自动总结会话历史',
    },
    queryRewrite: {
      label: '提问重写模型',
      modelDesc: '指定用于优化用户提问的模型',
      title: '知识库提问重写',
    },
    thread: {
      label: '子话题命名模型',
      modelDesc: '指定用于子话题自动重命名的模型',
      title: '子话题自动命名',
    },
    title: '系统助手',
    topic: {
      label: '话题命名模型',
      modelDesc: '指定用于话题自动重命名的模型',
      title: '话题自动命名',
    },
    translation: {
      label: '翻译模型',
      modelDesc: '指定用于翻译的模型',
      title: '消息内容翻译',
    },
  },
  tab: {
    'about': '关于',
    'agent': '默认助手',
    'common': '通用设置',
    'experiment': '实验',
    'hotkey': '快捷键',
    'image': 'AI 绘画',
    'llm': '语言模型',
    'provider': 'AI 服务商',
    'proxy': '网络代理',
    'storage': '数据存储',
    'sync': '云端同步',
    'system-agent': '系统助手',
    'tts': '语音服务',
  },
  tools: {
    builtins: {
      groupName: '内置插件',
    },
    disabled: '当前模型不支持函数调用，无法使用插件',
    plugins: {
      enabled: '已启用 {{num}}',
      groupName: '三方插件',
      noEnabled: '暂无启用插件',
      store: '插件商店',
    },
    title: '扩展插件',
  },
};
