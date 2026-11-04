<div align="center"><a name="readme-top"></a>

\[!\[]\[image-banner]]\[vercel-link]

# LobeHub

LobeHub organizes your agents into 7×24 operation.

It hires, schedules, reports on your entire AI team.

You stay in charge — without staying online.

**English** · [简体中文](./README.zh-CN.md) · \[Official Site]\[official-site] · \[Changelog]\[changelog] · \[Documents]\[docs] · \[Blog]\[blog] · \[Feedback]\[github-issues-link]

<!-- SHIELD GROUP -->

\[!\[]\[github-release-shield]]\[github-release-link]
\[!\[]\[docker-release-shield]]\[docker-release-link]
\[!\[]\[vercel-shield]]\[vercel-link]
\[!\[]\[discord-shield]]\[discord-link]<br/>
\[!\[]\[codecov-shield]]\[codecov-link]
\[!\[]\[github-action-test-shield]]\[github-action-test-link]
\[!\[]\[github-action-release-shield]]\[github-action-release-link]
\[!\[]\[github-releasedate-shield]]\[github-releasedate-link]<br/>
\[!\[]\[github-contributors-shield]]\[github-contributors-link]
\[!\[]\[github-forks-shield]]\[github-forks-link]
\[!\[]\[github-stars-shield]]\[github-stars-link]
\[!\[]\[github-issues-shield]]\[github-issues-link]
\[!\[]\[github-license-shield]]\[github-license-link]<br>

**Share LobeHub Repository**

\[!\[]\[share-x-shield]]\[share-x-link]
\[!\[]\[share-telegram-shield]]\[share-telegram-link]
\[!\[]\[share-whatsapp-shield]]\[share-whatsapp-link]
\[!\[]\[share-reddit-shield]]\[share-reddit-link]
\[!\[]\[share-weibo-shield]]\[share-weibo-link]
\[!\[]\[share-mastodon-shield]]\[share-mastodon-link]
\[!\[]\[share-linkedin-shield]]\[share-linkedin-link]

<sup>Your Chief Agent Operator</sup>

<a href="https://www.producthunt.com/products/lobehub?embed=true&amp;utm_source=badge-top-post-badge&amp;utm_medium=badge&amp;utm_campaign=badge-lobehub-2" target="_blank" rel="noopener noreferrer"><img alt="LobeHub - Your Chief Agent Operator for multi-agent work | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=1147569&amp;theme=light&amp;period=daily&amp;t=1779247564355"></a> <a href="https://trendshift.io/repositories/19224" target="_blank"><img src="https://trendshift.io/api/badge/repositories/19224" alt="lobehub%2Flobehub | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![](https://vercel.com/oss/program-badge.svg)](https://vercel.com/oss)

</div>

<details>
<summary><kbd>Table of contents</kbd></summary>

#### TOC

