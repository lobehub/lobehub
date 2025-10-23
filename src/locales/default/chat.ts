export default {
  ModelSwitch: {
    title: '模型',
  },
  active: '活跃',
  agentDefaultMessage:
    '你好，我是 **{{name}}**，你可以立即与我开始对话，也可以前往 [助手设置]({{url}}) 完善我的信息。',
  agentDefaultMessageWithSystemRole: '你好，我是 **{{name}}**，有什么我可以帮忙的吗？',
  agentDefaultMessageWithoutEdit: '你好，我是 **{{name}}**，有什么我可以帮忙的吗？',
  agents: '助手',
  artifact: {
    generating: '生成中',
    inThread: '子话题中无法查看，请切换到主对话区打开',
    thinking: '思考中',
    thought: '思考过程',
    unknownTitle: '未命名作品',
  },
  availableAgents: '可用助手',
  backToBottom: '跳转至当前',
  chatList: {
    longMessageDetail: '查看详情',
  },
  clearCurrentMessages: '清空当前会话消息',
  confirmClearCurrentMessages: '即将清空当前会话消息，清空后将无法找回，请确认你的操作',
  confirmRemoveChatGroupItemAlert: '即将删除该 Agent 团队，团队成员不受影响，请确认你的操作',
  confirmRemoveGroupItemAlert: '即将删除该分组，删除后该分组的助手将移动到默认列表，请确认你的操作',
  confirmRemoveGroupSuccess: 'Agent 团队删除成功',
  confirmRemoveSessionItemAlert: '即将删除该助手，删除后该将无法找回，请确认你的操作',
  confirmRemoveSessionSuccess: '助手删除成功',
  defaultAgent: '自定义助手',
  defaultGroupChat: 'Agent 团队',
  defaultList: '默认列表',
  defaultSession: '自定义助手',
  dm: {
    placeholder: '你与 {{agentTitle}} 的私信将显示在这里。',
    tooltip: '发私信',
    visibleTo: '仅 {{target}} 可见',
    you: '你',
  },
  duplicateSession: {
    loading: '复制中...',
    success: '复制成功',
    title: '{{title}} 副本',
  },
  duplicateTitle: '{{title}} 副本',
  emptyAgent: '暂无助手',
  extendParams: {
    disableContextCaching: {
      desc: '单条对话生成成本最高可降低 90%，响应速度提升 4 倍（<1>了解更多</1>）。开启后将自动禁用历史消息数限制',
      title: '开启上下文缓存',
    },
    enableReasoning: {
      desc: '基于 Claude Thinking 机制限制（<1>了解更多</1>），开启后将自动禁用历史消息数限制',
      title: '开启深度思考',
    },
    reasoningBudgetToken: {
      title: '思考消耗 Token',
    },
    reasoningEffort: {
      title: '推理强度',
    },
    textVerbosity: {
      title: '输出文本详细程度',
    },
    thinking: {
      title: '深度思考开关',
    },
    title: '模型扩展功能',
    urlContext: {
      desc: '开启后将自动解析网页链接，以获取实际网页上下文内容',
      title: '提取网页链接内容',
    },
  },
  group: {
    desc: '与多个 AI 助手在共享的对话空间中协作。',
    memberTooltip: '群内有 {{count}} 个成员',
    orchestratorThinking: '主持人正在思考中...',
    removeMember: '移除成员',
    title: '群组',
  },
  groupDescription: '团队描述',
  groupSidebar: {
    members: {
      addMember: '添加成员',
      memberSettings: '成员设置',
      orchestrator: '主持人',
      orchestratorThinking: '主持人正在思考中...',
      removeMember: '移除成员',
      stopOrchestrator: '停止思考',
      triggerOrchestrator: '开始群聊',
    },
    tabs: {
      host: '主持人',
      members: '成员',
      role: '设定',
    },
  },

  groupWizard: {
    chooseMembers: '选择现有助手...',
    createGroup: '创建团队',
    existingMembers: '已有 Agent',
    groupMembers: '这些助手也将被添加到您的列表中',
    host: {
      description: '使团队自主运行',
      title: '启用主持人',
      tooltip: '如果禁用团队主持人，您需要手动@提及成员才能让他们回复',
    },
    memberCount: '{{count}} 个成员',
    noMatchingTemplates: '没有匹配的模板',
    noSelectedTemplates: '没有选择模板',
    noTemplateMembers: '模板中没有成员',
    noTemplates: '没有可用的模板',
    searchTemplates: '搜索模板...',
    title: '创建 Agent 团队',
    useTemplate: '使用模板',
  },

  hideForYou: '私信内容已经隐藏，请在设置中开启【显示私信内容】以查看',

  history: {
    title: '助手将只记住最后{{count}}条消息',
  },

  historyRange: '历史范围',

  historySummary: '历史消息总结',

  inactive: '不活跃',

  inbox: {
    desc: '开启大脑集群，激发思维火花。你的智能助理，在这里与你交流一切',
    title: '随便聊聊',
  },

  input: {
    addAi: '添加一条 AI 消息',
    addUser: '添加一条用户消息',
    disclaimer: 'AI 也可能会犯错，请检查重要信息',
    errorMsg: '消息发送失败，请检查网络后重试: {{errorMsg}}',
    more: '更多',
    send: '发送',
    sendWithCmdEnter: '按 <key/> 键发送',
    sendWithEnter: '按 <key/> 键发送',
    stop: '停止',
    warp: '换行',
    warpWithKey: '按 <key/> 键换行',
  },

  intentUnderstanding: {
    title: '正在理解并分析您的意图...',
  },
  // Group chat related translations
  inviteMembers: '邀请成员',
  knowledgeBase: {
    all: '所有内容',
    allFiles: '所有文件',
    allKnowledgeBases: '所有知识库',
    disabled:
      '当前部署模式不支持知识库对话，如需使用，请切换到服务端数据库部署或使用 {{cloud}} 服务',
    library: {
      action: {
        add: '添加',
        detail: '详情',
        remove: '移除',
      },
      title: '文件/知识库',
    },
    relativeFilesOrKnowledgeBases: '关联文件/知识库',
    title: '知识库',
    uploadGuide: '上传过的文件可以在「知识库」中查看哦',
    viewMore: '查看更多',
  },
  memberSelection: {
    addMember: '添加成员',
    allMembers: '全体成员',
    createGroup: '创建 Agent 团队',
    noAvailableAgents: '没有可邀请的助手',
    noSelectedAgents: '还未选择助手',
    searchAgents: '搜索助手...',
    setInitialMembers: '选择团队成员',
  },

  members: 'Members',

  mention: {
    title: '提及成员',
  },

  messageAction: {
    delAndRegenerate: '删除并重新生成',
    deleteDisabledByThreads: '存在子话题，不能删除',
    regenerate: '重新生成',
  },

  messages: {
    dm: {
      sentTo: '仅对{{name}}可见',
      title: '私信',
    },
    modelCard: {
      credit: '积分',
      creditPricing: '定价',
      creditTooltip:
        '为便于计数，我们将 1$ 折算为 1M 积分，例如 $3/M tokens 即可折算为 3积分/token',
      pricing: {
        inputCachedTokens: '缓存输入 {{amount}}/积分 · ${{amount}}/M',
        inputCharts: '${{amount}}/M 字符',
        inputMinutes: '${{amount}}/分钟',
        inputTokens: '输入 {{amount}}/积分 · ${{amount}}/M',
        outputTokens: '输出 {{amount}}/积分 · ${{amount}}/M',
        writeCacheInputTokens: '缓存输入写入 {{amount}}/积分 · ${{amount}}/M',
      },
    },
    tokenDetails: {
      average: '平均单价',
      input: '输入',
      inputAudio: '音频输入',
      inputCached: '输入缓存',
      inputCitation: '引用输入',
      inputText: '文本输入',
      inputTitle: '输入明细',
      inputUncached: '输入未缓存',
      inputWriteCached: '输入缓存写入',
      output: '输出',
      outputAudio: '音频输出',
      outputImage: '图像输出',
      outputText: '文本输出',
      outputTitle: '输出明细',
      reasoning: '深度思考',
      speed: {
        tps: {
          title: 'TPS',
          tooltip:
            'Tokens Per Second，TPS。指AI生成内容的平均速度（Token/秒），在接收到首个 Token 后开始计算。',
        },
        ttft: {
          title: 'TTFT',
          tooltip: 'Time To First Token，TTFT。指从您发送消息到客户端接收到首个 Token 的时间间隔。',
        },
      },
      title: '生成明细',
      total: '总计消耗',
    },
  },
  minimap: {
    jumpToMessage: '跳转至第 {{index}} 条消息',
    nextMessage: '下一条消息',
    previousMessage: '上一条消息',
    senderAssistant: '助手',
    senderUser: '你',
  },

  newAgent: '新建助手',

  newGroupChat: '新建 Agent 团队',

  noAgentsYet: '此 Agent 团队还没有成员。点击 + 按钮邀请助手。',

  noAvailableAgents: '没有可邀请的成员',

  noMatchingAgents: '没有匹配的成员',

  noMembersYet: '此群组还没有成员。点击 + 按钮邀请助手。',

  noSelectedAgents: '还未选择成员',

  owner: '群主',

  pin: '置顶',

  pinOff: '取消置顶',

  rag: {
    referenceChunks: '引用源',
    userQuery: {
      actions: {
        delete: '删除 Query 重写',
        regenerate: '重新生成 Query',
      },
    },
  },

  regenerate: '重新生成',
  roleAndArchive: '角色与记录',
  search: {
    grounding: {
      searchQueries: '搜索关键词',
      title: '已搜索到 {{count}} 个结果',
    },
    mode: {
      auto: {
        desc: '根据对话内容智能判断是否需要搜索',
        title: '智能联网',
      },
      off: {
        desc: '仅使用模型的基础知识，不进行网络搜索',
        title: '关闭联网',
      },
      on: {
        desc: '持续进行网络搜索，获取最新信息',
        title: '始终联网',
      },
      useModelBuiltin: '使用模型内置搜索引擎',
    },
    searchModel: {
      desc: '当前模型不支持函数调用，因此需要搭配支持函数调用的模型才能联网搜索',
      title: '搜索辅助模型',
    },
    title: '联网搜索',
  },
  searchAgentPlaceholder: '搜索助手...',
  searchAgents: '搜索助手...',
  selectedAgents: '已选助手',
  sendPlaceholder: '输入聊天内容...',
  sessionGroup: {
    config: '分组管理',
    confirmRemoveGroupAlert: '即将删除该分组，删除后该分组的助手将移动到默认列表，请确认你的操作',
    createAgentSuccess: '助手创建成功',
    createGroup: '添加新分组',
    createGroupFailed: '群聊创建失败',
    createGroupSuccess: '群聊创建成功',
    createSuccess: '分组创建成功',
    creatingAgent: '助手创建中...',
    inputPlaceholder: '请输入分组名称...',
    moveGroup: '移动到分组',
    newGroup: '新分组',
    rename: '重命名分组',
    renameSuccess: '重命名成功',
    sortSuccess: '重新排序成功',
    sorting: '分组排序更新中...',
    tooLong: '分组名称长度需在 1-20 之内',
  },
  shareModal: {
    copy: '复制',
    download: '下载截图',
    downloadError: '下载失败',
    downloadFile: '下载文件',
    downloadPdf: '下载 PDF',
    downloadSuccess: '下载成功',
    exportPdf: '导出为 PDF',
    exportTitle: '默认标题',
    generatePdf: '生成 PDF',
    generatingPdf: '正在生成 PDF...',
    imageType: '图片格式',
    includeTool: '包含插件消息',
    includeUser: '包含用户消息',
    loadingPdf: '加载 PDF...',
    noPdfData: '暂无 PDF 数据',
    pdf: 'PDF',
    pdfErrorDescription: '生成 PDF 时出现错误，请重试',
    pdfGenerationError: 'PDF 生成失败',
    pdfReady: 'PDF 已准备就绪',
    regeneratePdf: '重新生成 PDF',
    screenshot: '截图',
    settings: '导出设置',
    text: '文本',
    withBackground: '包含背景图片',
    withFooter: '包含页脚',
    withPluginInfo: '包含插件信息',
    withRole: '包含消息角色',
    withSystemRole: '包含助手角色设定',
  },
  stt: {
    action: '语音输入',
    loading: '识别中...',
    prettifying: '润色中...',
  },
  supervisor: {
    todoList: {
      allComplete: '所有任务已完成',
      title: '任务已完成',
    },
  },
  thread: {
    divider: '子话题',
    threadMessageCount: '{{messageCount}} 条消息',
    title: '子话题',
  },
  toggleWideScreen: {
    off: '关闭宽屏模式',
    on: '开启宽屏模式',
  },
  tokenDetails: {
    chats: '会话消息',
    historySummary: '历史总结',
    rest: '剩余可用',
    supervisor: '群组主持',
    systemRole: '角色设定',
    title: '上下文明细',
    tools: '插件设定',
    total: '总共可用',
    used: '总计使用',
  },
  tokenTag: {
    overload: '超过限制',
    remained: '剩余',
    used: '使用',
  },
  topic: {
    checkOpenNewTopic: '是否开启新话题?',
    checkSaveCurrentMessages: '是否保存当前会话为话题?',
    openNewTopic: '开启新话题',
    saveCurrentMessages: '将当前会话保存为话题',
  },
  translate: {
    action: '翻译',
    clear: '删除翻译',
  },
  tts: {
    action: '语音朗读',
    clear: '删除语音',
  },
  untitledAgent: '未命名助手',
  updateAgent: '更新助理信息',
  upload: {
    action: {
      fileUpload: '上传文件',
      folderUpload: '上传文件夹',
      imageDisabled: '当前模型不支持视觉识别，请切换模型后使用',
      imageUpload: '上传图片',
      tooltip: '上传',
    },
    clientMode: {
      actionFiletip: '上传文件',
      actionTooltip: '上传',
      disabled: '当前模型不支持视觉识别和文件分析，请切换模型后使用',
      fileNotSupported: '浏览器模式下暂不支持上传文件，仅支持图片',
      visionNotSupported: '当前模型不支持视觉识别，请切换模型后使用',
    },
    preview: {
      prepareTasks: '准备分块...',
      status: {
        pending: '准备上传...',
        processing: '文件处理中...',
      },
    },
    validation: {
      videoSizeExceeded: '视频文件大小不能超过 20MB，当前文件大小为 {{actualSize}}',
    },
  },
  you: '你',
  zenMode: '专注模式',
};
