<div align="center"><a name="readme-top"></a>

[![][image-banner]][vercel-link]

# LobeHub

LobeHub 是一个工作与生活空间，用于发现、构建并与会随着您一起成长的 Agent 队友协作。<br/>
在 LobeHub 中，我们将 **Agent 视为工作单元**，提供一个让人类与 Agent 共同进化的基础设施。

[English](./README.md) · **简体中文** · [官网][official-site] · [更新日志][changelog] · [文档][docs] · [博客][blog] · [反馈问题][github-issues-link]

<!-- SHIELD GROUP -->

[![][github-release-shield]][github-release-link]
[![][docker-release-shield]][docker-release-link]
[![][vercel-shield]][vercel-link]
[![][discord-shield]][discord-link]<br/>
[![][codecov-shield]][codecov-link]
[![][github-action-test-shield]][github-action-test-link]
[![][github-action-release-shield]][github-action-release-link]
[![][github-releasedate-shield]][github-releasedate-link]<br/>
[![][github-contributors-shield]][github-contributors-link]
[![][github-forks-shield]][github-forks-link]
[![][github-stars-shield]][github-stars-link]
[![][github-issues-shield]][github-issues-link]
[![][github-license-shield]][github-license-link]<br>
[![][sponsor-shield]][sponsor-link]

**分享 LobeHub 给你的好友**

[![][share-x-shield]][share-x-link]
[![][share-telegram-shield]][share-telegram-link]
[![][share-whatsapp-shield]][share-whatsapp-link]
[![][share-reddit-shield]][share-reddit-link]
[![][share-weibo-shield]][share-weibo-link]
[![][share-mastodon-shield]][share-mastodon-link]

<sup>Agent teammates that grow with you</sup>

[![][github-trending-shield]][github-trending-url]
[![][github-hello-shield]][github-hello-url]

</div>

<details>
<summary><kbd>目录树</kbd></summary>

#### TOC

