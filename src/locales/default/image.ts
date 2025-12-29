export default {
  config: {
    aspectRatio: {
      label: '宽高比',
      lock: '锁定宽高比',
      unlock: '解锁宽高比',
    },
    cfg: {
      label: '引导强度',
    },
    header: {
      desc: '简单描述，即刻创作',
      title: '绘画',
    },
    height: {
      label: '高度',
    },
    imageNum: {
      label: '图片数量',
    },
    imageUrl: {
      label: '参考图',
    },
    imageUrls: {
      label: '参考图',
    },
    model: {
      label: '模型',
    },
    prompt: {
      placeholder: '描述你想要生成的内容',
    },
    quality: {
      label: '图片质量',
      options: {
        hd: '高清',
        standard: '标准',
      },
    },
    resolution: {
      label: '分辨率',
      options: {
        '1K': '1K',
        '2K': '2K',
        '4K': '4K',
      },
    },
    search: {
      label: '联网搜索',
    },
    seed: {
      label: '种子',
      random: '随机种子',
    },
    size: {
      label: '尺寸',
    },
    steps: {
      label: '步数',
    },
    title: 'AI 绘画',
    width: {
      label: '宽度',
    },
  },
  generation: {
    actions: {
      applySeed: '应用种子',
      copyError: '复制错误信息',
      copyPrompt: '复制提示词',
      copySeed: '复制种子',
      delete: '删除',
      deleteBatch: '删除批次',
      download: '下载',
      downloadFailed: '下载图片失败，请检查网络连接或 S3 存储服务的跨域配置',
      errorCopied: '错误信息已复制到剪贴板',
      errorCopyFailed: '复制错误信息失败',
      generate: '生成',
      promptCopied: '提示词已复制到剪贴板',
      promptCopyFailed: '复制提示词失败',
      reuseSettings: '复用设置',
      seedApplied: '种子已应用到配置',
      seedApplyFailed: '应用种子失败',
      seedCopied: '种子已复制到剪贴板',
      seedCopyFailed: '复制种子失败',
    },
    metadata: {
      count: '{{count}} 张图片',
    },
    status: {
      failed: '生成失败',
      generating: '生成中...',
    },
  },
  notSupportGuide: {
    desc: '当前部署实例为客户端数据库模式，无法使用 AI 图像生成功能。请切换到<1>服务端数据库部署模式</1>，或直接使用 <3>LobeChat Cloud</3>',
    features: {
      fileIntegration: {
        desc: '与文件管理系统深度整合，生成的图片自动保存到文件系统，支持统一管理和组织',
        title: '文件系统互通',
      },
      llmAssisted: {
        desc: '结合大语言模型能力，智能优化和扩展提示词，提升图像生成质量（Coming Soon）',
        title: 'LLM 辅助生图',
      },
      multiProviders: {
        desc: '支持多种 AI 绘画服务商，包括 OpenAI gpt-image-1、Google Imagen、FAL.ai 等，提供丰富的模型选择',
        title: '多 Providers 支持',
      },
    },
    title: '当前部署模式不支持 AI 绘画',
  },
  topic: {
    createNew: '新建主题',
    deleteConfirm: '删除生成主题',
    deleteConfirmDesc: '即将删除该生成主题，删除后将不可恢复，请谨慎操作。',
    empty: '暂无生成主题',
    title: '绘画主题',
    untitled: '默认主题',
  },
};
