export default {
  guide: {
    agents: {
      replaceBtn: '换一批',
      title: '新增助手推荐：',
    },
    defaultMessage:
      '我是您的私人智能助理 {{appName}} ，请问现在能帮您做什么？<br />如果需要获得更加专业或定制的助手，可以点击 <plus /> 创建自定义助手',
    defaultMessageWithoutCreate: '我是您的私人智能助理 {{appName}} ，请问现在能帮您做什么？',
    groupActivities: {
      // 分析小队专属活动
      analysis: {
        codeReview: {
          description: '对代码变更和实现进行技术讨论和同行评审',
          emoji: '💻',
          prompt: '让我们一起审查一些代码。你能帮助我们分析这些代码并识别改进的地方吗？',
          title: '代码评审',
        },
        investment: {
          description: '分析市场、讨论投资策略并分享财经洞察',
          emoji: '📈',
          prompt: '让我们一起分析市场。你能帮助我们讨论投资策略并分享财经洞察吗？',
          title: '投资俱乐部',
        },
        research: {
          description: '探索科学概念、进行实验并分享发现',
          emoji: '🔬',
          prompt: '让我们一起探索科学吧！你能帮助我们进行实验并分享我们的发现吗？',
          title: '科学展览',
        },
        study: {
          description: '协作学习会议，讨论概念并共同解决问题',
          emoji: '📚',
          prompt: '让我们组成一个学习小组。你能帮助我们理解这些概念并一起解决问题吗？',
          title: '学习小组',
        },
      },
      // 头脑风暴小组专属活动
      brainstorm: {
        artWorkshop: {
          description: '创作、评论和欣赏各种形式的视觉和数字艺术',
          emoji: '🖼️',
          prompt: '让我们举办艺术工作坊吧！你能帮助我们创作、评论和欣赏各种形式的艺术吗？',
          title: '艺术工作坊',
        },
        debate: {
          description: '关于各种话题和时事的结构化讨论和论辩',
          emoji: '⚖️',
          prompt: '让我们进行一场结构化辩论。你能帮助我们就这个话题组织一场有理有据的讨论吗？',
          title: '辩论俱乐部',
        },
        designReview: {
          description: '针对设计概念、原型或创意作品的协作反馈会议',
          emoji: '🎨',
          prompt: '我们需要审查一些设计作品。你能帮助我们对设计概念和原型提供建设性反馈吗？',
          title: '设计评审',
        },
        ideation: {
          description: '多视角协作式创意产生和创造性问题解决',
          emoji: '🧠',
          prompt: '让我们开始为项目进行头脑风暴吧。你能帮助我们产生创意想法和解决方案吗？',
          title: '头脑风暴',
        },
      },
      // 游戏厅专属活动
      game: {
        debateClub: {
          description: '关于各种话题和时事的结构化讨论和论辩',
          emoji: '⚖️',
          prompt: '让我们进行一场结构化辩论。你能帮助我们就这个话题组织一场有理有据的讨论吗？',
          title: '辩论俱乐部',
        },
        gameNight: {
          description: '有趣的互动游戏和活动，建立团队纽带并享受乐趣',
          emoji: '🎲',
          prompt: '游戏之夜开始啦！你能帮助我们组织一些有趣的互动游戏来建立团队纽带吗？',
          title: '游戏之夜',
        },
        modelUN: {
          description: '模拟联合国辩论和全球议题的外交谈判',
          emoji: '🌍',
          prompt: '让我们模拟一场联合国辩论。你能帮助我们设置一个关于全球议题的外交谈判吗？',
          title: '模拟联合国',
        },
        werewolf: {
          description: '玩家通过策略和讨论找出狼人的社交推理游戏',
          emoji: '🐺',
          prompt: '让我们玩狼人游戏吧！你能帮助我们设置规则并主持这个社交推理游戏吗？',
          title: '狼人游戏',
        },
      },

      // 通用活动（作为后备选项）
      general: {
        brainstorm: {
          description: '多视角协作式创意产生和创造性问题解决',
          emoji: '🧠',
          prompt: '让我们开始为项目进行头脑风暴吧。你能帮助我们产生创意想法和解决方案吗？',
          title: '头脑风暴',
        },
        debate: {
          description: '关于各种话题和时事的结构化讨论和论辩',
          emoji: '⚖️',
          prompt: '让我们进行一场结构化辩论。你能帮助我们就这个话题组织一场有理有据的讨论吗？',
          title: '辩论俱乐部',
        },
        languagePractice: {
          description: '与母语者一起练习口语和学习新语言',
          emoji: '🗣️',
          prompt: '让我们一起练习新语言吧。你能帮助我们学习和练习说这门语言吗？',
          title: '语言练习',
        },
        studyGroup: {
          description: '协作学习会议，讨论概念并共同解决问题',
          emoji: '📚',
          prompt: '让我们组成一个学习小组。你能帮助我们理解这些概念并一起解决问题吗？',
          title: '学习小组',
        },
      },

      // 美食研发团队专属活动
      planning: {
        cookingClass: {
          description: '学习和分享烹饪技巧、食谱和烹饪传统',
          emoji: '👨‍🍳',
          prompt: '让我们上烹饪课吧！你能帮助我们一起学习新食谱和烹饪技巧吗？',
          title: '烹饪课堂',
        },
        fitnessChallenge: {
          description: '设定团体健身目标、分享锻炼方法并相互激励',
          emoji: '💪',
          prompt: '让我们开始健身挑战吧！你能帮助我们设定目标并相互激励保持健康吗？',
          title: '健身挑战',
        },
        planningPoker: {
          description: '使用卡片估算项目任务和工作量的敏捷估算技术',
          emoji: '🃏',
          prompt: '我们正在为项目进行规划扑克。你能帮助我们使用敏捷技术估算这些任务的工作量吗？',
          title: '规划扑克',
        },
        travelPlanning: {
          description: '规划旅行、分享旅行经历并发现新目的地',
          emoji: '✈️',
          prompt: '让我们一起规划旅行吧！你能帮助我们研究目的地并规划旅行行程吗？',
          title: '旅行规划',
        },
      },

      // 产品研发团队专属活动
      product: {
        codeReview: {
          description: '对代码变更和实现进行技术讨论和同行评审',
          emoji: '💻',
          prompt: '让我们一起审查一些代码。你能帮助我们分析这些代码并识别改进的地方吗？',
          title: '代码评审',
        },
        designReview: {
          description: '针对设计概念、原型或创意作品的协作反馈会议',
          emoji: '🎨',
          prompt: '我们需要审查一些设计作品。你能帮助我们对设计概念和原型提供建设性反馈吗？',
          title: '设计评审',
        },
        sprintPlanning: {
          description: '使用卡片估算项目任务和工作量的敏捷估算技术',
          emoji: '🃏',
          prompt: '我们正在为项目进行规划扑克。你能帮助我们使用敏捷技术估算这些任务的工作量吗？',
          title: '规划扑克',
        },
        techExchange: {
          description: '讨论新兴技术、创新和行业趋势',
          emoji: '🚀',
          prompt: '让我们进行技术交流吧！你能帮助我们讨论新兴技术和行业趋势吗？',
          title: '技术交流',
        },
      },

      title: '群聊用法推荐',
      // 写作圈专属活动
      writing: {
        bookClub: {
          description: '对书籍、故事和文学作品进行文学讨论和分析',
          emoji: '📖',
          prompt: '让我们开始读书俱乐部讨论。你能帮助我们分析这本书并一起探讨其主题吗？',
          title: '读书俱乐部',
        },
        movieClub: {
          description: '一起观看和讨论电影、纪录片和视觉媒体',
          emoji: '🎬',
          prompt: '让我们开始电影俱乐部讨论。你能帮助我们分析这部电影并一起探讨其主题吗？',
          title: '电影俱乐部',
        },
        musicSession: {
          description: '协作音乐创作、分享和欣赏会议',
          emoji: '🎵',
          prompt: '让我们进行音乐即兴演奏吧！你能帮助我们一起创作和欣赏音乐吗？',
          title: '音乐即兴',
        },
        studyGroup: {
          description: '协作学习会议，讨论概念并共同解决问题',
          emoji: '📚',
          prompt: '让我们组成一个学习小组。你能帮助我们理解这些概念并一起解决问题吗？',
          title: '学习小组',
        },
      },
    },
    groupMessage: '欢迎使用群聊！与多个 AI 助手在共享的对话空间中协作。',
    groupTemplates: {
      analysis: {
        description: '数据驱动洞察，深度研究分析',
        members: [
          {
            avatar: '📊',
            backgroundColor: '#E8F8F5',
            plugins: ['steam'],
            systemRole: '你擅长处理和解释数据，通过图表和统计分析揭示数据背后的规律和趋势。',
            title: '数据分析师',
          },
          {
            avatar: '🧑‍🔬',
            backgroundColor: '#E8F5FF',
            systemRole: '你是研究专家，专门负责信息收集和深度调研，能够从多个维度全面分析问题。',
            title: '研究专家',
          },
          {
            avatar: '📈',
            backgroundColor: '#FFF7E8',
            systemRole: '你是统计专家，精通各种统计方法和模型，能够从数据中提取有价值的商业洞察。',
            title: '统计专家',
          },
          {
            avatar: '🧮',
            backgroundColor: '#F0F8FF',
            systemRole: '你是量化分析师，专门进行量化建模和风险评估，用数学方法解决复杂问题。',
            title: '量化分析师',
          },
        ],
        title: '分析小队',
      },
      brainstorm: {
        description: '多视角创意思维，激发无限可能',
        members: [
          {
            avatar: '🧠',
            backgroundColor: '#E8F5FF',
            systemRole:
              '你是一位创意总监，擅长从宏观角度把控创意方向，能够将抽象概念转化为具体可执行的创意方案。',
            title: '创意总监',
          },
          {
            avatar: '🧑‍🔬',
            backgroundColor: '#FFF7E8',
            systemRole:
              '你是创新专家，专门负责发现新颖的解决方案和突破性思维，善于跳出固有框架思考问题。',
            title: '创新专家',
          },
          {
            avatar: '🎨',
            backgroundColor: '#F6E8FF',
            systemRole:
              '你是设计思维专家，从用户体验和视觉呈现角度思考问题，注重创意的可视化表达。',
            title: '设计思维师',
          },
        ],
        title: '头脑风暴小组',
      },
      game: {
        description: '畅玩各种多人文字游戏，例如狼人杀和谁是卧底',
        members: [
          {
            avatar: '🧠',
            backgroundColor: '#E8F5FF',
            systemRole: '你是一位主持人，擅长组织各种多人文字游戏，能够引导玩家进行游戏。',
            title: '游戏主持人',
          },
          {
            avatar: '🧑‍🔬',
            backgroundColor: '#FFF7E8',
            systemRole: '你擅长参与各种多人文字游戏，能够根据游戏规则进行游戏。',
            title: '游戏玩家',
          },
          {
            avatar: '🎨',
            backgroundColor: '#F6E8FF',
            systemRole: '你擅长参与各种多人文字游戏，能够根据游戏规则进行游戏。',
            title: '游戏玩家',
          },
          {
            avatar: '🧑‍🎨',
            backgroundColor: '#F6E8FF',
            systemRole: '你擅长参与各种多人文字游戏，能够根据游戏规则进行游戏。',
            title: '游戏玩家',
          },
        ],
        title: '游戏厅',
      },
      planning: {
        description: '策略规划与项目管理，统筹全局',
        members: [
          {
            avatar: '📋',
            backgroundColor: '#E8F5FF',
            systemRole: '你负责项目的整体规划、进度管控和资源协调，确保项目按时高质量完成。',
            title: '厨师',
          },
          {
            avatar: '🎯',
            backgroundColor: '#FFF7E8',
            systemRole: '你负责制定长期战略规划，分析市场机会，制定目标和实现路径。',
            title: '原料采购专家',
          },
          {
            avatar: '🧑‍🎨',
            backgroundColor: '#F0F8FF',
            systemRole: '你负责制定详细的执行计划，协调各部门资源，确保计划的可执行性。',
            title: '美食研发专家',
          },
        ],
        title: '美食研发团队',
      },
      product: {
        description: '产品设计与开发，打造优质产品',
        members: [
          {
            avatar: '🎨',
            backgroundColor: '#F6E8FF',
            systemRole: '你是设计师，擅长设计各种类型的产品，能够根据产品需求进行设计。',
            title: '设计师',
          },
          {
            avatar: '🧑',
            backgroundColor: '#E8F5FF',
            systemRole:
              '你是产品经理，负责产品的规划、设计、开发和维护，确保产品的质量和用户体验。',
            title: '产品经理',
          },
          {
            avatar: '🧑‍💻',
            backgroundColor: '#E8F8F5',
            systemRole:
              '你是经验丰富的全栈工程师，擅长开发各种类型的产品，能够根据产品需求进行开发。',
            title: '全栈工程师',
          },
        ],
        title: '产品研发团队',
      },
      writing: {
        description: '内容创作与编辑，打造优质文案',
        members: [
          {
            avatar: '✍️',
            backgroundColor: '#F6E8FF',
            systemRole: '你擅长创作各类文体的内容，能够根据不同场景和受众调整写作风格。',
            title: '内容写手',
          },
          {
            avatar: '🧑‍🎨',
            backgroundColor: '#E8F8F5',
            systemRole: '你是编辑，负责文本的校对、润色和优化，确保内容的准确性、流畅性和专业性。',
            title: '编辑',
          },
        ],
        title: '写作圈',
      },
    },
    questions: {
      moreBtn: '了解更多',
      title: '试着问问：',
    },
    welcome: {
      afternoon: '下午好',
      morning: '早上好',
      night: '晚上好',
      noon: '中午好',
    },
  },
  header: '欢迎使用',
  pickAgent: '或从下列助手模板选择',
  skip: '跳过创建',
  slogan: {
    desc1: '开启大脑集群，激发思维火花。你的智能助理，一直都在。',
    desc2: '创建你的第一个助手，让我们开始吧~',
    title: '给自己一个更聪明的大脑',
  },
};