- [👋🏻 开始使用 & 交流](#-开始使用--交流)
- [✨ 特性一览](#-特性一览)
  - [创建：以 Agent 为工作单元](#创建以-agent-为工作单元)
  - [协作：扩展新型协作网络](#协作扩展新型协作网络)
  - [进化：人类与 Agent 的共生进化](#进化人类与-agent-的共生进化)
  - [MCP](#mcp)
  - [发现、连接、扩展](#发现连接扩展)
  - [巅峰性能，零干扰](#巅峰性能零干扰)
  - [在线知识，按需获取](#在线知识按需获取)
  - [思维链 (CoT)](#思维链-cot)
  - [分支对话](#分支对话)
  - [支持白板 (Artifacts)](#支持白板-artifacts)
  - [文件上传 / 知识库](#文件上传--知识库)
  - [多模型服务商支持](#多模型服务商支持)
  - [支持本地大语言模型 (LLM)](#支持本地大语言模型-llm)
  - [模型视觉识别 (Model Visual)](#模型视觉识别-model-visual)
  - [TTS & STT 语音会话](#tts--stt-语音会话)
  - [Text to Image 文生图](#text-to-image-文生图)
  - [插件系统 (Tools Calling)](#插件系统-tools-calling)
  - [助手市场 (GPTs)](#助手市场-gpts)
  - [支持本地 / 远程数据库](#支持本地--远程数据库)
  - [支持多用户管理](#支持多用户管理)
  - [渐进式 Web 应用 (PWA)](#渐进式-web-应用-pwa)
  - [移动设备适配](#移动设备适配)
  - [自定义主题](#自定义主题)
  - [`*` 更多特性](#-更多特性)
- [🛳 开箱即用](#-开箱即用)
  - [`A` 使用 Vercel、Zeabur 、Sealos 或 阿里云计算巢 部署](#a-使用-vercelzeabur-sealos-或-阿里云计算巢-部署)
  - [`B` 使用 Docker 部署](#b-使用-docker-部署)
  - [环境变量](#环境变量)
  - [获取 OpenAI API Key](#获取-openai-api-key)
- [📦 生态系统](#-生态系统)
- [🧩 插件体系](#-插件体系)
- [⌨️ 本地开发](#️-本地开发)
- [🤝 参与贡献](#-参与贡献)
- [❤ 社区赞助](#-社区赞助)
- [🔗 更多工具](#-更多工具)

####

<br/>

</details>

<br/>

<https://github.com/user-attachments/assets/6710ad97-03d0-4175-bd75-adff9b55eca2>

## 👋🏻 开始使用 & 交流

我们是一群充满热情的设计工程师，希望为 AIGC 提供现代化的设计组件和工具，并以开源的方式分享。
同时通过 Bootstrapping 的方式，我们希望能够为开发者和用户提供一个更加开放、更加透明友好的产品生态。

不论普通用户与专业开发者，LobeHub 旨在成为所有人的 AI Agent 实验场。LobeHub 目前正在积极开发中，有任何需求或者问题，欢迎提交 [issues][issues-link]

| [![](https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1065874&theme=light&t=1769347414733)](https://www.producthunt.com/products/lobehub?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-lobehub) | 我们已在 Product Hunt 上线！我们很高兴将 LobeHub 推向世界。如果您相信人类与 Agent 共同进化的未来，请支持我们的旅程。 |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| [![][discord-shield-badge]][discord-link]                                                                                                                                                                                                         | 加入我们的 Discord 社区！这是你可以与开发者和其他 LobeHub 热衷用户交流的地方                                         |

> \[!IMPORTANT]
>
> **收藏项目**，你将从 GitHub 上无延迟地接收所有发布通知～⭐️

[![][image-star]][github-stars-link]

<details><summary><kbd>Star History</kbd></summary>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lobehub%2Flobehub&theme=dark&type=Date">
    <img src="https://api.star-history.com/svg?repos=lobehub%2Flobehub&type=Date">
  </picture>
</details>

## ✨ 特性一览

现有的 Agent 大多是一次性、以任务为驱动的工具。它们缺乏上下文，孤立运行，并且需要在不同窗口和模型之间手动交接。即使有记忆，也往往是全局的、浅层的且缺乏个性。在这种模式下，用户被迫在分散的对话之间来回切换，难以形成结构化的生产流程。

**LobeHub 改变一切。**

LobeHub 是一个工作与生活空间，用于发现、构建并与会随着您一起成长的 Agent 队友协作。在 LobeHub 中，我们将 **Agent 视为工作单元**，提供一个让人类与 Agent 共同进化的基础设施。

![](https://hub-apac-1.lobeobjects.space/blog/assets/2204cde2228fb3f583f3f2c090bc49fb.webp)

### 创建：以 Agent 为工作单元

构建个性化 AI 团队从 **Agent Builder** 开始。您只需描述一次需求，Agent 配置即可立即启动，自动应用配置以便您立刻使用。

- **统一智能**：无缝访问任何模型与任何模态 —— 全部由您掌控。
- **1 万 + 技能**：通过超过 10,000 个工具和与 MCP 兼容的插件，将 Agent 连接到您每天使用的技能。

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/771ff3d30b9ef93e65e55021cc43d356.webp)

### 协作：扩展新型协作网络

LobeHub 引入了 **Agent Groups**，让您可以像对待真实队友一样与 Agent 协同工作。系统会为任务组装合适的 Agent，支持并行协作与迭代改进。

- **页面（Pages）**：在同一位置与多个 Agent 共同撰写和润色内容，共享上下文。
- **日程（Schedule）**：安排运行，让 Agent 在合适的时间完成工作，即使您不在也能继续执行。
- **项目（Project）**：按项目组织工作，保持一切结构化且易于跟踪。
- **工作区（Workspace）**：供团队与 Agent 协作的共享空间，确保明确的所有权和组织内的可见性。

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/fe98eae9fcb6acc47c8e1fb69bdb4b50.webp)

### 进化：人类与 Agent 的共生进化

最好的 AI 是能深入理解您的那一种。LobeHub 提供了构建清晰用户理解的 **个人记忆（Personal Memory）**。

- **持续学习**：您的 Agent 会从您的工作方式中学习，调整其行为以在恰当时刻采取行动。
- **白盒记忆**：我们相信透明性。您的 Agent 使用结构化、可编辑的记忆，让您完全掌控它们记住的内容。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

<details>
<summary>更多特性</summary>

[![](https://github.com/user-attachments/assets/1be85d36-3975-4413-931f-27e05e440995)](https://lobehub.com/mcp)

### MCP

通过启用与外部工具、数据源和服务的平滑、安全和动态交互，释放你的 AI 的全部潜力。基于 MCP（模型上下文协议）的插件系统打破了 AI 与数字生态系统之间的壁垒，实现了前所未有的连接性和功能性。

将对话转化为强大的工作流程，连接数据库、API、文件系统等。体验真正理解并与你的世界互动的 AI Agent。

[![][back-to-top]](#readme-top)

![][image-feat-mcp-market]

### 发现、连接、扩展

浏览不断增长的 MCP 插件库，轻松扩展你的 AI 能力并简化工作流程。访问 [lobehub.com/mcp](https://lobehub.com/mcp) 探索 MCP 市场，提供精选的集成集合，增强你的 AI 与各种工具和服务协作的能力。

从生产力工具到开发环境，发现扩展 AI 覆盖范围和效率的新方式。与社区连接，找到满足特定需求的完美插件。

[![][back-to-top]](#readme-top)

![][image-feat-desktop]

### 巅峰性能，零干扰

获得完整的 LobeHub 体验，摆脱浏览器限制 —— 轻量级、专注且随时就绪。我们的桌面应用程序为你的 AI 交互提供专用环境，确保最佳性能和最小干扰。

体验更快的响应时间、更好的资源管理和与 AI 助手的更稳定连接。桌面应用专为要求 AI 工具最佳性能的用户设计。

[![][back-to-top]](#readme-top)

![][image-feat-web-search]

### 在线知识，按需获取

通过实时联网访问，你的 AI 与世界保持同步 —— 新闻、数据、趋势等。保持信息更新，获取最新可用信息，使你的 AI 能够提供准确和最新的回复。

访问实时信息，验证事实，探索当前事件，无需离开对话。你的 AI 成为通向世界知识的门户，始终保持最新和全面。

[![][back-to-top]](#readme-top)

[![][image-feat-cot]][docs-feat-cot]

### [思维链 (CoT)][docs-feat-cot]

体验前所未有的 AI 推理过程。通过创新的思维链（CoT）可视化功能，您可以实时观察复杂问题是如何一步步被解析的。这项突破性的功能为 AI 的决策过程提供了前所未有的透明度，让您能够清晰地了解结论是如何得出的。

通过将复杂的推理过程分解为清晰的逻辑步骤，您可以更好地理解和验证 AI 的解题思路。无论您是在调试问题、学习知识，还是单纯对 AI 推理感兴趣，思维链可视化都能将抽象思维转化为一种引人入胜的互动体验。

[![][back-to-top]](#readme-top)

[![][image-feat-branch]][docs-feat-branch]

### [分支对话][docs-feat-branch]

为您带来更自然、更灵活的 AI 对话方式。通过分支对话功能，您的讨论可以像人类对话一样自然延伸。在任意消息处创建新的对话分支，让您在保留原有上下文的同时，自由探索不同的对话方向。

两种强大模式任您选择：

- **延续模式**：无缝延展当前讨论，保持宝贵的对话上下文
- **独立模式**：基于任意历史消息，开启全新话题探讨

这项突破性功能将线性对话转变为动态的树状结构，让您能够更深入地探索想法，实现更高效的互动体验。

[![][back-to-top]](#readme-top)

[![][image-feat-artifacts]][docs-feat-artifacts]

### [支持白板 (Artifacts)][docs-feat-artifacts]

体验集成于 LobeHub 的 Claude Artifacts 能力。这项革命性功能突破了 AI 人机交互的边界，让您能够实时创建和可视化各种格式的内容。

以前所未有的灵活度进行创作与可视化：

- 生成并展示动态 SVG 图形
- 实时构建与渲染交互式 HTML 页面
- 输出多种格式的专业文档

[![][back-to-top]](#readme-top)

[![][image-feat-knowledgebase]][docs-feat-knowledgebase]

### [文件上传 / 知识库][docs-feat-knowledgebase]

LobeHub 支持文件上传与知识库功能，你可以上传文件、图片、音频、视频等多种类型的文件，以及创建知识库，方便用户管理和查找文件。同时在对话中使用文件和知识库功能，实现更加丰富的对话体验。

<https://github.com/user-attachments/assets/faa8cf67-e743-4590-8bf6-ebf6ccc34175>

> \[!TIP]
>
> 查阅 [📘 LobeHub 知识库上线 —— 此刻起，跬步千里](https://lobehub.com/zh/blog/knowledge-base) 了解详情。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-privoder]][docs-feat-provider]

### [多模型服务商支持][docs-feat-provider]

在 LobeHub 的不断发展过程中，我们深刻理解到在提供 AI 会话服务时模型服务商的多样性对于满足社区需求的重要性。因此，我们不再局限于单一的模型服务商，而是拓展了对多种模型服务商的支持，以便为用户提供更为丰富和多样化的会话选择。

通过这种方式，LobeHub 能够更灵活地适应不同用户的需求，同时也为开发者提供了更为广泛的选择空间。

#### 已支持的模型服务商

我们已经实现了对以下模型服务商的支持：

<!-- PROVIDER LIST -->

<details><summary><kbd>See more providers (+-10)</kbd></summary>

</details>

> 📊 Total providers: [<kbd>**0**</kbd>](https://lobechat.com/discover/providers)

 <!-- PROVIDER LIST -->

同时，我们也在计划支持更多的模型服务商，以进一步丰富我们的服务商库。如果你希望让 LobeHub 支持你喜爱的服务商，欢迎加入我们的 [💬 社区讨论](https://github.com/lobehub/lobehub/discussions/6157)。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-local]][docs-feat-local]

### [支持本地大语言模型 (LLM)][docs-feat-local]

为了满足特定用户的需求，LobeHub 还基于 [Ollama](https://ollama.ai) 支持了本地模型的使用，让用户能够更灵活地使用自己的或第三方的模型。

> \[!TIP]
>
> 查阅 [📘 在 LobeHub 中使用 Ollama][docs-usage-ollama] 获得更多信息

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-vision]][docs-feat-vision]

### [模型视觉识别 (Model Visual)][docs-feat-vision]

LobeHub 已经支持 OpenAI 最新的 [`gpt-4-vision`](https://platform.openai.com/docs/guides/vision) 支持视觉识别的模型，这是一个具备视觉识别能力的多模态应用。
用户可以轻松上传图片或者拖拽图片到对话框中，助手将能够识别图片内容，并在此基础上进行智能对话，构建更智能、更多元化的聊天场景。

这一特性打开了新的互动方式，使得交流不再局限于文字，而是可以涵盖丰富的视觉元素。无论是日常使用中的图片分享，还是在特定行业内的图像解读，助手都能提供出色的对话体验。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-tts]][docs-feat-tts]

### [TTS & STT 语音会话][docs-feat-tts]

LobeHub 支持文字转语音（Text-to-Speech，TTS）和语音转文字（Speech-to-Text，STT）技术，这使得我们的应用能够将文本信息转化为清晰的语音输出，用户可以像与真人交谈一样与我们的对话助手进行交流。
用户可以从多种声音中选择，给助手搭配合适的音源。 同时，对于那些倾向于听觉学习或者想要在忙碌中获取信息的用户来说，TTS 提供了一个极佳的解决方案。

在 LobeHub 中，我们精心挑选了一系列高品质的声音选项 (OpenAI Audio, Microsoft Edge Speech)，以满足不同地域和文化背景用户的需求。用户可以根据个人喜好或者特定场景来选择合适的语音，从而获得个性化的交流体验。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-t2i]][docs-feat-t2i]

### [Text to Image 文生图][docs-feat-t2i]

支持最新的文本到图片生成技术，LobeHub 现在能够让用户在与助手对话中直接调用文生图工具进行创作。
通过利用 [`DALL-E 3`](https://openai.com/dall-e-3)、[`MidJourney`](https://www.midjourney.com/) 和 [`Pollinations`](https://pollinations.ai/) 等 AI 工具的能力， 助手们现在可以将你的想法转化为图像。
同时可以更私密和沉浸式地完成你的创作过程。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-plugin]][docs-feat-plugin]

### [插件系统 (Tools Calling)][docs-feat-plugin]

LobeHub 的插件生态系统是其核心功能的重要扩展，它极大地增强了 ChatGPT 的实用性和灵活性。

<video controls src="https://github.com/lobehub/lobehub/assets/28616219/f29475a3-f346-4196-a435-41a6373ab9e2" muted="false"></video>

通过利用插件，ChatGPT 能够实现实时信息的获取和处理，例如自动获取最新新闻头条，为用户提供即时且相关的资讯。

此外，这些插件不仅局限于新闻聚合，还可以扩展到其他实用的功能，如快速检索文档、生成图象、获取电商平台数据，以及其他各式各样的第三方服务。

> 通过文档了解更多 [📘 插件使用][docs-usage-plugin]

<!-- PLUGIN LIST -->

| 最近新增                                                                                                             | 描述                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [购物工具](https://lobechat.com/discover/plugin/ShoppingTools)<br/><sup>By **shoppingtools** on **2026-01-12**</sup> | 在 eBay 和 AliExpress 上搜索产品，查找 eBay 活动和优惠券。获取快速示例。<br/>`购物` `e-bay` `ali-express` `优惠券` |
| [SEO 助手](https://lobechat.com/discover/plugin/seo_assistant)<br/><sup>By **webfx** on **2026-01-12**</sup>         | SEO 助手可以生成搜索引擎关键词信息，以帮助创建内容。<br/>`seo` `关键词`                                            |
| [视频字幕](https://lobechat.com/discover/plugin/VideoCaptions)<br/><sup>By **maila** on **2025-12-13**</sup>         | 将 Youtube 链接转换为转录文本，使其能够提问，创建章节，并总结其内容。<br/>`视频转文字` `you-tube`                  |
| [天气 GPT](https://lobechat.com/discover/plugin/WeatherGPT)<br/><sup>By **steven-tey** on **2025-12-13**</sup>       | 获取特定位置的当前天气信息。<br/>`天气`                                                                            |

> 📊 Total plugins: [<kbd>**40**</kbd>](https://lobechat.com/discover/plugins)

 <!-- PLUGIN LIST -->

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-agent]][docs-feat-agent]

### [助手市场 (GPTs)][docs-feat-agent]

在 LobeHub 的助手市场中，创作者们可以发现一个充满活力和创新的社区，它汇聚了众多精心设计的助手，这些助手不仅在工作场景中发挥着重要作用，也在学习过程中提供了极大的便利。
我们的市场不仅是一个展示平台，更是一个协作的空间。在这里，每个人都可以贡献自己的智慧，分享个人开发的助手。

> \[!TIP]
>
> 通过 [🤖/🏪 提交助手][submit-agents-link] ，你可以轻松地将你的助手作品提交到我们的平台。我们特别强调的是，LobeHub 建立了一套精密的自动化国际化（i18n）工作流程， 它的强大之处在于能够无缝地将你的助手转化为多种语言版本。
> 这意味着，不论你的用户使用何种语言，他们都能无障碍地体验到你的助手。

> \[!IMPORTANT]
>
> 我欢迎所有用户加入这个不断成长的生态系统，共同参与到助手的迭代与优化中来。共同创造出更多有趣、实用且具有创新性的助手，进一步丰富助手的多样性和实用性。

<!-- AGENT LIST -->

| 最近新增                                                                                                                                                         | 描述                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [海龟汤主持人](https://lobechat.com/discover/assistant/lateral-thinking-puzzle)<br/><sup>By **[CSY2022](https://github.com/CSY2022)** on **2025-06-19**</sup>    | 一个海龟汤主持人，需要自己提供汤面，汤底与关键点（猜中的判定条件）。<br/>`海龟汤` `推理` `互动` `谜题` `角色扮演` |
| [学术写作助手](https://lobechat.com/discover/assistant/academic-writing-assistant)<br/><sup>By **[swarfte](https://github.com/swarfte)** on **2025-06-17**</sup> | 专业的学术研究论文写作和正式文档编写专家<br/>`学术写作` `研究` `正式风格`                                         |
| [美食评论员🍟](https://lobechat.com/discover/assistant/food-reviewer)<br/><sup>By **[renhai-lab](https://github.com/renhai-lab)** on **2025-06-17**</sup>        | 美食评价专家<br/>`美食` `评价` `写作`                                                                             |
| [Minecraft 资深开发者](https://lobechat.com/discover/assistant/java-development)<br/><sup>By **[iamyuuk](https://github.com/iamyuuk)** on **2025-06-17**</sup>   | 擅长高级 Java 开发及 Minecraft 开发<br/>`开发` `编程` `minecraft` `java`                                          |

> 📊 Total agents: [<kbd>**505**</kbd> ](https://lobechat.com/discover/assistants)

 <!-- AGENT LIST -->

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-database]][docs-feat-database]

### [支持本地 / 远程数据库][docs-feat-database]

LobeHub 支持同时使用服务端数据库和本地数据库。根据您的需求，您可以选择合适的部署方案：

- 本地数据库：适合希望对数据有更多掌控感和隐私保护的用户。LobeHub 采用了 CRDT (Conflict-Free Replicated Data Type) 技术，实现了多端同步功能。这是一项实验性功能，旨在提供无缝的数据同步体验。
- 服务端数据库：适合希望更便捷使用体验的用户。LobeHub 支持 PostgreSQL 作为服务端数据库。关于如何配置服务端数据库的详细文档，请前往 [配置服务端数据库](https://lobehub.com/zh/docs/self-hosting/advanced/server-database)。

无论您选择哪种数据库，LobeHub 都能为您提供卓越的用户体验。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-auth]][docs-feat-auth]

### [支持多用户管理][docs-feat-auth]

LobeHub 支持多用户管理，提供了灵活的用户认证方案：

- **Better Auth**：LobeHub 集成了 `Better Auth`，一个现代化且灵活的身份验证库，支持多种身份验证方式，包括 OAuth、邮件登录、凭证登录、魔法链接等。通过 `Better Auth`，您可以轻松实现用户的注册、登录、会话管理、社交登录、多因素认证 (MFA) 等功能，确保用户数据的安全性和隐私性。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-pwa]][docs-feat-pwa]

### [渐进式 Web 应用 (PWA)][docs-feat-pwa]

我们深知在当今多设备环境下为用户提供无缝体验的重要性。为此，我们采用了渐进式 Web 应用 [PWA](https://support.google.com/chrome/answer/9658361) 技术，
这是一种能够将网页应用提升至接近原生应用体验的现代 Web 技术。通过 PWA，LobeHub 能够在桌面和移动设备上提供高度优化的用户体验，同时保持轻量级和高性能的特点。
在视觉和感觉上，我们也经过精心设计，以确保它的界面与原生应用无差别，提供流畅的动画、响应式布局和适配不同设备的屏幕分辨率。

> \[!NOTE]
>
> 若您未熟悉 PWA 的安装过程，您可以按照以下步骤将 LobeHub 添加为您的桌面应用（也适用于移动设备）：
>
> - 在电脑上运行 Chrome 或 Edge 浏览器 .
> - 访问 LobeHub 网页 .
> - 在地址栏的右上角，单击 <kbd>安装</kbd> 图标 .

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-mobile]][docs-feat-mobile]

### [移动设备适配][docs-feat-mobile]

针对移动设备进行了一系列的优化设计，以提升用户的移动体验。目前，我们正在对移动端的用户体验进行版本迭代，以实现更加流畅和直观的交互。如果您有任何建议或想法，我们非常欢迎您通过 GitHub Issues 或者 Pull Requests 提供反馈。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-theme]][docs-feat-theme]

### [自定义主题][docs-feat-theme]

作为设计工程师出身，LobeHub 在界面设计上充分考虑用户的个性化体验，因此引入了灵活多变的主题模式，其中包括日间的亮色模式和夜间的深色模式。
除了主题模式的切换，还提供了一系列的颜色定制选项，允许用户根据自己的喜好来调整应用的主题色彩。无论是想要沉稳的深蓝，还是希望活泼的桃粉，或者是专业的灰白，用户都能够在 LobeHub 中找到匹配自己风格的颜色选择。

> \[!TIP]
>
> 默认配置能够智能地识别用户系统的颜色模式，自动进行主题切换，以确保应用界面与操作系统保持一致的视觉体验。对于喜欢手动调控细节的用户，LobeHub 同样提供了直观的设置选项，针对聊天场景也提供了对话气泡模式和文档模式的选择。

<div align="right">

<div align="right">

[![][back-to-top]](#readme-top)

</div>

</div>

### `*` 更多特性

除了上述功能特性以外，LobeHub 所具有的设计和技术能力将为你带来更多使用保障：

- [x] 💎 **精致 UI 设计**：经过精心设计的界面，具有优雅的外观和流畅的交互效果，支持亮暗色主题，适配移动端。支持 PWA，提供更加接近原生应用的体验。
- [x] 🗣️ **流畅的对话体验**：流式响应带来流畅的对话体验，并且支持完整的 Markdown 渲染，包括代码高亮、LaTex 公式、Mermaid 流程图等。
- [x] 💨 **快速部署**：使用 Vercel 平台或者我们的 Docker 镜像，只需点击一键部署按钮，即可在 1 分钟内完成部署，无需复杂的配置过程。
- [x] 🔒 **隐私安全**：所有数据保存在用户浏览器本地，保证用户的隐私安全。
- [x] 🌐 **自定义域名**：如果用户拥有自己的域名，可以将其绑定到平台上，方便在任何地方快速访问对话助手。

</details>

> ✨ 随着产品迭代持续更新，我们将会带来更多更多令人激动的功能！

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🛳 开箱即用

LobeHub 提供了 Vercel 的 自托管版本 和 [Docker 镜像][docker-release-link]，这使你可以在几分钟内构建自己的聊天机器人，无需任何基础知识。

> \[!TIP]
>
> 完整教程请查阅 [📘 构建属于自己的 LobeHub][docs-self-hosting]

### `A` 使用 Vercel、Zeabur 、Sealos 或 阿里云计算巢 部署

如果想在 Vercel 、 Zeabur 或 阿里云 上部署该服务，可以按照以下步骤进行操作：

- 准备好你的 [OpenAI API Key](https://platform.openai.com/account/api-keys) 。
- 点击下方按钮开始部署： 直接使用 GitHub 账号登录即可，记得在环境变量页填入 `OPENAI_API_KEY` （必填）；
- 部署完毕后，即可开始使用；
- 绑定自定义域名（可选）：Vercel 分配的域名 DNS 在某些区域被污染了，绑定自定义域名即可直连。目前 Zeabur 提供的域名还未被污染，大多数地区都可以直连。

<div align="center">

|            使用 Vercel 部署             |                      使用 Zeabur 部署                       |                      使用 Sealos 部署                       |                           使用阿里云计算巢部署                            |
| :-------------------------------------: | :---------------------------------------------------------: | :---------------------------------------------------------: | :-----------------------------------------------------------------------: |
| [![][deploy-button-image]][deploy-link] | [![][deploy-on-zeabur-button-image]][deploy-on-zeabur-link] | [![][deploy-on-sealos-button-image]][deploy-on-sealos-link] | [![][deploy-on-alibaba-cloud-button-image]][deploy-on-alibaba-cloud-link] |

</div>

#### Fork 之后

在 Fork 后，请只保留 "upstream sync" Action 并在你 fork 的 GitHub Repo 中禁用其他 Action。

#### 保持更新

如果你根据 README 中的一键部署步骤部署了自己的项目，你可能会发现总是被提示 "有可用更新"。这是因为 Vercel 默认为你创建新项目而非 fork 本项目，这将导致无法准确检测更新。

> \[!TIP]
>
> 我们建议按照 [📘 自动同步更新][docs-upstream-sync] 步骤重新部署。

<br/>

### `B` 使用 Docker 部署

[![][docker-release-shield]][docker-release-link]
[![][docker-size-shield]][docker-size-link]
[![][docker-pulls-shield]][docker-pulls-link]

我们提供了一个用于在您自己的私有设备上部署 LobeHub 服务的 Docker 镜像。请使用以下命令启动 LobeHub 服务：

1. 创建一个用于存储文件的文件夹

```fish
$ mkdir lobehub-db && cd lobehub-db
```

2. 启动一键脚本

```fish
bash <(curl -fsSL https://lobe.li/setup.sh) -l zh_CN
```

3. 启动 LobeHub

```fish
docker compose up -d
```

> \[!NOTE]
>
> 有关 Docker 部署的详细说明，详见 [📘 使用 Docker 部署][docs-docker]

<br/>

### 环境变量

本项目提供了一些额外的配置项，使用环境变量进行设置：

| 环境变量            | 类型 | 描述                                                                                                                          | 示例                                                                                                   |
| ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`    | 必选 | 这是你在 OpenAI 账户页面申请的 API 密钥                                                                                       | `sk-xxxxxx...xxxxxx`                                                                                   |
| `OPENAI_PROXY_URL`  | 可选 | 如果你手动配置了 OpenAI 接口代理，可以使用此配置项来覆盖默认的 OpenAI API 请求基础 URL                                        | `https://api.chatanywhere.cn` 或 `https://aihubmix.com/v1`<br/>默认值:<br/>`https://api.openai.com/v1` |
| `OPENAI_MODEL_LIST` | 可选 | 用来控制模型列表，使用 `+` 增加一个模型，使用 `-` 来隐藏一个模型，使用 `模型名=展示名` 来自定义模型的展示名，用英文逗号隔开。 | `qwen-7b-chat,+glm-6b,-gpt-3.5-turbo`                                                                  |

> \[!NOTE]
>
> 完整环境变量可见 [📘 环境变量][docs-env-var]

<br/>

### 获取 OpenAI API Key

API Key 是使用 LobeHub 进行大语言模型会话的必要信息，本节以 OpenAI 模型服务商为例，简要介绍获取 API Key 的方式。

#### `A` 通过 OpenAI 官方渠道

- 注册一个 [OpenAI 账户](https://platform.openai.com/signup)，你需要使用国际手机号、非大陆邮箱进行注册；
- 注册完毕后，前往 [API Keys](https://platform.openai.com/api-keys) 页面，点击 `Create new secret key` 创建新的 API Key:

| 步骤 1：打开创建窗口                                                                                                                               | 步骤 2：创建 API Key                                                                                                                               | 步骤 3：获取 API Key                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296253192-ff2193dd-f125-4e58-82e8-91bc376c0d68.png" height="200"/> | <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296254170-803bacf0-4471-4171-ae79-0eab08d621d1.png" height="200"/> | <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296255167-f2745f2b-f083-4ba8-bc78-9b558e0002de.png" height="200"/> |

- 将此 API Key 填写到 LobeHub 的 API Key 配置中，即可开始使用。

> \[!TIP]
>
> 账户注册后，一般有 5 美元的免费额度，但有效期只有三个月。
> 如果你希望长期使用你的 API Key，你需要完成支付的信用卡绑定。由于 OpenAI 只支持外币信用卡，因此你需要找到合适的支付渠道，此处不再详细展开。

<br/>

#### `B` 通过 OpenAI 第三方代理商

如果你发现注册 OpenAI 账户或者绑定外币信用卡比较麻烦，可以考虑借助一些知名的 OpenAI 第三方代理商来获取 API Key，这可以有效降低获取 OpenAI API Key 的门槛。但与此同时，一旦使用三方服务，你可能也需要承担潜在的风险，
请根据你自己的实际情况自行决策。以下是常见的第三方模型代理商列表，供你参考：

|                                                                                                                                                   | 服务商       | 特性说明                                                        | Proxy 代理地址            | 链接                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------- | ------------------------- | ------------------------------- |
| <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/17870709/296272721-c3ac0bf3-e433-4496-89c4-ebdc20689c17.jpg" width="48" /> | **AiHubMix** | 使用 OpenAI 企业接口，全站模型价格为官方 **86 折**（含 GPT-4 ） | `https://aihubmix.com/v1` | [获取](https://lobe.li/XHnZIUP) |

> \[!WARNING]
>
> **免责申明**: 在此推荐的 OpenAI API Key 由第三方代理商提供，所以我们不对 API Key 的 **有效性** 和 **安全性** 负责，请你自行承担购买和使用 API Key 的风险。

> \[!NOTE]
>
> 如果你是模型服务商，并认为自己的服务足够稳定且价格实惠，欢迎联系我们，我们会在自行体验和测试后酌情推荐。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 📦 生态系统

| NPM                               | 仓库                                    | 描述                                                                                     | 版本                                      |
| --------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| [@lobehub/ui][lobe-ui-link]       | [lobehub/lobe-ui][lobe-ui-github]       | 构建 AIGC 网页应用程序而设计的开源 UI 组件库                                             | [![][lobe-ui-shield]][lobe-ui-link]       |
| [@lobehub/icons][lobe-icons-link] | [lobehub/lobe-icons][lobe-icons-github] | 主流 AI / LLM 模型和公司 SVG Logo 与 Icon 合集                                           | [![][lobe-icons-shield]][lobe-icons-link] |
| [@lobehub/tts][lobe-tts-link]     | [lobehub/lobe-tts][lobe-tts-github]     | AI TTS / STT 语音合成 / 识别 React Hooks 库                                              | [![][lobe-tts-shield]][lobe-tts-link]     |
| [@lobehub/lint][lobe-lint-link]   | [lobehub/lobe-lint][lobe-lint-github]   | LobeHub 代码样式规范 ESlint，Stylelint，Commitlint，Prettier，Remark 和 Semantic Release | [![][lobe-lint-shield]][lobe-lint-link]   |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧩 插件体系

插件提供了扩展 LobeHub [Function Calling][docs-function-call] 能力的方法。可以用于引入新的 Function Calling，甚至是新的消息结果渲染方式。如果你对插件开发感兴趣，请在 Wiki 中查阅我们的 [📘 插件开发指引][docs-plugin-dev] 。

- [lobe-chat-plugins][lobe-chat-plugins]：插件索引从该仓库的 index.json 中获取插件列表并显示给用户。
- [chat-plugin-template][chat-plugin-template]：插件开发模版，你可以通过项目模版快速新建插件项目。
- [@lobehub/chat-plugin-sdk][chat-plugin-sdk]：插件 SDK 可帮助您创建出色的 LobeHub 插件。
- [@lobehub/chat-plugins-gateway][chat-plugins-gateway]：插件网关是一个后端服务，作为 LobeHub 插件的网关。我们使用 Vercel 部署此服务。主要的 API POST /api/v1/runner 被部署为 Edge Function。

> \[!NOTE]
>
> 插件系统目前正在进行重大开发。您可以在以下 Issues 中了解更多信息:
>
> - [x] [**插件一期**](https://github.com/lobehub/lobehub/issues/73): 实现插件与主体分离，将插件拆分为独立仓库维护，并实现插件的动态加载
> - [x] [**插件二期**](https://github.com/lobehub/lobehub/issues/97): 插件的安全性与使用的稳定性，更加精准地呈现异常状态，插件架构的可维护性与开发者友好
> - [x] [**插件三期**](https://github.com/lobehub/lobehub/issues/149)：更高阶与完善的自定义能力，支持插件鉴权与示例

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ⌨️ 本地开发

可以使用 GitHub Codespaces 进行在线开发：

[![][codespaces-shield]][codespaces-link]

或者使用以下命令进行本地开发：

```fish
$ git clone https://github.com/lobehub/lobehub.git
$ cd lobehub
$ pnpm install
$ pnpm run dev          # 全栈开发（Next.js + Vite SPA）
$ bun run dev:spa       # 仅 SPA 前端（端口 9876）
```

> **Debug Proxy**：运行 `dev:spa` 后，终端会输出代理 URL，如
> `https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http%3A%2F%2Flocalhost%3A9876`。
> 打开此链接可在线上环境中加载本地开发服务器，支持 HMR 热更新。

如果你希望了解更多详情，欢迎可以查阅我们的 [📘 开发指南][docs-dev-guide]

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🤝 参与贡献

我们非常欢迎各种形式的贡献。如果你对贡献代码感兴趣，可以查看我们的 GitHub [Issues][github-issues-link] 和 [Projects][github-project-link]，大展身手，向我们展示你的奇思妙想。

> \[!TIP]
>
> 我们希望创建一个技术分享型社区，一个可以促进知识共享、想法交流，激发彼此鼓励和协作的环境。
> 同时欢迎联系我们提供产品功能和使用体验反馈，帮助我们将 LobeHub 建设得更好。
>
> **组织维护者:** [@arvinxx](https://github.com/arvinxx) [@canisminor1990](https://github.com/canisminor1990)

[![][pr-welcome-shield]][pr-welcome-link]
[![][submit-agents-shield]][submit-agents-link]
[![][submit-plugin-shield]][submit-plugin-link]

<a href="https://github.com/lobehub/lobehub/graphs/contributors" target="_blank">
  <table>
    <tr>
      <th colspan="2">
        <br><img src="https://contrib.rocks/image?repo=lobehub/lobehub"><br><br>
      </th>
    </tr>
    <tr>
      <td>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://next.ossinsight.io/widgets/official/compose-org-active-contributors/thumbnail.png?activity=active&period=past_28_days&owner_id=131470832&repo_ids=643445235&image_size=2x3&color_scheme=dark">
          <img src="https://next.ossinsight.io/widgets/official/compose-org-active-contributors/thumbnail.png?activity=active&period=past_28_days&owner_id=131470832&repo_ids=643445235&image_size=2x3&color_scheme=light">
        </picture>
      </td>
      <td rowspan="2">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://next.ossinsight.io/widgets/official/compose-org-participants-growth/thumbnail.png?activity=active&period=past_28_days&owner_id=131470832&repo_ids=643445235&image_size=4x7&color_scheme=dark">
          <img src="https://next.ossinsight.io/widgets/official/compose-org-participants-growth/thumbnail.png?activity=active&period=past_28_days&owner_id=131470832&repo_ids=643445235&image_size=4x7&color_scheme=light">
        </picture>
      </td>
    </tr>
    <tr>
      <td>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://next.ossinsight.io/widgets/official/compose-org-active-contributors/thumbnail.png?activity=new&period=past_28_days&owner_id=131470832&repo_ids=643445235&image_size=2x3&color_scheme=dark">
          <img src="https://next.ossinsight.io/widgets/official/compose-org-active-contributors/thumbnail.png?activity=new&period=past_28_days&owner_id=131470832&repo_ids=643445235&image_size=2x3&color_scheme=light">
        </picture>
      </td>
    </tr>
  </table>
</a>

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ❤ 社区赞助

每一分支持都珍贵无比，汇聚成我们支持的璀璨银河！你就像一颗划破夜空的流星，瞬间点亮我们前行的道路。感谢你对我们的信任 —— 你的支持笔就像星辰导航，一次又一次地为项目指明前进的光芒。

<a href="https://opencollective.com/lobehub" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/lobehub/.github/blob/main/static/sponsor-dark.png?raw=true">
    <img  src="https://github.com/lobehub/.github/blob/main/static/sponsor-light.png?raw=true">
  </picture>
</a>

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🔗 更多工具

- **[🅰️ Lobe SD Theme][lobe-theme]:** Stable Diffusion WebUI 的现代主题，精致的界面设计，高度可定制的 UI，以及提高效率的功能。
- **[⛵️ Lobe Midjourney WebUI][lobe-midjourney-webui]:** Midjourney WebUI, 能够根据文本提示快速生成丰富多样的图像，激发创造力，增强对话交流。
- **[🌏 Lobe i18n][lobe-i18n]:** Lobe i18n 是一个由 ChatGPT 驱动的 i18n（国际化）翻译过程的自动化工具。它支持自动分割大文件、增量更新，以及为 OpenAI 模型、API 代理和温度提供定制选项的功能。
- **[💌 Lobe Commit][lobe-commit]:** Lobe Commit 是一个 CLI 工具，它利用 Langchain/ChatGPT 生成基于 Gitmoji 的提交消息。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

---

<details><summary><h4>📝 License</h4></summary>

[![][fossa-license-shield]][fossa-license-link]

</details>

Copyright © 2025 [LobeHub][profile-link]. <br />
This project is [LobeHub Community License](./LICENSE) licensed.

<!-- LINK GROUP -->

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
[blog]: https://lobehub.com/zh/blog
[changelog]: https://lobehub.com/changelog
[chat-plugin-sdk]: https://github.com/lobehub/chat-plugin-sdk
[chat-plugin-template]: https://github.com/lobehub/chat-plugin-template
[chat-plugins-gateway]: https://github.com/lobehub/chat-plugins-gateway
[codecov-link]: https://codecov.io/gh/lobehub/lobehub
[codecov-shield]: https://img.shields.io/codecov/c/github/lobehub/lobehub?labelColor=black&style=flat-square&logo=codecov&logoColor=white
[codespaces-link]: https://codespaces.new/lobehub/lobehub
[codespaces-shield]: https://github.com/codespaces/badge.svg
[deploy-button-image]: https://vercel.com/button
[deploy-link]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub&env=OPENAI_API_KEY&envDescription=Find%20your%20OpenAI%20API%20Key%20by%20click%20the%20right%20Learn%20More%20button.&envLink=https%3A%2F%2Fplatform.openai.com%2Faccount%2Fapi-keys&project-name=lobehub&repository-name=lobehub
[deploy-on-alibaba-cloud-button-image]: https://service-info-public.oss-cn-hangzhou.aliyuncs.com/computenest-en.svg
[deploy-on-alibaba-cloud-link]: https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=LobeHub%E7%A4%BE%E5%8C%BA%E7%89%88
[deploy-on-sealos-button-image]: https://raw.githubusercontent.com/labring-actions/templates/main/Deploy-on-Sealos.svg
[deploy-on-sealos-link]: https://template.hzh.sealos.run/deploy?templateName=lobehub-db
[deploy-on-zeabur-button-image]: https://zeabur.com/button.svg
[deploy-on-zeabur-link]: https://zeabur.com/templates/VZGGTI
[discord-link]: https://discord.gg/AYFPHvv2jT
[discord-shield]: https://img.shields.io/discord/1127171173982154893?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square
[discord-shield-badge]: https://img.shields.io/discord/1127171173982154893?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=for-the-badge
[docker-pulls-link]: https://hub.docker.com/r/lobehub/lobehub
[docker-pulls-shield]: https://img.shields.io/docker/pulls/lobehub/lobehub?color=45cc11&labelColor=black&style=flat-square&sort=semver
[docker-release-link]: https://hub.docker.com/r/lobehub/lobehub
[docker-release-shield]: https://img.shields.io/docker/v/lobehub/lobehub?color=369eff&label=docker&labelColor=black&logo=docker&logoColor=white&style=flat-square&sort=semver
[docker-size-link]: https://hub.docker.com/r/lobehub/lobehub
[docker-size-shield]: https://img.shields.io/docker/image-size/lobehub/lobehub?color=369eff&labelColor=black&style=flat-square&sort=semver
[docs]: https://lobehub.com/zh/docs/usage/start
[docs-dev-guide]: https://lobehub.com/docs/development/start
[docs-docker]: https://lobehub.com/zh/docs/self-hosting/server-database/docker-compose
[docs-env-var]: https://lobehub.com/docs/self-hosting/environment-variables
[docs-feat-agent]: https://lobehub.com/docs/usage/features/agent-market
[docs-feat-artifacts]: https://lobehub.com/docs/usage/features/artifacts
[docs-feat-auth]: https://lobehub.com/docs/usage/features/auth
[docs-feat-branch]: https://lobehub.com/docs/usage/features/branching-conversations
[docs-feat-cot]: https://lobehub.com/docs/usage/features/cot
[docs-feat-database]: https://lobehub.com/docs/usage/features/database
[docs-feat-knowledgebase]: https://lobehub.com/blog/knowledge-base
[docs-feat-local]: https://lobehub.com/docs/usage/features/local-llm
[docs-feat-mobile]: https://lobehub.com/docs/usage/features/mobile
[docs-feat-plugin]: https://lobehub.com/docs/usage/features/plugin-system
[docs-feat-provider]: https://lobehub.com/docs/usage/features/multi-ai-providers
[docs-feat-pwa]: https://lobehub.com/docs/usage/features/pwa
[docs-feat-t2i]: https://lobehub.com/docs/usage/features/text-to-image
[docs-feat-theme]: https://lobehub.com/docs/usage/features/theme
[docs-feat-tts]: https://lobehub.com/docs/usage/features/tts
[docs-feat-vision]: https://lobehub.com/docs/usage/features/vision
[docs-function-call]: https://lobehub.com/zh/blog/openai-function-call
[docs-plugin-dev]: https://lobehub.com/docs/usage/plugins/development
[docs-self-hosting]: https://lobehub.com/docs/self-hosting/start
[docs-upstream-sync]: https://lobehub.com/docs/self-hosting/advanced/upstream-sync
[docs-usage-ollama]: https://lobehub.com/docs/usage/providers/ollama
[docs-usage-plugin]: https://lobehub.com/docs/usage/plugins/basic
[fossa-license-link]: https://app.fossa.com/projects/git%2Bgithub.com%2Flobehub%2Flobehub
[fossa-license-shield]: https://app.fossa.com/api/projects/git%2Bgithub.com%2Flobehub%2Flobehub.svg?type=large
[github-action-release-link]: https://github.com/lobehub/lobehub/actions/workflows/release.yml
[github-action-release-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobehub/release.yml?label=release&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-action-test-link]: https://github.com/lobehub/lobehub/actions/workflows/test.yml
[github-action-test-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobehub/test.yml?label=test&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-contributors-link]: https://github.com/lobehub/lobehub/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/lobehub/lobehub?color=c4f042&labelColor=black&style=flat-square
[github-forks-link]: https://github.com/lobehub/lobehub/network/members
[github-forks-shield]: https://img.shields.io/github/forks/lobehub/lobehub?color=8ae8ff&labelColor=black&style=flat-square
[github-hello-shield]: https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=39701baf5a734cb894ec812248a5655a&claim_uid=HxYvFN34htJzGCD&theme=dark&theme=neutral&theme=dark&theme=neutral
[github-hello-url]: https://hellogithub.com/repository/39701baf5a734cb894ec812248a5655a
[github-issues-link]: https://github.com/lobehub/lobehub/issues
[github-issues-shield]: https://img.shields.io/github/issues/lobehub/lobehub?color=ff80eb&labelColor=black&style=flat-square
[github-license-link]: https://github.com/lobehub/lobehub/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/badge/license-apache%202.0-white?labelColor=black&style=flat-square
[github-project-link]: https://github.com/lobehub/lobehub/projects
[github-release-link]: https://github.com/lobehub/lobehub/releases
[github-release-shield]: https://img.shields.io/github/v/release/lobehub/lobehub?color=369eff&labelColor=black&logo=github&style=flat-square
[github-releasedate-link]: https://github.com/lobehub/lobehub/releases
[github-releasedate-shield]: https://img.shields.io/github/release-date/lobehub/lobehub?labelColor=black&style=flat-square
[github-stars-link]: https://github.com/lobehub/lobehub/stargazers
[github-stars-shield]: https://github.com/user-attachments/assets/3216e25b-186f-4a54-9cb4-2f124aec0471
[github-trending-shield]: https://trendshift.io/api/badge/repositories/2256
[github-trending-url]: https://trendshift.io/repositories/2256
[image-banner]: https://github.com/user-attachments/assets/0fe626a3-0ddc-4f67-b595-3c5b3f1701e0
[image-feat-agent]: https://github.com/user-attachments/assets/b3ab6e35-4fbc-468d-af10-e3e0c687350f
[image-feat-artifacts]: https://github.com/user-attachments/assets/7f95fad6-b210-4e6e-84a0-7f39e96f3a00
[image-feat-auth]: https://github.com/user-attachments/assets/80bb232e-19d1-4f97-98d6-e291f3585e6d
[image-feat-branch]: https://github.com/user-attachments/assets/92f72082-02bd-4835-9c54-b089aad7fd41
[image-feat-cot]: https://github.com/user-attachments/assets/f74f1139-d115-4e9c-8c43-040a53797a5e
[image-feat-database]: https://github.com/user-attachments/assets/f1697c8b-d1fb-4dac-ba05-153c6295d91d
[image-feat-desktop]: https://github.com/user-attachments/assets/a7bac8d3-ea96-4000-bb39-fadc9b610f96
[image-feat-knowledgebase]: https://github.com/user-attachments/assets/7da7a3b2-92fd-4630-9f4e-8560c74955ae
[image-feat-local]: https://github.com/user-attachments/assets/1239da50-d832-4632-a7ef-bd754c0f3850
[image-feat-mcp-market]: https://github.com/user-attachments/assets/bb114f9f-24c5-4000-a984-c10d187da5a0
[image-feat-mobile]: https://github.com/user-attachments/assets/32cf43c4-96bd-4a4c-bfb6-59acde6fe380
[image-feat-plugin]: https://github.com/user-attachments/assets/66a891ac-01b6-4e3f-b978-2eb07b489b1b
[image-feat-privoder]: https://github.com/user-attachments/assets/e553e407-42de-4919-977d-7dbfcf44a821
[image-feat-pwa]: https://github.com/user-attachments/assets/9647f70f-b71b-43b6-9564-7cdd12d1c24d
[image-feat-t2i]: https://github.com/user-attachments/assets/708274a7-2458-494b-a6ec-b73dfa1fa7c2
[image-feat-theme]: https://github.com/user-attachments/assets/b47c39f1-806f-492b-8fcb-b0fa973937c1
[image-feat-tts]: https://github.com/user-attachments/assets/50189597-2cc3-4002-b4c8-756a52ad5c0a
[image-feat-vision]: https://github.com/user-attachments/assets/18574a1f-46c2-4cbc-af2c-35a86e128a07
[image-feat-web-search]: https://github.com/user-attachments/assets/cfdc48ac-b5f8-4a00-acee-db8f2eba09ad
[image-star]: https://github.com/user-attachments/assets/c3b482e7-cef5-4e94-bef9-226900ecfaab
[issues-link]: https://img.shields.io/github/issues/lobehub/lobehub.svg?style=flat
[lobe-chat-plugins]: https://github.com/lobehub/lobe-chat-plugins
[lobe-commit]: https://github.com/lobehub/lobe-commit/tree/master/packages/lobe-commit
[lobe-i18n]: https://github.com/lobehub/lobe-commit/tree/master/packages/lobe-i18n
[lobe-icons-github]: https://github.com/lobehub/lobe-icons
[lobe-icons-link]: https://www.npmjs.com/package/@lobehub/icons
[lobe-icons-shield]: https://img.shields.io/npm/v/@lobehub/icons?color=369eff&labelColor=black&logo=npm&logoColor=white&style=flat-square
[lobe-lint-github]: https://github.com/lobehub/lobe-lint
[lobe-lint-link]: https://www.npmjs.com/package/@lobehub/lint
[lobe-lint-shield]: https://img.shields.io/npm/v/@lobehub/lint?color=369eff&labelColor=black&logo=npm&logoColor=white&style=flat-square
[lobe-midjourney-webui]: https://github.com/lobehub/lobe-midjourney-webui
[lobe-theme]: https://github.com/lobehub/sd-webui-lobe-theme
[lobe-tts-github]: https://github.com/lobehub/lobe-tts
[lobe-tts-link]: https://www.npmjs.com/package/@lobehub/tts
[lobe-tts-shield]: https://img.shields.io/npm/v/@lobehub/tts?color=369eff&labelColor=black&logo=npm&logoColor=white&style=flat-square
[lobe-ui-github]: https://github.com/lobehub/lobe-ui
[lobe-ui-link]: https://www.npmjs.com/package/@lobehub/ui
[lobe-ui-shield]: https://img.shields.io/npm/v/@lobehub/ui?color=369eff&labelColor=black&logo=npm&logoColor=white&style=flat-square
[official-site]: https://lobehub.com
[pr-welcome-link]: https://github.com/lobehub/lobehub/pulls
[pr-welcome-shield]: https://img.shields.io/badge/🤯_pr_welcome-%E2%86%92-ffcb47?labelColor=black&style=for-the-badge
[profile-link]: https://github.com/lobehub
[share-mastodon-link]: https://mastodon.social/share?text=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source,%20extensible%20(Function%20Calling),%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT/LLM%20web%20application.%20https://github.com/lobehub/lobehub%20#chatbot%20#chatGPT%20#openAI
[share-mastodon-shield]: https://img.shields.io/badge/-share%20on%20mastodon-black?labelColor=black&logo=mastodon&logoColor=white&style=flat-square
[share-reddit-link]: https://www.reddit.com/submit?title=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-reddit-shield]: https://img.shields.io/badge/-share%20on%20reddit-black?labelColor=black&logo=reddit&logoColor=white&style=flat-square
[share-telegram-link]: https://t.me/share/url"?text=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-telegram-shield]: https://img.shields.io/badge/-share%20on%20telegram-black?labelColor=black&logo=telegram&logoColor=white&style=flat-square
[share-weibo-link]: http://service.weibo.com/share/share.php?sharesource=weibo&title=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-weibo-shield]: https://img.shields.io/badge/-share%20on%20weibo-black?labelColor=black&logo=sinaweibo&logoColor=white&style=flat-square
[share-whatsapp-link]: https://api.whatsapp.com/send?text=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub%20%23chatbot%20%23chatGPT%20%23openAI
[share-whatsapp-shield]: https://img.shields.io/badge/-share%20on%20whatsapp-black?labelColor=black&logo=whatsapp&logoColor=white&style=flat-square
[share-x-link]: https://x.com/intent/tweet?hashtags=chatbot%2CchatGPT%2CopenAI&text=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-x-shield]: https://img.shields.io/badge/-share%20on%20x-black?labelColor=black&logo=x&logoColor=white&style=flat-square
[sponsor-link]: https://opencollective.com/lobehub 'Become ❤ LobeHub Sponsor'
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20LobeHub-f04f88?logo=opencollective&logoColor=white&style=flat-square
[submit-agents-link]: https://github.com/lobehub/lobe-chat-agents
[submit-agents-shield]: https://img.shields.io/badge/🤖/🏪_submit_agent-%E2%86%92-c4f042?labelColor=black&style=for-the-badge
[submit-plugin-link]: https://github.com/lobehub/lobe-chat-plugins
[submit-plugin-shield]: https://img.shields.io/badge/🧩/🏪_submit_plugin-%E2%86%92-95f3d9?labelColor=black&style=for-the-badge
[vercel-link]: https://chat-preview.lobehub.com
[vercel-shield]: https://img.shields.io/badge/vercel-online-55b467?labelColor=black&logo=vercel&style=flat-square
