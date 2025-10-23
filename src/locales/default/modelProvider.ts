export default {
  azure: {
    azureApiVersion: {
      desc: 'Azure 的 API 版本，遵循 YYYY-MM-DD 格式，查阅[最新版本](https://learn.microsoft.com/zh-cn/azure/ai-services/openai/reference#chat-completions)',
      fetch: '获取列表',
      title: 'Azure API Version',
    },
    empty: '请输入模型 ID 添加第一个模型',
    endpoint: {
      desc: '从 Azure 门户检查资源时，可在“密钥和终结点”部分中找到此值',
      placeholder: 'https://docs-test-001.openai.azure.com',
      title: 'Azure API 地址',
    },
    modelListPlaceholder: '请选择或添加你部署的 OpenAI 模型',
    title: 'Azure OpenAI',
    token: {
      desc: '从 Azure 门户检查资源时，可在“密钥和终结点”部分中找到此值。 可以使用 KEY1 或 KEY2',
      placeholder: 'Azure API Key',
      title: 'API Key',
    },
  },
  azureai: {
    azureApiVersion: {
      desc: 'Azure 的 API 版本，遵循 YYYY-MM-DD 格式，查阅[最新版本](https://learn.microsoft.com/zh-cn/azure/ai-services/openai/reference#chat-completions)',
      fetch: '获取列表',
      title: 'Azure API Version',
    },
    endpoint: {
      desc: '从 Azure AI 项目概述找到 Azure AI 模型推理终结点',
      placeholder: 'https://ai-userxxxxxxxxxx.services.ai.azure.com/models',
      title: 'Azure AI 终结点',
    },
    title: 'Azure OpenAI',
    token: {
      desc: '从 Azure AI 项目概述找到 API 密钥',
      placeholder: 'Azure 密钥',
      title: '密钥',
    },
  },

  bedrock: {
    accessKeyId: {
      desc: '填入 AWS Access Key Id',
      placeholder: 'AWS Access Key Id',
      title: 'AWS Access Key Id',
    },
    checker: {
      desc: '测试 AccessKeyId / SecretAccessKey 是否填写正确',
    },
    region: {
      desc: '填入 AWS Region',
      placeholder: 'AWS Region',
      title: 'AWS Region',
    },
    secretAccessKey: {
      desc: '填入 AWS Secret Access Key',
      placeholder: 'AWS Secret Access Key',
      title: 'AWS Secret Access Key',
    },
    sessionToken: {
      desc: '如果你正在使用 AWS SSO/STS，请输入你的 AWS Session Token',
      placeholder: 'AWS Session Token',
      title: 'AWS Session Token (可选)',
    },
    title: 'Bedrock',
    unlock: {
      customRegion: '自定义服务区域',
      customSessionToken: '自定义 Session Token',
      description:
        '输入你的 AWS AccessKeyId / SecretAccessKey 即可开始会话。应用不会记录你的鉴权配置',
      imageGenerationDescription:
        '输入你的 AWS AccessKeyId / SecretAccessKey 即可开始生成。应用不会记录你的鉴权配置',
      title: '使用自定义 Bedrock 鉴权信息',
    },
  },
  cloudflare: {
    apiKey: {
      desc: '请填写 Cloudflare API Key',
      placeholder: 'Cloudflare API Key',
      title: 'Cloudflare API Key',
    },
    baseURLOrAccountID: {
      desc: '填入 Cloudflare 账户 ID 或 自定义 API 地址',
      placeholder: 'Cloudflare Account ID / custom API URL',
      title: 'Cloudflare 账户 ID / API 地址',
    },
  },
  comfyui: {
    apiKey: {
      desc: 'Bearer Token 认证所需的 API 密钥',
      placeholder: '请输入 API 密钥',
      required: '请输入 API 密钥',
      title: 'API 密钥',
    },
    authType: {
      desc: '选择与 ComfyUI 服务器的认证方式',
      options: {
        basic: '账号/密码',
        bearer: 'Bearer (API 密钥)',
        custom: '自定义请求头',
        none: '无需认证',
      },
      placeholder: '请选择认证类型',
      title: '认证类型',
    },
    baseURL: {
      desc: 'ComfyUI 网页访问地址',
      placeholder: 'http://127.0.0.1:8000',
      required: '请输入 ComfyUI 服务地址',
      title: 'ComfyUI 服务地址',
    },
    checker: {
      desc: '测试连接是否正确配置',
      title: '连通性检查',
    },
    customHeaders: {
      addButton: '添加请求头',
      deleteTooltip: '删除此请求头',
      desc: '自定义认证方式所需的请求头，格式为键值对',
      duplicateKeyError: '请求头键名不能重复',
      keyPlaceholder: '键名',
      required: '请输入自定义请求头',
      title: '自定义请求头',
      valuePlaceholder: '值',
    },
    password: {
      desc: '基本认证所需的密码',
      placeholder: '请输入密码',
      required: '请输入密码',
      title: '密码',
    },
    title: 'ComfyUI',
    username: {
      desc: '基本认证所需的用户名',
      placeholder: '请输入用户名',
      required: '请输入用户名',
      title: '用户名',
    },
  },
  createNewAiProvider: {
    apiKey: {
      placeholder: '请填写你的 API Key',
      title: 'API Key',
    },
    basicTitle: '基本信息',
    configTitle: '配置信息',
    confirm: '新建',
    createSuccess: '新建成功',
    description: {
      placeholder: '服务商简介（选填）',
      title: '服务商简介',
    },
    id: {
      desc: '作为服务商唯一标识，创建后将不可修改',
      format: '只能包含数字、小写字母、连字符（-）和下划线（_）',
      placeholder: '例如 openai、gemini 等',
      required: '请填写服务商 ID',
      title: '服务商 ID',
    },
    logo: {
      required: '请上传正确的服务商 Logo',
      title: '服务商 Logo',
    },
    name: {
      placeholder: '请输入服务商的展示名称',
      required: '请填写服务商名称',
      title: '服务商名称',
    },
    proxyUrl: {
      required: '请填写代理地址',
      title: '代理地址',
    },
    sdkType: {
      placeholder: 'openai/anthropic/azureai/ollama/...',
      required: '请选择 SDK 类型',
      title: '请求格式',
    },
    title: '创建自定义 AI 服务商',
  },
  github: {
    personalAccessToken: {
      desc: '填入你的 Github PAT，点击 [这里](https://github.com/settings/tokens) 创建',
      placeholder: 'ghp_xxxxxx',
      title: 'Github PAT',
    },
  },
  huggingface: {
    accessToken: {
      desc: '填入你的 HuggingFace Token，点击 [这里](https://huggingface.co/settings/tokens) 创建',
      placeholder: 'hf_xxxxxxxxx',
      title: 'HuggingFace Token',
    },
  },
  list: {
    title: {
      disabled: '未启用服务商',
      enabled: '已启用服务商',
    },
  },
  menu: {
    addCustomProvider: '添加自定义服务商',
    all: '全部',
    list: {
      disabled: '未启用',
      enabled: '已启用',
    },
    notFound: '未找到搜索结果',
    searchProviders: '搜索服务商...',
    sort: '自定义排序',
  },
  newapi: {
    apiKey: {
      desc: 'New API 平台提供的 API 密钥',
      placeholder: 'New API API 密钥',
      required: 'API 密钥是必需的',
      title: 'API 密钥',
    },
    apiUrl: {
      desc: 'New API 服务的 API 地址，大部分时候不要带 /v1',
      title: 'API 地址',
    },
    enabled: {
      title: '启用 New API',
    },
    models: {
      batchSelect: '批量选择模型 ({{count}} 个)',
      fetch: '获取模型列表',
      selected: '已选择的模型',
      title: '可用模型',
    },
    title: 'New API',
  },
  ollama: {
    checker: {
      desc: '测试代理地址是否正确填写',
      title: '连通性检查',
    },
    customModelName: {
      desc: '增加自定义模型，多个模型使用逗号（,）隔开',
      placeholder: 'vicuna,llava,codellama,llama2:13b-text',
      title: '自定义模型名称',
    },
    download: {
      desc: 'Ollama 正在下载该模型，请尽量不要关闭本页面。重新下载时将会中断处继续',
      failed: '模型下载失败，请检查网络或者 Ollama 设置后重试',
      remainingTime: '剩余时间',
      speed: '下载速度',
      title: '正在下载模型 {{model}} ',
    },
    endpoint: {
      desc: '必须包含http(s)://，本地未额外指定可留空',
      title: 'Ollama 服务地址',
    },
    title: 'Ollama',
    unlock: {
      cancel: '取消下载',
      confirm: '下载',
      description: '输入你的 Ollama 模型标签，完成即可继续会话',
      downloaded: '{{completed}} / {{total}}',
      starting: '开始下载...',
      title: '下载指定的 Ollama 模型',
    },
  },
  providerModels: {
    batchSelect: {
      selected: '已选择 {{count}} 个模型',
      title: '批量选择',
    },
    config: {
      aesGcm: '您的秘钥与代理地址等将使用 <1>AES-GCM</1> 加密算法进行加密',
      apiKey: {
        desc: '请填写你的 {{name}} API Key',
        descWithUrl: '请填写你的 {{name}} API Key，<3>点此获取</3>',
        placeholder: '{{name}} API Key',
        title: 'API Key',
      },
      baseURL: {
        desc: '必须包含 http(s)://',
        invalid: '请输入合法的 URL',
        placeholder: 'https://your-proxy-url.com/v1',
        title: 'API 代理地址',
      },
      checker: {
        button: '检查',
        desc: '测试 Api Key 与代理地址是否正确填写',
        pass: '检查通过',
        title: '连通性检查',
      },
      fetchOnClient: {
        desc: '客户端请求模式将从浏览器直接发起会话请求，可提升响应速度',
        title: '使用客户端请求模式',
      },
      helpDoc: '配置教程',
      responsesApi: {
        desc: '采用 OpenAI 新一代请求格式规范，解锁思维链等进阶特性',
        title: '使用 Responses API 规范',
      },
      waitingForMore: '更多模型正在 <1>计划接入</1> 中，敬请期待',
    },
    createNew: {
      title: '创建自定义 AI 模型',
    },
    item: {
      config: '配置模型',
      customModelCards: {
        addNew: '创建并添加 {{id}} 模型',
        confirmDelete: '即将删除该自定义模型，删除后将不可恢复，请谨慎操作。',
      },
      delete: {
        confirm: '确认删除模型 {{displayName}}？',
        success: '删除成功',
        title: '删除模型',
      },
      modelConfig: {
        azureDeployName: {
          extra: '在 Azure OpenAI 中实际请求的字段',
          placeholder: '请输入 Azure 中的模型部署名称',
          title: '模型部署名称',
        },
        deployName: {
          extra: '发送请求时会将该字段作为模型 ID',
          placeholder: '请输入模型实际部署的名称或 id',
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
            '此配置将仅开启模型使用工具的能力，进而可以为模型添加工具类的插件。但是否支持真正使用工具完全取决于模型本身，请自行测试的可用性',
          title: '支持工具使用',
        },
        id: {
          extra: '创建后不可修改，调用 AI 时将作为模型 id 使用',
          placeholder: '请输入模型 id，例如 gpt-4o 或 claude-3.5-sonnet',
          title: '模型 ID',
        },
        imageOutput: {
          extra:
            '此配置将仅开启模型生成图片的能力，具体效果完全取决于模型本身，请自行测试该模型是否具备可用的图片生成能力',
          title: '支持图片生成',
        },
        modalTitle: '自定义模型配置',
        reasoning: {
          extra:
            '此配置将仅开启模型深度思考的能力，具体效果完全取决于模型本身，请自行测试该模型是否具备可用的深度思考能力',
          title: '支持深度思考',
        },
        search: {
          extra:
            '此配置将仅开启模型内置搜索引擎的联网搜索能力，是否支持内置搜索引擎取决于模型本身，请自行测试该模型的内置搜索引擎能力可用性',
          title: '支持联网搜索',
        },
        tokens: {
          extra: '设置模型支持的最大 Token 数',
          title: '最大上下文窗口',
          unlimited: '无限制',
        },
        type: {
          extra: '不同模型类型拥有差异化的使用场景与能力',
          options: {
            chat: '对话',
            embedding: '向量化',
            image: '图片生成',
            realtime: '实时对话',
            stt: '语音转文本',
            text2music: '文本转音乐',
            text2video: '文本转视频',
            tts: '语音合成',
          },
          placeholder: '请选择模型类型',
          title: '模型类型',
        },
        video: {
          extra:
            '此配置将仅开启应用中的视频识别配置，是否支持识别完全取决于模型本身，请自行测试该模型的视频识别能力可用性',
          title: '支持视频识别',
        },
        vision: {
          extra:
            '此配置将仅开启应用中的图片上传配置，是否支持识别完全取决于模型本身，请自行测试该模型的视觉识别能力可用性',
          title: '支持视觉识别',
        },
      },
      pricing: {
        image: '${{amount}}/图片',
        inputCharts: '${{amount}}/M 字符',
        inputMinutes: '${{amount}}/分钟',
        inputTokens: '输入 ${{amount}}/M',
        outputTokens: '输出 ${{amount}}/M',
      },
      releasedAt: '发布于{{releasedAt}}',
    },
    list: {
      addNew: '添加模型',
      disabled: '未启用',
      disabledActions: { showMore: '显示全部' },
      empty: {
        desc: '请创建自定义模型或拉取模型后开始使用吧',
        title: '暂无可用模型',
      },
      enabled: '已启用',
      enabledActions: {
        disableAll: '全部禁用',
        enableAll: '全部启用',
        sort: '自定义模型排序',
      },
      enabledEmpty: '暂无启用模型，请从下方列表中启用心仪的模型吧~',
      fetcher: {
        clear: '清除获取的模型',
        fetch: '获取模型列表',
        fetching: '正在获取模型列表...',
        latestTime: '上次更新时间：{{time}}',
        noLatestTime: '暂未获取列表',
      },
      noModelsInCategory: '该分类下暂无启用的模型',
      resetAll: {
        conform: '确认重置当前模型的所有修改？重置后当前模型列表将会回到默认状态',
        success: '重置成功',
        title: '重置所有修改',
      },
      search: '搜索模型...',
      searchResult: '搜索到 {{count}} 个模型',
      title: '模型列表',
      total: '共 {{count}} 个模型可用',
    },
    searchNotFound: '未找到搜索结果',
    tabs: {
      all: '全部',
      chat: '对话',
      embedding: '向量化',
      image: '图片',
      stt: 'ASR',
      tts: 'TTS',
    },
  },
  sortModal: {
    success: '排序更新成功',
    title: '自定义排序',
    update: '更新',
  },
  updateAiProvider: {
    confirmDelete: '即将删除该 AI 服务商，删除后将无法找回，确认是否删除？',
    deleteSuccess: '删除成功',
    tooltip: '更新服务商基础配置',
    updateSuccess: '更新成功',
  },
  updateCustomAiProvider: {
    title: '更新自定义 AI 服务商配置',
  },
  vertexai: {
    apiKey: {
      desc: '填入你的 Vertex Ai Keys',
      placeholder: `{ "type": "service_account", "project_id": "xxx", "private_key_id": ... }`,
      title: 'Vertex AI Keys',
    },
    region: {
      desc: '选择 Vertex AI 服务的区域。某些模型如 Gemini 2.5 仅在特定区域可用（如 global）',
      placeholder: '选择区域',
      title: 'Vertex AI 区域',
    },
  },
  zeroone: {
    title: '01.AI 零一万物',
  },
  zhipu: {
    title: '智谱',
  },
};
