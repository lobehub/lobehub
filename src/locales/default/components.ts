export default {
  ArgsInput: {
    addArgument: '添加参数',
    argumentPlaceholder: '参数 {{index}}',
    enterFirstArgument: '输入第一个参数...',
  },
  DragUpload: {
    dragDesc: '拖拽文件到这里，支持上传多个图片。',
    dragFileDesc: '拖拽图片和文件到这里，支持上传多个图片和文件。',
    dragFileTitle: '上传文件',
    dragTitle: '上传图片',
  },
  FileManager: {
    actions: {
      addToKnowledgeBase: '添加到知识库',
      addToOtherKnowledgeBase: '添加到其他知识库',
      batchChunking: '批量分块',
      chunking: '分块',
      chunkingTooltip: '将文件拆分为多个文本块并向量化后，可用于语义检索和文件对话',
      chunkingUnsupported: '该文件不支持分块',
      confirmDelete: '即将删除该文件，删除后该将无法找回，请确认你的操作',
      confirmDeleteMultiFiles:
        '即将删除选中的 {{count}} 个文件，删除后该将无法找回，请确认你的操作',
      confirmRemoveFromKnowledgeBase:
        '即将从知识库中移除选中的 {{count}} 个文件，移除后文件仍然可以在全部文件中查看，请确认你的操作',
      copyUrl: '复制链接',
      copyUrlSuccess: '文件地址复制成功',
      createChunkingTask: '准备中...',
      deleteSuccess: '文件删除成功',
      downloading: '文件下载中...',
      removeFromKnowledgeBase: '从知识库中移除',
      removeFromKnowledgeBaseSuccess: '文件移除成功',
    },
    bottom: '已经到底啦',
    config: {
      showFilesInKnowledgeBase: '显示知识库中内容',
    },
    emptyStatus: {
      actions: {
        file: '上传文件',
        folder: '上传文件夹',
        knowledgeBase: '新建知识库',
      },
      or: '或者',
      title: '将文件或文件夹拖到这里',
    },
    title: {
      createdAt: '创建时间',
      size: '大小',
      title: '文件',
    },
    total: {
      fileCount: '共 {{count}} 项',
      selectedCount: '已选 {{count}} 项',
    },
    view: {
      list: '列表视图',
      masonry: '网格视图',
    },
  },
  FileParsingStatus: {
    chunks: {
      embeddingStatus: {
        empty: '文本块尚未完全向量化，将导致语义检索功能不可用，为提升检索质量，请对文本块向量化',
        error: '向量化失败',
        errorResult: '向量化失败，请检查后重试。失败原因：',
        processing: '文本块正在向量化，请耐心等待',
        success: '当前文本块均已向量化',
      },
      embeddings: '向量化',
      status: {
        error: '分块失败',
        errorResult: '分块失败，请检查后重试。失败原因：',
        processing: '分块中',
        processingTip: '服务端正在拆分文本块，关闭页面不影响分块进度',
      },
    },
  },
  GoBack: {
    back: '返回',
  },
  HtmlPreview: {
    actions: {
      download: '下载',
      preview: '预览',
    },
    iframeTitle: 'HTML 预览',
    mode: {
      code: '代码',
      preview: '预览',
    },
    title: 'HTML 预览',
  },
  ImageUpload: {
    actions: {
      changeImage: '点击更换图片',
      dropMultipleFiles: '不支持多上传多个文件，只会使用第一个文件',
    },
    placeholder: {
      primary: '添加图片',
      secondary: '点击或拖拽上传',
    },
  },
  KeyValueEditor: {
    addButton: '新增一行',
    deleteTooltip: '删除',
    duplicateKeyError: '键名必须唯一',
    keyPlaceholder: '键',
    valuePlaceholder: '值',
  },
  MaxTokenSlider: {
    unlimited: '无限制',
  },
  ModelSelect: {
    featureTag: {
      custom: '自定义模型，默认设定同时支持函数调用与视觉识别，请根据实际情况验证上述能力的可用性',
      file: '该模型支持上传文件读取与识别',
      functionCall: '该模型支持函数调用（Function Call）',
      imageOutput: '该模型支持生成图片',
      reasoning: '该模型支持深度思考',
      search: '该模型支持联网搜索',
      tokens: '该模型单个会话最多支持 {{tokens}} Tokens',
      video: '该模型支持视频识别',
      vision: '该模型支持视觉识别',
    },
    removed: '该模型不在列表中，若取消选中将会自动移除',
  },
  ModelSwitchPanel: {
    emptyModel: '没有启用的模型，请前往设置开启',
    emptyProvider: '没有启用的服务商，请前往设置开启',
    goToSettings: '前往设置',
    provider: '服务商',
    title: '模型',
  },
  MultiImagesUpload: {
    actions: {
      uploadMore: '点击或拖拽上传更多',
    },
    modal: {
      complete: '完成',
      newFileIndicator: '新增',
      selectImageToPreview: '请选择要预览的图片',
      title: '管理图片 ({{count}})',
      upload: '上传图片',
    },
    placeholder: {
      primary: '点击或拖拽上传图片',
      secondary: '支持多张图片选择',
    },
    progress: {
      uploadingWithCount: '{{completed}}/{{total}} 已上传',
    },
    validation: {
      fileSizeExceeded: 'File size exceeded limit',
      fileSizeExceededDetail:
        '{{fileName}} ({{actualSize}}) exceeds the maximum size limit of {{maxSize}}',
      fileSizeExceededMultiple:
        '{{count}} files exceed the maximum size limit of {{maxSize}}: {{fileList}}',
      imageCountExceeded: 'Image count exceeded limit',
    },
  },
  OllamaSetupGuide: {
    action: {
      close: '关闭提示',
      start: '已安装并运行，开始对话',
    },
    cors: {
      description: '因浏览器安全限制，你需要为 Ollama 进行跨域配置后方可正常使用。',
      linux: {
        env: '在 [Service] 部分下添加 `Environment`，添加 OLLAMA_ORIGINS 环境变量：',
        reboot: '重载 systemd 并重启 Ollama',
        systemd: '调用 systemd 编辑 ollama 服务：',
      },
      macos: '请打开「终端」应用程序，并粘贴以下指令，并按回车运行',
      reboot: '请在执行完成后重启 Ollama 服务',
      title: '配置 Ollama 允许跨域访问',
      windows:
        '在 Windows 上，点击「控制面板」，进入编辑系统环境变量。为您的用户账户新建名为 「OLLAMA_ORIGINS」 的环境变量，值为 * ，点击 「OK/应用」 保存',
    },
    install: {
      description: '请确认你已经开启 Ollama ，如果没有下载 Ollama ，请前往官网<1>下载</1>',
      docker:
        '如果你更倾向于使用 Docker，Ollama 也提供了官方 Docker 镜像，你可以通过以下命令拉取：',
      linux: {
        command: '通过以下命令安装：',
        manual: '或者，你也可以参考 <1>Linux 手动安装指南</1> 自行安装',
      },
      title: '在本地安装并开启 Ollama 应用',
      windowsTab: 'Windows (预览版)',
    },
  },
  Thinking: {
    thinking: '深度思考中...',
    thought: '已深度思考（用时 {{duration}} 秒）',
    thoughtWithDuration: '已深度思考',
  },
};
