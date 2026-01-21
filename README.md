<div align="center"><a name="readme-top"></a>
  
[![][image-banner]][vercel-link]

# LobeHub

Open-source AI agent workspace. Deploy your own ChatGPT/Claude/Gemini/Ollama instance in one click.

**English** · [简体中文](./README.zh-CN.md) · [Official Site][official-site] · [Changelog][changelog] · [Documents][docs] · [Blog][blog] · [Feedback][github-issues-link]

<!-- SHIELD GROUP -->

[![][github-release-shield]][github-release-link]
[![][docker-release-shield]][docker-release-link]
[![][vercel-shield]][vercel-link]
[![][discord-shield]][discord-link]
[![][codecov-shield]][codecov-link]
[![][github-contributors-shield]][github-contributors-link]
[![][sponsor-shield]][sponsor-link]

[![][github-trending-shield]][github-trending-url] <br /> <br /> <a href="https://vercel.com/oss"> <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" /> </a>

</div>

<details>
<summary><kbd>Table of contents</kbd></summary>

#### TOC

- [👋🏻 Getting Started](#-getting-started--join-our-community)
- [✨ Features](#-features)
  - [✨ MCP Plugin One-Click Installation](#-mcp-plugin-one-click-installation)
  - [🏪 MCP Marketplace](#-mcp-marketplace)
  - [🖥️ Desktop App](#️-desktop-app)
  - [🌐 Smart Internet Search](#-smart-internet-search)
  - [Chain of Thought](#chain-of-thought)
  - [Branching Conversations](#branching-conversations)
  - [Artifacts Support](#artifacts-support)
  - [File Upload /Knowledge Base](#file-upload-knowledge-base)
  - [Multi-Model Service Provider Support](#multi-model-service-provider-support)
  - [Local Large Language Model (LLM) Support](#local-large-language-model-llm-support)
  - [Model Visual Recognition](#model-visual-recognition)
  - [TTS & STT Voice Conversation](#tts--stt-voice-conversation)
  - [Text to Image Generation](#text-to-image-generation)
  - [Plugin System (Function Calling)](#plugin-system-function-calling)
  - [Agent Market (GPTs)](#agent-market-gpts)
  - [Support Local / Remote Database](#support-local--remote-database)
  - [Support Multi-User Management](#support-multi-user-management)
  - [Progressive Web App (PWA)](#progressive-web-app-pwa)
  - [Mobile Device Adaptation](#mobile-device-adaptation)
  - [Custom Themes](#custom-themes)
  - [`*` What's more](#-whats-more)
- [⚡️ Performance](#️-performance)
- [🛳 Self Hosting](#-self-hosting)
  - [`A` Deploying with Vercel, Zeabur , Sealos or Alibaba Cloud](#a-deploying-with-vercel-zeabur--sealos-or-alibaba-cloud)
  - [`B` Deploying with Docker](#b-deploying-with-docker)
  - [Environment Variable](#environment-variable)
- [📦 Ecosystem](#-ecosystem)
- [🧩 Plugins](#-plugins)
- [⌨️ Local Development](#️-local-development)
- [🤝 Contributing](#-contributing)
- [❤️ Sponsor](#️-sponsor)
- [🔗 More Products](#-more-products)

####

<br/>

</details>

## 👋🏻 Getting Started

You can try our [cloud version](vercel-link) now. No installation required.

Or continue explore our features below, and [self-host](#-self-hosting) your own one.

<details>
  <summary><kbd>Star History</kbd></summary>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lobehub%2Flobe-chat&theme=dark&type=Date">
    <img width="100%" src="https://api.star-history.com/svg?repos=lobehub%2Flobe-chat&type=Date">
  </picture>
</details>

## ✨ Features

[![][image-overview]][vercel-link]

<table>
<tr>
<td width="50%" valign="top">

![][image-feat-mcp]

#### ✨ MCP Plugin One-Click Installation

Connect your AI to external tools, databases, APIs, and services through the Model Context Protocol. Install MCP plugins with one click to extend LobeHub's capabilities.

</td>
<td width="50%" valign="top">

![][image-feat-mcp-market]

#### 🏪 MCP Marketplace

Browse and install MCP plugins from [lobehub.com/mcp](https://lobehub.com/mcp). Integrations for productivity tools, development environments, and third-party services.

</td>
</tr>
<tr>
<td width="50%" valign="top">

![][image-feat-desktop]

#### 🖥️ Desktop App

Native desktop application with better performance, resource management, and offline capabilities. No browser required.

</td>
<td width="50%" valign="top">

![][image-feat-web-search]

#### 🌐 Smart Internet Search

Real-time web search integration. Access current news, data, and information directly in your conversations.

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-branch]][docs-feat-branch]

#### [Branching Conversations][docs-feat-branch]

Fork conversations from any message. Explore multiple directions while preserving context.

- **Continuation Mode:** Extend discussions with full context
- **Standalone Mode:** Start fresh from any message

</td>
<td width="50%" valign="top">

[![][image-feat-artifacts]][docs-feat-artifacts]

#### [Artifacts Support][docs-feat-artifacts]

Generate and render content in real-time:

- Dynamic SVG graphics
- Interactive HTML pages
- Documents in multiple formats

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-knowledgebase]][docs-feat-knowledgebase]

#### [File Upload / Knowledge Base][docs-feat-knowledgebase]

Upload documents, images, audio, and video. Create searchable knowledge bases and reference files directly in conversations.

> Learn more on [📘 LobeChat Knowledge Base Launch](https://lobehub.com/blog/knowledge-base)

</td>
<td width="50%" valign="top">

[![][image-feat-privoder]][docs-feat-provider]

#### [Multi-Model Provider Support][docs-feat-provider]

Use multiple AI providers in one interface. Switch between models based on your needs.

<!-- PROVIDER LIST -->

> 📊 Total providers: [<kbd>**0**</kbd>](https://lobechat.com/discover/providers)

<!-- PROVIDER LIST -->

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-local]][docs-feat-local]

#### [Local LLM Support][docs-feat-local]

Run local models via [Ollama](https://ollama.ai). Full privacy with on-device inference.

> Learn more about [📘 Using Ollama in LobeChat][docs-usage-ollama]

</td>
<td width="50%" valign="top">

[![][image-feat-t2i]][docs-feat-t2i]

#### [Text to Image Generation][docs-feat-t2i]

Generate images directly in chat using [`DALL-E 3`](https://openai.com/dall-e-3), [`MidJourney`](https://www.midjourney.com/), and [`Pollinations`](https://pollinations.ai/).

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-plugin]][docs-feat-plugin]

#### [Plugin System (Function Calling)][docs-feat-plugin]

Extend LobeHub with plugins for real-time data, web search, document search, image generation, and third-party service integrations.

<!-- PLUGIN LIST -->

> 📊 Total plugins: [<kbd>**40**</kbd>](https://lobechat.com/discover/plugins)

<!-- PLUGIN LIST -->

</td>
<td width="50%" valign="top">

[![][image-feat-agent]][docs-feat-agent]

#### [Agent Market][docs-feat-agent]

Browse and use community-built agents. Create and share your own.

<!-- AGENT LIST -->

> 📊 Total agents: [<kbd>**505**</kbd>](https://lobechat.com/discover/assistants)

<!-- AGENT LIST -->

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-database]][docs-feat-database]

#### [Local / Remote Database][docs-feat-database]

Choose your data storage:

- **Local database**: Browser-based with CRDT sync across devices
- **Server-side database**: PostgreSQL for team deployments

</td>
<td width="50%" valign="top">

[![][image-feat-auth]][docs-feat-auth]

#### [Multi-User Management][docs-feat-auth]

Two authentication options:

- **next-auth**: OAuth, email, credentials
- [**Clerk**](https://go.clerk.com/exgqLG0): MFA, user profiles, activity monitoring

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-pwa]][docs-feat-pwa]

#### [Progressive Web App (PWA)][docs-feat-pwa]

Install as a native app on desktop and mobile via [PWA](https://support.google.com/chrome/answer/9658361). Offline support, fast loading, native-like experience.

</td>
<td width="50%" valign="top">

[![][image-feat-mobile]][docs-feat-mobile]

#### [Mobile Device Adaptation][docs-feat-mobile]

Responsive design optimized for mobile. Share feedback via [GitHub Issues][github-issues-link].

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![][image-feat-theme]][docs-feat-theme]

#### [Custom Themes][docs-feat-theme]

Light/dark mode with custom color schemes. Auto-detects system preferences. Choose between chat bubble and document display modes.

</td>
<td width="50%" valign="top">

</td>
</tr>
</table>

[![][back-to-top]](#readme-top)

### `*` What's more

- [x] 💨 **Quick Deployment**: One-click deploy via Vercel or Docker
- [x] 🌐 **Custom Domain**: Bind your own domain
- [x] 🔒 **Privacy**: Local-first data storage
- [x] 💎 **Modern UI**: Light/dark themes, mobile-friendly, PWA support
- [x] 🗣️ **Rich Content**: Markdown, code highlighting, LaTeX, Mermaid diagrams

---

> \[!NOTE]
>
> You can find our upcoming [Roadmap][github-project-link] plans in the Projects section.

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ⚡️ Performance

> \[!NOTE]
>
> The complete list of reports can be found in the [📘 Lighthouse Reports][docs-lighthouse]

|                   Desktop                   |                   Mobile                   |
| :-----------------------------------------: | :----------------------------------------: |
|              ![][chat-desktop]              |              ![][chat-mobile]              |
| [📑 Lighthouse Report][chat-desktop-report] | [📑 Lighthouse Report][chat-mobile-report] |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🛳 Self Hosting

Deploy via Vercel, Alibaba Cloud, or [Docker][docker-release-link]. See [📘 Self-Hosting Guide][docs-self-hosting].

### `A` Deploying with Vercel, Zeabur, Sealos or Alibaba Cloud

1. Get your [OpenAI API Key](https://platform.openai.com/account/api-keys)
2. Click deploy button below
3. Set `OPENAI_API_KEY` (required) and `ACCESS_CODE` (recommended)
4. Optionally bind a custom domain

<div align="center">

|           Deploy with Vercel            |                     Deploy with Zeabur                      |                     Deploy with Sealos                      |                       Deploy with RepoCloud                       |                         Deploy with Alibaba Cloud                         |
| :-------------------------------------: | :---------------------------------------------------------: | :---------------------------------------------------------: | :---------------------------------------------------------------: | :-----------------------------------------------------------------------: |
| [![][deploy-button-image]][deploy-link] | [![][deploy-on-zeabur-button-image]][deploy-on-zeabur-link] | [![][deploy-on-sealos-button-image]][deploy-on-sealos-link] | [![][deploy-on-repocloud-button-image]][deploy-on-repocloud-link] | [![][deploy-on-alibaba-cloud-button-image]][deploy-on-alibaba-cloud-link] |

</div>

#### After Fork

After fork, only retain the upstream sync action and disable other actions in your repository on GitHub.

#### Keep Updated

Seeing "updates available" prompts? See [📘 Auto Sync With Latest][docs-upstream-sync] for proper fork setup.

<br/>

### `B` Deploying with Docker

[![][docker-release-shield]][docker-release-link]
[![][docker-size-shield]][docker-size-link]
[![][docker-pulls-shield]][docker-pulls-link]

Deploy on your own hardware:

1. Create storage folder

```fish
$ mkdir lobe-chat-db && cd lobe-chat-db
```

2. Initialize

```fish
bash <(curl -fsSL https://lobe.li/setup.sh)
```

3. Start

```fish
docker compose up -d
```

See [📘 Docker Deployment Guide][docs-docker] for details.

<br/>

### Environment Variable

| Environment Variable | Required | Description                             | Example                               |
| -------------------- | -------- | --------------------------------------- | ------------------------------------- |
| `OPENAI_API_KEY`     | Yes      | OpenAI API key                          | `sk-xxxxxx...xxxxxx`                  |
| `OPENAI_PROXY_URL`   | No       | Custom API endpoint                     | `https://api.openai.com/v1`           |
| `ACCESS_CODE`        | No       | Access password (comma-separated)       | `password1,password2`                 |
| `OPENAI_MODEL_LIST`  | No       | Model list config (`+`/`-` to add/hide) | `qwen-7b-chat,+glm-6b,-gpt-3.5-turbo` |

Full list: [📘 Environment Variables][docs-env-var]

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 📦 Ecosystem

| NPM                               | Repository                              | Description         | Version                                   |
| --------------------------------- | --------------------------------------- | ------------------- | ----------------------------------------- |
| [@lobehub/ui][lobe-ui-link]       | [lobehub/lobe-ui][lobe-ui-github]       | AIGC UI components  | [![][lobe-ui-shield]][lobe-ui-link]       |
| [@lobehub/icons][lobe-icons-link] | [lobehub/lobe-icons][lobe-icons-github] | AI/LLM brand icons  | [![][lobe-icons-shield]][lobe-icons-link] |
| [@lobehub/tts][lobe-tts-link]     | [lobehub/lobe-tts][lobe-tts-github]     | TTS/STT React Hooks | [![][lobe-tts-shield]][lobe-tts-link]     |
| [@lobehub/lint][lobe-lint-link]   | [lobehub/lobe-lint][lobe-lint-github]   | Lint configs        | [![][lobe-lint-shield]][lobe-lint-link]   |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧩 Plugins

Extend LobeHub with [Function Calling][docs-function-call]. See [📘 Plugin Development Guide][docs-plugin-dev].

- [lobe-chat-plugins][lobe-chat-plugins]: Plugin index
- [chat-plugin-template][chat-plugin-template]: Starter template
- [@lobehub/chat-plugin-sdk][chat-plugin-sdk]: Plugin SDK
- [@lobehub/chat-plugins-gateway][chat-plugins-gateway]: Plugin gateway service

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ⌨️ Local Development

[![][codespaces-shield]][codespaces-link]

```fish
$ git clone https://github.com/lobehub/lobe-chat.git
$ cd lobe-chat
$ pnpm install
$ pnpm dev
```

See [📘 Development Guide][docs-dev-guide].

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🤝 Contributing

Check [Issues][github-issues-link] and [Projects][github-project-link] to get started.

**Maintainers:** [@arvinxx](https://github.com/arvinxx) [@canisminor1990](https://github.com/canisminor1990)

[![][pr-welcome-shield]][pr-welcome-link]
[![][submit-agents-shield]][submit-agents-link]
[![][submit-plugin-shield]][submit-plugin-link]

<a href="https://github.com/lobehub/lobe-chat/graphs/contributors" target="_blank">
  <table>
    <tr>
      <th colspan="2">
        <br><img src="https://contrib.rocks/image?repo=lobehub/lobe-chat"><br><br>
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

## ❤️ Sponsor

Support LobeHub development.

<a href="https://opencollective.com/lobehub" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/lobehub/.github/blob/main/static/sponsor-dark.png?raw=true">
    <img  src="https://github.com/lobehub/.github/blob/main/static/sponsor-light.png?raw=true">
  </picture>
</a>

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🔗 More Products

- **[🎨 Lobe Icons][lobe-theme]:** 400+ icons for AI providers and products
- **[🅰️ Lobe SD Theme][lobe-theme]:** Stable Diffusion WebUI theme
- **[⛵️ Lobe Midjourney WebUI][lobe-midjourney-webui]:** Midjourney web interface
- **[🌏 Lobe i18n][lobe-i18n]:** AI-powered i18n automation
- **[💌 Lobe Commit][lobe-commit]:** AI commit message generator

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
[blog]: https://lobehub.com/blog
[changelog]: https://lobehub.com/changelog
[chat-desktop]: https://raw.githubusercontent.com/lobehub/lobe-chat/lighthouse/lighthouse/chat/desktop/pagespeed.svg
[chat-desktop-report]: https://lobehub.github.io/lobe-chat/lighthouse/chat/desktop/chat_preview_lobehub_com_chat.html
[chat-mobile]: https://raw.githubusercontent.com/lobehub/lobe-chat/lighthouse/lighthouse/chat/mobile/pagespeed.svg
[chat-mobile-report]: https://lobehub.github.io/lobe-chat/lighthouse/chat/mobile/chat_preview_lobehub_com_chat.html
[chat-plugin-sdk]: https://github.com/lobehub/chat-plugin-sdk
[chat-plugin-template]: https://github.com/lobehub/chat-plugin-template
[chat-plugins-gateway]: https://github.com/lobehub/chat-plugins-gateway
[codecov-link]: https://codecov.io/gh/lobehub/lobe-chat
[codecov-shield]: https://img.shields.io/codecov/c/github/lobehub/lobe-chat?labelColor=black&style=flat-square&logo=codecov&logoColor=white
[codespaces-link]: https://codespaces.new/lobehub/lobe-chat
[codespaces-shield]: https://github.com/codespaces/badge.svg
[deploy-button-image]: https://vercel.com/button
[deploy-link]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat&env=OPENAI_API_KEY,ACCESS_CODE&envDescription=Find%20your%20OpenAI%20API%20Key%20by%20click%20the%20right%20Learn%20More%20button.%20%7C%20Access%20Code%20can%20protect%20your%20website&envLink=https%3A%2F%2Fplatform.openai.com%2Faccount%2Fapi-keys&project-name=lobe-chat&repository-name=lobe-chat
[deploy-on-alibaba-cloud-button-image]: https://service-info-public.oss-cn-hangzhou.aliyuncs.com/computenest-en.svg
[deploy-on-alibaba-cloud-link]: https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=LobeChat%E7%A4%BE%E5%8C%BA%E7%89%88
[deploy-on-repocloud-button-image]: https://d16t0pc4846x52.cloudfront.net/deploylobe.svg
[deploy-on-repocloud-link]: https://repocloud.io/details/?app_id=248
[deploy-on-sealos-button-image]: https://raw.githubusercontent.com/labring-actions/templates/main/Deploy-on-Sealos.svg
[deploy-on-sealos-link]: https://template.usw.sealos.io/deploy?templateName=lobe-chat-db
[deploy-on-zeabur-button-image]: https://zeabur.com/button.svg
[deploy-on-zeabur-link]: https://zeabur.com/templates/VZGGTI
[discord-link]: https://discord.gg/AYFPHvv2jT
[discord-shield]: https://img.shields.io/discord/1127171173982154893?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square
[discord-shield-badge]: https://img.shields.io/discord/1127171173982154893?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=for-the-badge
[docker-pulls-link]: https://hub.docker.com/r/lobehub/lobe-chat-database
[docker-pulls-shield]: https://img.shields.io/docker/pulls/lobehub/lobe-chat?color=45cc11&labelColor=black&style=flat-square&sort=semver
[docker-release-link]: https://hub.docker.com/r/lobehub/lobe-chat-database
[docker-release-shield]: https://img.shields.io/docker/v/lobehub/lobe-chat-database?color=369eff&label=docker&labelColor=black&logo=docker&logoColor=white&style=flat-square&sort=semver
[docker-size-link]: https://hub.docker.com/r/lobehub/lobe-chat-database
[docker-size-shield]: https://img.shields.io/docker/image-size/lobehub/lobe-chat-database?color=369eff&labelColor=black&style=flat-square&sort=semver
[docs]: https://lobehub.com/docs/usage/start
[docs-dev-guide]: https://lobehub.com/docs/development/start
[docs-docker]: https://lobehub.com/docs/self-hosting/server-database/docker-compose
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
[docs-function-call]: https://lobehub.com/blog/openai-function-call
[docs-lighthouse]: https://lobehub.com/docs/development/others/lighthouse
[docs-plugin-dev]: https://lobehub.com/docs/usage/plugins/development
[docs-self-hosting]: https://lobehub.com/docs/self-hosting/start
[docs-upstream-sync]: https://lobehub.com/docs/self-hosting/advanced/upstream-sync
[docs-usage-ollama]: https://lobehub.com/docs/usage/providers/ollama
[docs-usage-plugin]: https://lobehub.com/docs/usage/plugins/basic
[fossa-license-link]: https://app.fossa.com/projects/git%2Bgithub.com%2Flobehub%2Flobe-chat
[fossa-license-shield]: https://app.fossa.com/api/projects/git%2Bgithub.com%2Flobehub%2Flobe-chat.svg?type=large
[github-action-release-link]: https://github.com/actions/workflows/lobehub/lobe-chat/release.yml
[github-action-release-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobe-chat/release.yml?label=release&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-action-test-link]: https://github.com/actions/workflows/lobehub/lobe-chat/test.yml
[github-action-test-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobe-chat/test.yml?label=test&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-contributors-link]: https://github.com/lobehub/lobe-chat/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/lobehub/lobe-chat?color=c4f042&labelColor=black&style=flat-square
[github-forks-link]: https://github.com/lobehub/lobe-chat/network/members
[github-forks-shield]: https://img.shields.io/github/forks/lobehub/lobe-chat?color=8ae8ff&labelColor=black&style=flat-square
[github-issues-link]: https://github.com/lobehub/lobe-chat/issues
[github-issues-shield]: https://img.shields.io/github/issues/lobehub/lobe-chat?color=ff80eb&labelColor=black&style=flat-square
[github-license-link]: https://github.com/lobehub/lobe-chat/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/badge/license-apache%202.0-white?labelColor=black&style=flat-square
[github-project-link]: https://github.com/lobehub/lobe-chat/projects
[github-release-link]: https://github.com/lobehub/lobe-chat/releases
[github-release-shield]: https://img.shields.io/github/v/release/lobehub/lobe-chat?color=369eff&labelColor=black&logo=github&style=flat-square
[github-releasedate-link]: https://github.com/lobehub/lobe-chat/releases
[github-releasedate-shield]: https://img.shields.io/github/release-date/lobehub/lobe-chat?labelColor=black&style=flat-square
[github-stars-link]: https://github.com/lobehub/lobe-chat/stargazers
[github-stars-shield]: https://img.shields.io/github/stars/lobehub/lobe-chat?color=ffcb47&labelColor=black&style=flat-square
[github-trending-shield]: https://trendshift.io/api/badge/repositories/2256
[github-trending-url]: https://trendshift.io/repositories/2256
[image-banner]: https://github.com/user-attachments/assets/6f293c7f-47b4-47eb-9202-fe68a942d35b
[image-feat-agent]: https://github.com/user-attachments/assets/b3ab6e35-4fbc-468d-af10-e3e0c687350f
[image-feat-artifacts]: https://github.com/user-attachments/assets/7f95fad6-b210-4e6e-84a0-7f39e96f3a00
[image-feat-auth]: https://github.com/user-attachments/assets/80bb232e-19d1-4f97-98d6-e291f3585e6d
[image-feat-branch]: https://github.com/user-attachments/assets/92f72082-02bd-4835-9c54-b089aad7fd41
[image-feat-cot]: https://github.com/user-attachments/assets/f74f1139-d115-4e9c-8c43-040a53797a5e
[image-feat-database]: https://github.com/user-attachments/assets/f1697c8b-d1fb-4dac-ba05-153c6295d91d
[image-feat-desktop]: https://github.com/user-attachments/assets/a7bac8d3-ea96-4000-bb39-fadc9b610f96
[image-feat-knowledgebase]: https://github.com/user-attachments/assets/7da7a3b2-92fd-4630-9f4e-8560c74955ae
[image-feat-local]: https://github.com/user-attachments/assets/1239da50-d832-4632-a7ef-bd754c0f3850
[image-feat-mcp]: https://github.com/user-attachments/assets/1be85d36-3975-4413-931f-27e05e440995
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
[image-overview]: https://github.com/user-attachments/assets/dbfaa84a-2c82-4dd9-815c-5be616f264a4
[image-star]: https://github.com/user-attachments/assets/c3b482e7-cef5-4e94-bef9-226900ecfaab
[issues-link]: https://img.shields.io/github/issues/lobehub/lobe-chat.svg?style=flat
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
[pr-welcome-link]: https://github.com/lobehub/lobe-chat/pulls
[pr-welcome-shield]: https://img.shields.io/badge/🤯_pr_welcome-%E2%86%92-ffcb47?labelColor=black&style=for-the-badge
[profile-link]: https://github.com/lobehub
[sponsor-link]: https://opencollective.com/lobehub 'Become ❤️ LobeHub Sponsor'
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20LobeHub-f04f88?logo=opencollective&logoColor=white&style=flat-square
[submit-agents-link]: https://github.com/lobehub/lobe-chat-agents
[submit-agents-shield]: https://img.shields.io/badge/🤖/🏪_submit_agent-%E2%86%92-c4f042?labelColor=black&style=for-the-badge
[submit-plugin-link]: https://github.com/lobehub/lobe-chat-plugins
[submit-plugin-shield]: https://img.shields.io/badge/🧩/🏪_submit_plugin-%E2%86%92-95f3d9?labelColor=black&style=for-the-badge
[vercel-link]: https://chat-preview.lobehub.com
[vercel-shield]: https://img.shields.io/badge/vercel-online-55b467?labelColor=black&logo=vercel&style=flat-square
[vercel-shield-badge]: https://img.shields.io/badge/TRY%20LOBECHAT-ONLINE-55b467?labelColor=black&logo=vercel&style=for-the-badge