- [👋🏻 Getting Started & Join Our Community](#-getting-started--join-our-community)
- [✨ Features](#-features)
  - [Operator: Agents as the Unit of Work](#operator-agents-as-the-unit-of-work)
  - [Create: Agents as the Unit of Work](#create-agents-as-the-unit-of-work)
  - [Collaborate: Scale New Forms of Collaboration Networks](#collaborate-scale-new-forms-of-collaboration-networks)
  - [Evolve: Co-evolution of Humans and Agents](#evolve-co-evolution-of-humans-and-agents)
- [🛳 Self Hosting](#-self-hosting)
  - [`A` Deploying with Vercel, Zeabur , Sealos or Alibaba Cloud](#a-deploying-with-vercel-zeabur--sealos-or-alibaba-cloud)
  - [`B` Deploying with Docker](#b-deploying-with-docker)
  - [Environment Variable](#environment-variable)
  - [Obtain OpenAI API Key](#obtain-openai-api-key)
- [📦 Ecosystem](#-ecosystem)
- [🧩 Plugins](#-plugins)
- [⌨️ Local Development](#️-local-development)
- [🤝 Contributing](#-contributing)
- [❤️ Sponsor](#️-sponsor)
- [🔗 More Products](#-more-products)

####

<br/>

</details>

<br/>

<https://github.com/user-attachments/assets/0a33365f-b786-48b5-9ed6-f8af7927bccb>

## 👋🏻 Getting Started & Join Our Community

We are a group of e/acc design-engineers, hoping to provide modern design components and tools for AIGC.
By adopting the Bootstrapping approach, we aim to provide developers and users with a more open, transparent, and user-friendly product ecosystem.

Whether for users or professional developers, LobeHub will be your AI Agent playground. Please be aware that LobeHub is currently under active development, and feedback is welcome for any \[issues]\[issues-link] encountered.

| [![](https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1065874&theme=light&t=1769347414733)](https://www.producthunt.com/products/lobehub?launch=lobehub-2&embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-lobehub) | We are live on Product Hunt! We are thrilled to bring LobeHub to the world. If you believe in a future where humans and agents co-evolve, please support our journey. |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| \[!\[]\[discord-shield-badge]]\[discord-link]                                                                                                                                                                                                                      | Join our Discord community! This is where you can connect with developers and other enthusiastic users of LobeHub.                                                    |

> \[!IMPORTANT]
>
> **Star Us**, You will receive all release notifications from GitHub without any delay \~ ⭐️

\[!\[]\[image-star]]\[github-stars-link]

<details>
  <summary><kbd>Star History</kbd></summary>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lobehub%2Flobehub&theme=dark&type=Date">
    <img width="100%" src="https://api.star-history.com/svg?repos=lobehub%2Flobehub&type=Date">
  </picture>
</details>

## ✨ Features

Today’s agents are one-off, task-driven tools. They lack context, live in isolation, and require manual hand-offs between different windows and models. While some maintain memory, it is often global, shallow, and impersonal. In this mode, users are forced to toggle between fragmented conversations, making it difficult to form structured productivity.

**LobeHub changes everything.**

LobeHub is a work-and-lifestyle space to find, build, and collaborate with agent teammates that grow with you. In LobeHub, we treat **Agents as the unit of work**, providing an infrastructure where humans and agents co-evolve.

![](https://github.com/user-attachments/assets/89d1c402-a62b-4794-82ea-17e5ee1a6165)

### Operator: Agents as the Unit of Work

Hires, schedules, and reports on your entire AI team.

- **More productivity. Fewer tools**: Bring all your agents under one roof.
- **IM Gateway**: Agents where you already chat.

![](https://github.com/user-attachments/assets/7b08d6d9-9dff-4b06-a919-324630554509)

[!\[\]\[back-to-top\]](#readme-top)

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

![](https://github.com/user-attachments/assets/81e89324-fc66-4024-99a3-aa8e16ec8184)

### Create: Agents as the Unit of Work

Building a personalized AI team starts with the **Agent Builder**. You can describe what you need once, and the agent setup starts right away, applying auto-configurations so you can use it instantly.

- **Unified Intelligence**: Seamlessly access any model and any modality—all under your control.
- **10,000+ Skills**: Connect your agents to the skills you use every day with a library of over 10,000 tools and MCP-compatible plugins.

![](https://github.com/user-attachments/assets/949b8166-486d-4750-ad7a-cfe7bfcb84e3)

[!\[\]\[back-to-top\]](#readme-top)

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/771ff3d30b9ef93e65e55021cc43d356.webp)

### Collaborate: Scale New Forms of Collaboration Networks

LobeHub introduces **Agent Groups**, allowing you to work with agents like real teammates. The system assembles the right agents for the task, enabling parallel collaboration and iterative improvement.

- **Pages**: Write and refine content with multiple agents in one place with a shared context.
- **Schedule**: Schedule runs and let agents do the work at the right time, even while you are away.
- **Project**: Organize work by project to keep everything structured and easy to track.
- **Workspace**: A shared space for teams to collaborate with agents, ensuring clear ownership and visibility across the organization.

![](https://github.com/user-attachments/assets/e51526c6-e09c-4a5a-9cec-dcd3fd68a3a8)

[!\[\]\[back-to-top\]](#readme-top)

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/fe98eae9fcb6acc47c8e1fb69bdb4b50.webp)

### Evolve: Co-evolution of Humans and Agents

The best AI is one that understands you deeply. LobeHub features **Personal Memory** that builds a clear understanding of your needs.

- **Continual Learning**: Your agents learn from how you work, adapting their behavior to act at the right moment.
- **White-Box Memory**: We believe in transparency. Your agents use structured, editable memory, giving you full control over what they remember.

![](https://github.com/user-attachments/assets/5c6e16f0-7f47-4baf-9aeb-3a00deb8ff5b)

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

> ✨ more features will be added when LobeHub evolve.

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

## 🛳 Self Hosting

LobeHub provides Self-Hosted Version with Vercel, Alibaba Cloud, and \[Docker Image]\[docker-release-link]. This allows you to deploy your own chatbot within a few minutes without any prior knowledge.

> \[!TIP]
>
> Learn more about \[📘 Build your own LobeHub]\[docs-self-hosting] by checking it out.

### `A` Deploying with Vercel, Zeabur , Sealos or Alibaba Cloud

"If you want to deploy this service yourself on Vercel, Zeabur or Alibaba Cloud, you can follow these steps:

- Prepare your [OpenAI API Key](https://platform.openai.com/account/api-keys).
- Click the button below to start deployment: Log in directly with your GitHub account, and remember to fill in the `OPENAI_API_KEY`(required) on the environment variable section.
- After deployment, you can start using it.
- Bind a custom domain (optional): The DNS of the domain assigned by Vercel is polluted in some areas; binding a custom domain can connect directly.

<div align="center">

|             Deploy with Vercel              |                       Deploy with Zeabur                        |                       Deploy with Sealos                        |                         Deploy with RepoCloud                         |                           Deploy with Alibaba Cloud                           |
| :-----------------------------------------: | :-------------------------------------------------------------: | :-------------------------------------------------------------: | :-------------------------------------------------------------------: | :---------------------------------------------------------------------------: |
| \[!\[]\[deploy-button-image]]\[deploy-link] | \[!\[]\[deploy-on-zeabur-button-image]]\[deploy-on-zeabur-link] | \[!\[]\[deploy-on-sealos-button-image]]\[deploy-on-sealos-link] | \[!\[]\[deploy-on-repocloud-button-image]]\[deploy-on-repocloud-link] | \[!\[]\[deploy-on-alibaba-cloud-button-image]]\[deploy-on-alibaba-cloud-link] |

</div>

#### After Fork

After fork, only retain the upstream sync action and disable other actions in your repository on GitHub.

#### Keep Updated

If you have deployed your own project following the one-click deployment steps in the README, you might encounter constant prompts indicating "updates available." This is because Vercel defaults to creating a new project instead of forking this one, resulting in an inability to detect updates accurately.

> \[!TIP]
>
> We suggest you redeploy using the following steps, \[📘 Auto Sync With Latest]\[docs-upstream-sync]

<br/>

### `B` Deploying with Docker

\[!\[]\[docker-release-shield]]\[docker-release-link]
\[!\[]\[docker-size-shield]]\[docker-size-link]
\[!\[]\[docker-pulls-shield]]\[docker-pulls-link]

We provide a Docker image for deploying the LobeHub service on your own private device. Use the following command to start the LobeHub service:

1. create a folder to for storage files

```fish
$ mkdir lobehub-db && cd lobehub-db
```

2. init the LobeHub infrastructure

```fish
bash <(curl -fsSL https://lobe.li/setup.sh)
```

3. Start the LobeHub service

```fish
docker compose up -d
```

> \[!NOTE]
>
> For detailed instructions on deploying with Docker, please refer to the \[📘 Docker Deployment Guide]\[docs-docker]

<br/>

### Environment Variable

This project provides some additional configuration items set with environment variables:

| Environment Variable | Required | Description                                                                                                                                                               | Example                                                                                                              |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | Yes      | This is the API key you apply on the OpenAI account page                                                                                                                  | `sk-xxxxxx...xxxxxx`                                                                                                 |
| `OPENAI_PROXY_URL`   | No       | If you manually configure the OpenAI interface proxy, you can use this configuration item to override the default OpenAI API request base URL                             | `https://api.chatanywhere.cn` or `https://aihubmix.com/v1` <br/>The default value is<br/>`https://api.openai.com/v1` |
| `OPENAI_MODEL_LIST`  | No       | Used to control the model list. Use `+` to add a model, `-` to hide a model, and `model_name=display_name` to customize the display name of a model, separated by commas. | `qwen-7b-chat,+glm-6b,-gpt-3.5-turbo`                                                                                |

> \[!NOTE]
>
> The complete list of environment variables can be found in the \[📘 Environment Variables]\[docs-env-var]

### Obtain OpenAI API Key

An API Key is required to chat with LLMs in LobeHub. This section uses the OpenAI model provider as an example to briefly introduce how to obtain an API Key.

#### `A` Via the Official OpenAI Channel

- Sign up for an [OpenAI account](https://platform.openai.com/signup); you will need an international phone number and a non-mainland-China email address;
- After signing up, go to the [API Keys](https://platform.openai.com/api-keys) page and click `Create new secret key` to create a new API Key:

| Step 1: Open the creation dialog                                                                                                                   | Step 2: Create the API Key                                                                                                                         | Step 3: Get the API Key                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296253192-ff2193dd-f125-4e58-82e8-91bc376c0d68.png" height="200"/> | <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296254170-803bacf0-4471-4171-ae79-0eab08d621d1.png" height="200"/> | <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296255167-f2745f2b-f083-4ba8-bc78-9b558e0002de.png" height="200"/> |

- Fill this API Key into the LobeHub API Key configuration and you are ready to go.

> \[!TIP]
>
> Newly registered accounts usually come with a $5 free credit, but it is only valid for three months.
> If you want to keep using your API Key long-term, you need to bind a credit card to complete payment. Since OpenAI only supports foreign-currency credit cards, you will need to find a suitable payment channel yourself, which is not covered in detail here.

<br/>

#### `B` Via an OpenAI Third-Party Proxy

If you find signing up for an OpenAI account or binding a foreign-currency credit card troublesome, you can consider using a well-known OpenAI third-party proxy to obtain an API Key, which can effectively lower the barrier to getting one. At the same time, however, once you use a third-party service, you may also need to bear its potential risks — please decide based on your own actual situation. Below is a list of common third-party model proxies for your reference:

|                                                                     | Provider     | Features                                                                                                                  | Proxy URL                 | Link                                               |
| ------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------- |
| <img src="https://resource.aihubmix.com/logo.png?v=1" width="48" /> | **AIHubMix** | Uses the OpenAI enterprise API; all models site-wide at **14% off** the official price (incl. GPT-5.6 and Claude Fable 5) | `https://aihubmix.com/v1` | [Get](https://console.aihubmix.com/token?aff=8DBz) |

> \[!WARNING]
>
> **Disclaimer**: The OpenAI API Keys recommended here are provided by third-party proxies, so we are not responsible for the **validity** or **security** of these API Keys. Please bear the risks of purchasing and using them yourself.

> \[!NOTE]
>
> If you are a model service provider and believe your service is stable enough and reasonably priced, feel free to contact us — we will consider recommending it after trying and testing it ourselves.

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

## 📦 Ecosystem

| NPM                                 | Repository                                | Description                                                                                           | Version                                       |
| ----------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| \[@lobehub/ui]\[lobe-ui-link]       | \[lobehub/lobe-ui]\[lobe-ui-github]       | Open-source UI component library dedicated to building AIGC web applications.                         | \[!\[]\[lobe-ui-shield]]\[lobe-ui-link]       |
| \[@lobehub/icons]\[lobe-icons-link] | \[lobehub/lobe-icons]\[lobe-icons-github] | Popular AI / LLM Model Brand SVG Logo and Icon Collection.                                            | \[!\[]\[lobe-icons-shield]]\[lobe-icons-link] |
| \[@lobehub/tts]\[lobe-tts-link]     | \[lobehub/lobe-tts]\[lobe-tts-github]     | High-quality & reliable TTS/STT React Hooks library                                                   | \[!\[]\[lobe-tts-shield]]\[lobe-tts-link]     |
| \[@lobehub/lint]\[lobe-lint-link]   | \[lobehub/lobe-lint]\[lobe-lint-github]   | Configurations for ESlint, Stylelint, Commitlint, Prettier, Remark, and Semantic Release for LobeHub. | \[!\[]\[lobe-lint-shield]]\[lobe-lint-link]   |

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

## 🧩 Plugins

Plugins provide a means to extend the \[Function Calling]\[docs-function-call] capabilities of LobeHub. They can be used to introduce new function calls and even new ways to render message results. If you are interested in plugin development, please refer to our \[📘 Plugin Development Guide]\[docs-plugin-dev] in the Wiki.

- \[lobe-chat-plugins]\[lobe-chat-plugins]: This is the plugin index for LobeHub. It accesses index.json from this repository to display a list of available plugins for LobeHub to the user.
- \[chat-plugin-template]\[chat-plugin-template]: This is the plugin template for LobeHub plugin development.
- \[@lobehub/chat-plugin-sdk]\[chat-plugin-sdk]: The LobeHub Plugin SDK assists you in creating exceptional chat plugins for LobeHub.
- \[@lobehub/chat-plugins-gateway]\[chat-plugins-gateway]: The LobeHub Plugins Gateway is a backend service that provides a gateway for LobeHub plugins. We deploy this service using Vercel. The primary API POST /api/v1/runner is deployed as an Edge Function.

> \[!NOTE]
>
> The plugin system is currently undergoing major development. You can learn more in the following issues:
>
> - [x] [**Plugin Phase 1**](https://github.com/lobehub/lobehub/issues/73): Implement separation of the plugin from the main body, split the plugin into an independent repository for maintenance, and realize dynamic loading of the plugin.
> - [x] [**Plugin Phase 2**](https://github.com/lobehub/lobehub/issues/97): The security and stability of the plugin's use, more accurately presenting abnormal states, the maintainability of the plugin architecture, and developer-friendly.
> - [x] [**Plugin Phase 3**](https://github.com/lobehub/lobehub/issues/149): Higher-level and more comprehensive customization capabilities, support for plugin authentication, and examples.

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

## ⌨️ Local Development

You can use GitHub Codespaces for online development:

\[!\[]\[codespaces-shield]]\[codespaces-link]

Or clone it for local development:

```fish
$ git clone https://github.com/lobehub/lobehub.git
$ cd lobehub
$ pnpm install
$ pnpm dev          # Full-stack (Next.js + Vite SPA)
$ bun run dev:spa   # SPA frontend only (port 9876)
```

> **Debug Proxy**: After running `dev:spa`, the terminal prints a proxy URL like
> `https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http%3A%2F%2Flocalhost%3A9876`.
> Open it to develop locally against the production backend with HMR — a
> development convenience, not a place to verify a change.

If you would like to learn more details, please feel free to look at our \[📘 Development Guide]\[docs-dev-guide].

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

## 🤝 Contributing

Contributions of all types are more than welcome; if you are interested in contributing code, feel free to check out our GitHub \[Issues]\[github-issues-link] and \[Projects]\[github-project-link] to get stuck in to show us what you're made of.

> \[!TIP]
>
> We are creating a technology-driven forum, fostering knowledge interaction and the exchange of ideas that may culminate in mutual inspiration and collaborative innovation.
>
> Help us make LobeHub better. Welcome to provide product design feedback, user experience discussions directly to us.
>
> **Principal Maintainers:** [@arvinxx](https://github.com/arvinxx) [@canisminor1990](https://github.com/canisminor1990)

\[!\[]\[pr-welcome-shield]]\[pr-welcome-link]
\[!\[]\[submit-agents-shield]]\[submit-agents-link]
\[!\[]\[submit-plugin-shield]]\[submit-plugin-link]

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

[!\[\]\[back-to-top\]](#readme-top)

</div>

## ❤️ Sponsor

Every bit counts and your one-time donation sparkles in our galaxy of support! You're a shooting star, making a swift and bright impact on our journey. Thank you for believing in us – your generosity guides us toward our mission, one brilliant flash at a time.

<a href="https://opencollective.com/lobehub" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/lobehub/.github/blob/main/static/sponsor-dark.png?raw=true">
    <img  src="https://github.com/lobehub/.github/blob/main/static/sponsor-light.png?raw=true">
  </picture>
</a>

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

## 🔗 More Products

- **\[🅰️ Lobe SD Theme]\[lobe-theme]:** Modern theme for Stable Diffusion WebUI, exquisite interface design, highly customizable UI, and efficiency-boosting features.
- **\[⛵️ Lobe Midjourney WebUI]\[lobe-midjourney-webui]:** WebUI for Midjourney, leverages AI to quickly generate a wide array of rich and diverse images from text prompts, sparking creativity and enhancing conversations.
- **\[🌏 Lobe i18n]\[lobe-i18n] :** Lobe i18n is an automation tool for the i18n (internationalization) translation process, powered by ChatGPT. It supports features such as automatic splitting of large files, incremental updates, and customization options for the OpenAI model, API proxy, and temperature.
- **\[💌 Lobe Commit]\[lobe-commit]:** Lobe Commit is a CLI tool that leverages Langchain/ChatGPT to generate Gitmoji-based commit messages.

<div align="right">

[!\[\]\[back-to-top\]](#readme-top)

</div>

---

<details><summary><h4>📝 License</h4></summary>

\[!\[]\[fossa-license-shield]]\[fossa-license-link]

</details>

Copyright © 2026 \[LobeHub]\[profile-link]. <br />
This project is [LobeHub Community License](./LICENSE) licensed.

<!-- LINK GROUP -->

<!-- PROVIDER LIST -->

- **[OpenCode Zen](https://lobechat.com/discover/provider/opencodezen)**:

<details><summary><kbd>See more providers (+-9)</kbd></summary>

</details>

> 📊 Total providers: [<kbd>**1**</kbd>](https://lobechat.com/discover/providers)

 <!-- AGENT LIST -->

| Recent Submits                                                                                                                                                                 | Description                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Turtle Soup Host](https://lobechat.com/discover/assistant/lateral-thinking-puzzle)<br/><sup>By **[CSY2022](https://github.com/CSY2022)** on **2025-06-19**</sup>              | A turtle soup host needs to provide the scenario, the complete story (truth of the event), and the key point (the condition for guessing correctly).<br/>`turtle-soup` `reasoning` `interaction` `puzzle` `role-playing` |
| [Academic Writing Assistant](https://lobechat.com/discover/assistant/academic-writing-assistant)<br/><sup>By **[swarfte](https://github.com/swarfte)** on **2025-06-17**</sup> | Expert in academic research paper writing and formal documentation<br/>`academic-writing` `research` `formal-style`                                                                                                      |
| [Gourmet Reviewer🍟](https://lobechat.com/discover/assistant/food-reviewer)<br/><sup>By **[renhai-lab](https://github.com/renhai-lab)** on **2025-06-17**</sup>                | Food critique expert<br/>`gourmet` `review` `writing`                                                                                                                                                                    |
| [Minecraft Senior Developer](https://lobechat.com/discover/assistant/java-development)<br/><sup>By **[iamyuuk](https://github.com/iamyuuk)** on **2025-06-17**</sup>           | Expert in advanced Java development and Minecraft mod and server plugin development<br/>`development` `programming` `minecraft` `java`                                                                                   |

> 📊 Total agents: [<kbd>**505**</kbd> ](https://lobechat.com/discover/assistants)

 <!-- PLUGIN LIST -->

| Recent Submits                                                                                                             | Description                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [Shopping tools](https://lobechat.com/discover/plugin/ShoppingTools)<br/><sup>By **shoppingtools** on **2026-01-12**</sup> | Search for products on eBay & AliExpress, find eBay events & coupons. Get prompt examples.<br/>`shopping` `e-bay` `ali-express` `coupons`       |
| [SEO Assistant](https://lobechat.com/discover/plugin/seo_assistant)<br/><sup>By **webfx** on **2026-01-12**</sup>          | The SEO Assistant can generate search engine keyword information in order to aid the creation of content.<br/>`seo` `keyword`                   |
| [Video Captions](https://lobechat.com/discover/plugin/VideoCaptions)<br/><sup>By **maila** on **2025-12-13**</sup>         | Convert Youtube links into transcribed text, enable asking questions, create chapters, and summarize its content.<br/>`video-to-text` `youtube` |
| [WeatherGPT](https://lobechat.com/discover/plugin/WeatherGPT)<br/><sup>By **steven-tey** on **2025-12-13**</sup>           | Get current weather information for a specific location.<br/>`weather`                                                                          |

> 📊 Total plugins: [<kbd>**40**</kbd>](https://lobechat.com/discover/plugins)
