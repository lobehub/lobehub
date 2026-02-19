<div align="center"><a name="readme-top"></a>

[![][image-banner]][vercel-link]

# LobeHub

LobeHub 是一個工作與生活空間，用於發現、構建並與會隨著您一起成長的 Agent 隊友協作。<br/>
在 LobeHub 中，我們將 **Agent 視為工作單元**，提供一個讓人類與 Agent 共同進化的基礎設施。

[English](./README.md) · **繁體中文** · [官網][official-site] · [更新日誌][changelog] · [文件][docs] · [博客][blog] · [回饋問題][github-issues-link]

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

**分享 LobeHub 給你的好友**

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
<summary><kbd>目錄樹</kbd></summary>

#### TOC

- [👋🏻 開始使用 & 交流](#-開始使用--交流)
- [✨ 特性一覽](#-特性一覽)
  - [建立：以 Agent 為工作單元](#建立以-agent-為工作單元)
  - [協作：擴充功能新型協作網路](#協作擴充功能新型協作網路)
  - [進化：人類與 Agent 的共生進化](#進化人類與-agent-的共生進化)
  - [MCP](#mcp)
  - [發現、連接、擴充功能](#發現連接擴充功能)
  - [巔峰性能，零干擾](#巔峰性能零干擾)
  - [線上知識，按需獲取](#線上知識按需獲取)
  - [思維鏈 (CoT)](#思維鏈-cot)
  - [分支對話](#分支對話)
  - [支援白板 (Artifacts)](#支援白板-artifacts)
  - [檔案上傳 / 知識庫](#檔案上傳--知識庫)
  - [多模型服務商支援](#多模型服務商支援)
  - [支援本地大語言模型 (LLM)](#支援本地大語言模型-llm)
  - [模型視覺識別 (Model Visual)](#模型視覺識別-model-visual)
  - [TTS & STT 語音會話](#tts--stt-語音會話)
  - [Text to Image 文生圖](#text-to-image-文生圖)
  - [插件系統 (Tools Calling)](#插件系統-tools-calling)
  - [助手市場 (GPTs)](#助手市場-gpts)
  - [支援本地 / 遠端資料庫](#支援本地--遠端資料庫)
  - [支援多使用者管理](#支援多使用者管理)
  - [漸進式 Web 應用程式 (PWA)](#漸進式-web-應用程式-pwa)
  - [行動裝置相容](#行動裝置相容)
  - [自訂主題](#自訂主題)
  - [`*` 更多特性](#-更多特性)
- [🛳 開箱即用](#-開箱即用)
  - [`A` 使用 Vercel、Zeabur 、Sealos 或 阿里雲端運算巢 部署](#a-使用-vercelzeabur-sealos-或-阿里雲端運算巢-部署)
  - [`B` 使用 Docker 部署](#b-使用-docker-部署)
  - [環境變數](#環境變數)
  - [獲取 OpenAI API Key](#獲取-openai-api-key)
- [📦 生態系統](#-生態系統)
- [🧩 插件體系](#-插件體系)
- [⌨️ 本地開發](#️-本地開發)
- [🤝 參與貢獻](#-參與貢獻)
- [❤ 社群贊助](#-社群贊助)
- [🔗 更多工具](#-更多工具)

####

<br/>

</details>

<br/>

<https://github.com/user-attachments/assets/6710ad97-03d0-4175-bd75-adff9b55eca2>

## 👋🏻 開始使用 & 交流

我們是一群充滿熱情的設計工程師，希望為 AIGC 提供現代化的設計組件和工具，並以開源的方式分享。
同時通過 Bootstrapping 的方式，我們希望能夠為開發者和使用者提供一個更加開放、更加透明友好的產品生態。

不論普通使用者與專業開發者，LobeHub 旨在成為所有人的 AI Agent 實驗場。LobeChat 目前正在積極開發中，有任何需求或者問題，歡迎提交 [issues][issues-link]

| [![](https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1065874&theme=light&t=1769347414733)](https://www.producthunt.com/products/lobehub?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-lobehub) | 我們已在 Product Hunt 上線！我們很高興將 LobeHub 推向世界。如果您相信人類與 Agent 共同進化的未來，請支援我們的旅程。 |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| [![][discord-shield-badge]][discord-link]                                                                                                                                                                                                         | 加入我們的 Discord 社群！這是你可以與開發者和其他 LobeHub 熱衷使用者交流的地方                                         |

> \[!IMPORTANT]
>
> **收藏項目**，你將從 GitHub 上無延遲地接收所有發佈通知～⭐️

[![][image-star]][github-stars-link]

<details><summary><kbd>Star History</kbd></summary>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lobehub%2Flobe-chat&theme=dark&type=Date">
    <img src="https://api.star-history.com/svg?repos=lobehub%2Flobe-chat&type=Date">
  </picture>
</details>

## ✨ 特性一覽

現有的 Agent 大多是一次性、以任務為驅動的工具。它們缺乏上下文，孤立執行，並且需要在不同視窗和模型之間手動交接。即使有記憶，也往往是全域的、淺層的且缺乏個性。在這種模式下，使用者被迫在分散的對話之間來回切換，難以形成結構化的生產流程。

**LobeHub 改變一切。**

LobeHub 是一個工作與生活空間，用於發現、構建並與會隨著您一起成長的 Agent 隊友協作。在 LobeHub 中，我們將 **Agent 視為工作單元**，提供一個讓人類與 Agent 共同進化的基礎設施。

![](https://hub-apac-1.lobeobjects.space/blog/assets/2204cde2228fb3f583f3f2c090bc49fb.webp)

### 建立：以 Agent 為工作單元

構建個性化 AI 團隊從 **Agent Builder** 開始。您只需描述一次需求，Agent 設定即可立即啟動，自動應用程式設定以便您立刻使用。

- **統一智慧**：無縫存取任何模型與任何模態 —— 全部由您掌控。
- **1 萬 + 技能**：通過超過 10,000 個工具和與 MCP 相容的插件，將 Agent 連接到您每天使用的技能。

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/771ff3d30b9ef93e65e55021cc43d356.webp)

### 協作：擴充功能新型協作網路

LobeHub 引入了 **Agent Groups**，讓您可以像對待真實隊友一樣與 Agent 協同工作。系統會為任務組裝合適的 Agent，支援並行協作與迭代改進。

- **頁面（Pages）**：在同一位置與多個 Agent 共同撰寫和潤色內容，共享上下文。
- **日程（Schedule）**：安排執行，讓 Agent 在合適的時間完成工作，即使您不在也能繼續執行。
- **項目（Project）**：按項目組織工作，保持一切結構化且易於跟蹤。
- **工作區（Workspace）**：供團隊與 Agent 協作的共享空間，確保明確的所有權和組織內的可見性。

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/fe98eae9fcb6acc47c8e1fb69bdb4b50.webp)

### 進化：人類與 Agent 的共生進化

最好的 AI 是能深入理解您的那一種。LobeHub 提供了構建清晰使用者理解的 **個人記憶（Personal Memory）**。

- **持續學習**：您的 Agent 會從您的工作方式中學習，調整其行為以在恰當時刻採取行動。
- **白盒記憶**：我們相信透明性。您的 Agent 使用結構化、可編輯的記憶，讓您完全掌控它們記住的內容。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

<details>
<summary>更多特性</summary>

[![](https://github.com/user-attachments/assets/1be85d36-3975-4413-931f-27e05e440995)](https://lobehub.com/mcp)

### MCP

通過啟用與外部工具、資料源和服務的平滑、安全和動態交互，釋放你的 AI 的全部潛力。基於 MCP（模型上下文協議）的插件系統打破了 AI 與數位生態系統之間的壁壘，實現了前所未有的連接性和功能性。

將對話轉化為強大的工作流程，連接資料庫、API、檔案系統等。體驗真正理解並與你的世界互動的 AI Agent。

[![][back-to-top]](#readme-top)

![][image-feat-mcp-market]

### 發現、連接、擴充功能

瀏覽不斷增長的 MCP 插件庫，輕鬆擴充功能你的 AI 能力並簡化工作流程。存取 [lobehub.com/mcp](https://lobehub.com/mcp) 探索 MCP 市場，提供精選的整合集合，增強你的 AI 與各種工具和服務協作的能力。

從生產力工具到開發環境，發現擴充功能 AI 覆蓋範圍和效率的新方式。與社群連接，找到滿足特定需求的完美插件。

[![][back-to-top]](#readme-top)

![][image-feat-desktop]

### 巔峰性能，零干擾

獲得完整的 LobeHub 體驗，擺脫瀏覽器限制 —— 輕量級、專注且隨時就緒。我們的桌面應用程式為你的 AI 交互提供專用環境，確保最佳性能和最小干擾。

體驗更快的回應時間、更好的資源管理和與 AI 助手的更穩定連接。桌面應用程式專為要求 AI 工具最佳性能的使用者設計。

[![][back-to-top]](#readme-top)

![][image-feat-web-search]

### 線上知識，按需獲取

通過即時聯網存取，你的 AI 與世界保持同步 —— 新聞、資料、趨勢等。保持資訊更新，獲取最新可用資訊，使你的 AI 能夠提供準確和最新的回覆。

存取即時資訊，驗證事實，探索當前事件，無需離開對話。你的 AI 成為通向世界知識的門戶，始終保持最新和全面。

[![][back-to-top]](#readme-top)

[![][image-feat-cot]][docs-feat-cot]

### [思維鏈 (CoT)][docs-feat-cot]

體驗前所未有的 AI 推理過程。通過創新的思維鏈（CoT）視覺化功能，您可以即時觀察複雜問題是如何一步步被解析的。這項突破性的功能為 AI 的決策過程提供了前所未有的透明度，讓您能夠清晰地瞭解結論是如何得出的。

通過將複雜的推理過程分解為清晰的邏輯步驟，您可以更好地理解和驗證 AI 的解題思路。無論您是在除錯問題、學習知識，還是單純對 AI 推理感興趣，思維鏈視覺化都能將抽象思維轉化為一種引人入勝的互動體驗。

[![][back-to-top]](#readme-top)

[![][image-feat-branch]][docs-feat-branch]

### [分支對話][docs-feat-branch]

為您帶來更自然、更靈活的 AI 對話方式。通過分支對話功能，您的討論可以像人類對話一樣自然延伸。在任意訊息處建立新的對話分支，讓您在保留原有上下文的同時，自由探索不同的對話方向。

兩種強大模式任您選擇：

- **延續模式**：無縫延展當前討論，保持寶貴的對話上下文
- **獨立模式**：基於任意歷史訊息，開啟全新話題探討

這項突破性功能將線性對話轉變為動態的樹狀結構，讓您能夠更深入地探索想法，實現更高效的互動體驗。

[![][back-to-top]](#readme-top)

[![][image-feat-artifacts]][docs-feat-artifacts]

### [支援白板 (Artifacts)][docs-feat-artifacts]

體驗整合於 LobeHub 的 Claude Artifacts 能力。這項革命性功能突破了 AI 人機交互的邊界，讓您能夠即時建立和視覺化各種格式的內容。

以前所未有的靈活度進行創作與視覺化：

- 生成並展示動態 SVG 圖形
- 即時構建與渲染交互式 HTML 頁面
- 輸出多種格式的專業文件

[![][back-to-top]](#readme-top)

[![][image-feat-knowledgebase]][docs-feat-knowledgebase]

### [檔案上傳 / 知識庫][docs-feat-knowledgebase]

LobeHub 支援檔案上傳與知識庫功能，你可以上傳檔案、圖片、音訊、影片等多種類型的檔案，以及建立知識庫，方便使用者管理和查找檔案。同時在對話中使用檔案和知識庫功能，實現更加豐富的對話體驗。

<https://github.com/user-attachments/assets/faa8cf67-e743-4590-8bf6-ebf6ccc34175>

> \[!TIP]
>
> 查閱 [📘 LobeHub 知識庫上線 —— 此刻起，跬步千里](https://lobehub.com/zh/blog/knowledge-base) 瞭解詳情。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-privoder]][docs-feat-provider]

### [多模型服務商支援][docs-feat-provider]

在 LobeHub 的不斷發展過程中，我們深刻理解到在提供 AI 會話服務時模型服務商的多樣性對於滿足社群需求的重要性。因此，我們不再侷限於單一的模型服務商，而是拓展了對多種模型服務商的支援，以便為使用者提供更為豐富和多樣化的會話選擇。

通過這種方式，LobeHub 能夠更靈活地適應不同使用者的需求，同時也為開發者提供了更為廣泛的選擇空間。

#### 已支援的模型服務商

我們已經實現了對以下模型服務商的支援：

<!-- PROVIDER LIST -->

<details><summary><kbd>See more providers (+-10)</kbd></summary>

</details>

> 📊 Total providers: [<kbd>**0**</kbd>](https://lobechat.com/discover/providers)

 <!-- PROVIDER LIST -->

同時，我們也在計劃支援更多的模型服務商，以進一步豐富我們的服務商庫。如果你希望讓 LobeHub 支援你喜愛的服務商，歡迎加入我們的 [💬 社群討論](https://github.com/lobehub/lobe-chat/discussions/6157)。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-local]][docs-feat-local]

### [支援本地大語言模型 (LLM)][docs-feat-local]

為了滿足特定使用者的需求，LobeHub 還基於 [Ollama](https://ollama.ai) 支援了本地模型的使用，讓使用者能夠更靈活地使用自己的或第三方的模型。

> \[!TIP]
>
> 查閱 [📘 在 LobeHub 中使用 Ollama][docs-usage-ollama] 獲得更多資訊

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-vision]][docs-feat-vision]

### [模型視覺識別 (Model Visual)][docs-feat-vision]

LobeHub 已經支援 OpenAI 最新的 [`gpt-4-vision`](https://platform.openai.com/docs/guides/vision) 支援視覺識別的模型，這是一個具備視覺識別能力的多模態應用程式。
使用者可以輕鬆上傳圖片或者拖拽圖片到對話框中，助手將能夠識別圖片內容，並在此基礎上進行智慧對話，構建更智慧、更多元化的聊天場景。

這一特性開啟了新的互動方式，使得交流不再侷限於文字，而是可以涵蓋豐富的視覺元素。無論是日常使用中的圖片分享，還是在特定行業內的圖像解讀，助手都能提供出色的對話體驗。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-tts]][docs-feat-tts]

### [TTS & STT 語音會話][docs-feat-tts]

LobeHub 支援文字轉語音（Text-to-Speech，TTS）和語音轉文字（Speech-to-Text，STT）技術，這使得我們的應用程式能夠將文字資訊轉化為清晰的語音輸出，使用者可以像與真人交談一樣與我們的對話助手進行交流。
使用者可以從多種聲音中選擇，給助手搭配合適的音源。 同時，對於那些傾向於聽覺學習或者想要在忙碌中獲取資訊的使用者來說，TTS 提供了一個極佳的解決方案。

在 LobeHub 中，我們精心挑選了一系列高品質的聲音選項 (OpenAI Audio, Microsoft Edge Speech)，以滿足不同地域和文化背景使用者的需求。使用者可以根據個人喜好或者特定場景來選擇合適的語音，從而獲得個性化的交流體驗。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-t2i]][docs-feat-t2i]

### [Text to Image 文生圖][docs-feat-t2i]

支援最新的文字到圖片生成技術，LobeHub 現在能夠讓使用者在與助手對話中直接調用文生圖工具進行創作。
通過利用 [`DALL-E 3`](https://openai.com/dall-e-3)、[`MidJourney`](https://www.midjourney.com/) 和 [`Pollinations`](https://pollinations.ai/) 等 AI 工具的能力， 助手們現在可以將你的想法轉化為圖像。
同時可以更私密和沉浸式地完成你的創作過程。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-plugin]][docs-feat-plugin]

### [插件系統 (Tools Calling)][docs-feat-plugin]

LobeHub 的插件生態系統是其核心功能的重要擴充功能，它極大地增強了 ChatGPT 的實用性和靈活性。

<video controls src="https://github.com/lobehub/lobe-chat/assets/28616219/f29475a3-f346-4196-a435-41a6373ab9e2" muted="false"></video>

通過利用插件，ChatGPT 能夠實現即時資訊的獲取和處理，例如自動獲取最新新聞頭條，為使用者提供即時且相關的資訊。

此外，這些插件不僅侷限於新聞聚合，還可以擴充功能到其他實用的功能，如快速檢索文件、生成圖象、獲取電商平臺資料，以及其他各式各樣的第三方服務。

> 通過文件瞭解更多 [📘 插件使用][docs-usage-plugin]

<!-- PLUGIN LIST -->

| 最近新增                                                                                                             | 描述                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [購物工具](https://lobechat.com/discover/plugin/ShoppingTools)<br/><sup>By **shoppingtools** on **2026-01-12**</sup> | 在 eBay 和 AliExpress 上搜尋產品，查找 eBay 活動和優惠券。獲取快速示例。<br/>`購物` `e-bay` `ali-express` `優惠券` |
| [SEO 助手](https://lobechat.com/discover/plugin/seo_assistant)<br/><sup>By **webfx** on **2026-01-12**</sup>         | SEO 助手可以生成搜尋引擎關鍵詞資訊，以幫助建立內容。<br/>`seo` `關鍵詞`                                            |
| [影片字幕](https://lobechat.com/discover/plugin/VideoCaptions)<br/><sup>By **maila** on **2025-12-13**</sup>         | 將 Youtube 連結轉換為轉錄文字，使其能夠提問，建立章節，並總結其內容。<br/>`影片轉文字` `you-tube`                  |
| [天氣 GPT](https://lobechat.com/discover/plugin/WeatherGPT)<br/><sup>By **steven-tey** on **2025-12-13**</sup>       | 獲取特定位置的當前天氣資訊。<br/>`天氣`                                                                            |

> 📊 Total plugins: [<kbd>**40**</kbd>](https://lobechat.com/discover/plugins)

 <!-- PLUGIN LIST -->

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-agent]][docs-feat-agent]

### [助手市場 (GPTs)][docs-feat-agent]

在 LobeHub 的助手市場中，創作者們可以發現一個充滿活力和創新的社群，它匯聚了眾多精心設計的助手，這些助手不僅在工作場景中發揮著重要作用，也在學習過程中提供了極大的便利。
我們的市場不僅是一個展示平臺，更是一個協作的空間。在這裡，每個人都可以貢獻自己的智慧，分享個人開發的助手。

> \[!TIP]
>
> 通過 [🤖/🏪 提交助手][submit-agents-link] ，你可以輕鬆地將你的助手作品提交到我們的平臺。我們特別強調的是，LobeHub 建立了一套精密的自動化國際化（i18n）工作流程， 它的強大之處在於能夠無縫地將你的助手轉化為多種語言版本。
> 這意味著，不論你的使用者使用何種語言，他們都能無障礙地體驗到你的助手。

> \[!IMPORTANT]
>
> 我歡迎所有使用者加入這個不斷成長的生態系統，共同參與到助手的迭代與優化中來。共同創造出更多有趣、實用且具有創新性的助手，進一步豐富助手的多樣性和實用性。

<!-- AGENT LIST -->

| 最近新增                                                                                                                                                         | 描述                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [海龜湯主持人](https://lobechat.com/discover/assistant/lateral-thinking-puzzle)<br/><sup>By **[CSY2022](https://github.com/CSY2022)** on **2025-06-19**</sup>    | 一個海龜湯主持人，需要自己提供湯麵，湯底與關鍵點（猜中的判定條件）。<br/>`海龜湯` `推理` `互動` `謎題` `角色扮演` |
| [學術寫作助手](https://lobechat.com/discover/assistant/academic-writing-assistant)<br/><sup>By **[swarfte](https://github.com/swarfte)** on **2025-06-17**</sup> | 專業的學術研究論文寫作和正式文件編寫專家<br/>`學術寫作` `研究` `正式風格`                                         |
| [美食評論員🍟](https://lobechat.com/discover/assistant/food-reviewer)<br/><sup>By **[renhai-lab](https://github.com/renhai-lab)** on **2025-06-17**</sup>        | 美食評價專家<br/>`美食` `評價` `寫作`                                                                             |
| [Minecraft 資深開發者](https://lobechat.com/discover/assistant/java-development)<br/><sup>By **[iamyuuk](https://github.com/iamyuuk)** on **2025-06-17**</sup>   | 擅長高級 Java 開發及 Minecraft 開發<br/>`開發` `編程` `minecraft` `java`                                          |

> 📊 Total agents: [<kbd>**505**</kbd> ](https://lobechat.com/discover/assistants)

 <!-- AGENT LIST -->

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-database]][docs-feat-database]

### [支援本地 / 遠端資料庫][docs-feat-database]

LobeHub 支援同時使用伺服端資料庫和本地資料庫。根據您的需求，您可以選擇合適的部署方案：

- 本地資料庫：適合希望對資料有更多掌控感和隱私保護的使用者。LobeHub 採用了 CRDT (Conflict-Free Replicated Data Type) 技術，實現了多端同步功能。這是一項實驗性功能，旨在提供無縫的資料同步體驗。
- 伺服端資料庫：適合希望更便捷使用體驗的使用者。LobeHub 支援 PostgreSQL 作為伺服端資料庫。關於如何設定伺服端資料庫的詳細文件，請前往 [設定伺服端資料庫](https://lobehub.com/zh/docs/self-hosting/advanced/server-database)。

無論您選擇哪種資料庫，LobeHub 都能為您提供卓越的使用者體驗。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-auth]][docs-feat-auth]

### [支援多使用者管理][docs-feat-auth]

LobeHub 支援多使用者管理，提供了靈活的使用者認證方案：

- **Better Auth**：LobeHub 整合了 `Better Auth`，一個現代化且靈活的身分驗證庫，支援多種身分驗證方式，包括 OAuth、郵件登入、憑證登入、魔法連結等。通過 `Better Auth`，您可以輕鬆實現使用者的註冊、登入、會話管理、社交登入、多因素認證 (MFA) 等功能，確保使用者資料的安全性和隱私性。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-pwa]][docs-feat-pwa]

### [漸進式 Web 應用程式 (PWA)][docs-feat-pwa]

我們深知在當今多設備環境下為使用者提供無縫體驗的重要性。為此，我們採用了漸進式 Web 應用程式 [PWA](https://support.google.com/chrome/answer/9658361) 技術，
這是一種能夠將網頁應用程式提升至接近原生應用程式體驗的現代 Web 技術。通過 PWA，LobeHub 能夠在桌面和行動裝置上提供高度優化的使用者體驗，同時保持輕量級和高性能的特點。
在視覺和感覺上，我們也經過精心設計，以確保它的界面與原生應用程式無差別，提供流暢的動畫、回應式佈局和相容不同設備的螢幕解析度。

> \[!NOTE]
>
> 若您未熟悉 PWA 的安裝過程，您可以按照以下步驟將 LobeHub 新增為您的桌面應用程式（也適用於行動裝置）：
>
> - 在電腦上執行 Chrome 或 Edge 瀏覽器 .
> - 存取 LobeHub 網頁 .
> - 在網址列的右上角，單擊 <kbd>安裝</kbd> 圖示 .

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-mobile]][docs-feat-mobile]

### [行動裝置相容][docs-feat-mobile]

針對行動裝置進行了一系列的優化設計，以提升使用者的移動體驗。目前，我們正在對行動端的使用者體驗進行版本迭代，以實現更加流暢和直觀的交互。如果您有任何建議或想法，我們非常歡迎您通過 GitHub Issues 或者 Pull Requests 提供回饋。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

[![][image-feat-theme]][docs-feat-theme]

### [自訂主題][docs-feat-theme]

作為設計工程師出身，LobeHub 在界面設計上充分考慮使用者的個性化體驗，因此引入了靈活多變的主題模式，其中包括日間的亮色模式和夜間的深色模式。
除了主題模式的切換，還提供了一系列的顏色定製選項，允許使用者根據自己的喜好來調整應用程式的主題色彩。無論是想要沉穩的深藍，還是希望活潑的桃粉，或者是專業的灰白，使用者都能夠在 LobeHub 中找到匹配自己風格的顏色選擇。

> \[!TIP]
>
> 預設設定能夠智慧地識別使用者系統的顏色模式，自動進行主題切換，以確保應用程式界面與作業系統保持一致的視覺體驗。對於喜歡手動調控細節的使用者，LobeHub 同樣提供了直觀的設定選項，針對聊天場景也提供了對話氣泡模式和文件模式的選擇。

<div align="right">

<div align="right">

[![][back-to-top]](#readme-top)

</div>

</div>

### `*` 更多特性

除了上述功能特性以外，LobeHub 所具有的設計和技術能力將為你帶來更多使用保障：

- [x] 💎 **精緻 UI 設計**：經過精心設計的界面，具有優雅的外觀和流暢的交互效果，支援亮暗色主題，相容行動端。支援 PWA，提供更加接近原生應用程式的體驗。
- [x] 🗣️ **流暢的對話體驗**：流式回應帶來流暢的對話體驗，並且支援完整的 Markdown 渲染，包括程式碼高亮、LaTex 公式、Mermaid 流程圖等。
- [x] 💨 **快速部署**：使用 Vercel 平臺或者我們的 Docker 鏡像，只需點擊一鍵部署按鈕，即可在 1 分鐘內完成部署，無需複雜的設定過程。
- [x] 🔒 **隱私安全**：所有資料儲存在使用者瀏覽器本地，保證使用者的隱私安全。
- [x] 🌐 **自訂域名**：如果使用者擁有自己的域名，可以將其綁定到平臺上，方便在任何地方快速存取對話助手。

</details>

> ✨ 隨著產品迭代持續更新，我們將會帶來更多更多令人激動的功能！

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🛳 開箱即用

LobeHub 提供了 Vercel 的 自託管版本 和 [Docker 鏡像][docker-release-link]，這使你可以在幾分鐘內構建自己的聊天機器人，無需任何基礎知識。

> \[!TIP]
>
> 完整教學請查閱 [📘 構建屬於自己的 LobeHub][docs-self-hosting]

### `A` 使用 Vercel、Zeabur 、Sealos 或 阿里雲端運算巢 部署

如果想在 Vercel 、 Zeabur 或 阿里雲 上部署該服務，可以按照以下步驟進行操作：

- 準備好你的 [OpenAI API Key](https://platform.openai.com/account/api-keys) 。
- 點擊下方按鈕開始部署： 直接使用 GitHub 帳號登入即可，記得在環境變數頁填入 `OPENAI_API_KEY` （必填）；
- 部署完畢後，即可開始使用；
- 綁定自訂域名（可選）：Vercel 分配的域名 DNS 在某些區域被汙染了，綁定自訂域名即可直連。目前 Zeabur 提供的域名還未被汙染，大多數地區都可以直連。

<div align="center">

|            使用 Vercel 部署             |                      使用 Zeabur 部署                       |                      使用 Sealos 部署                       |                           使用阿里雲端運算巢部署                            |
| :-------------------------------------: | :---------------------------------------------------------: | :---------------------------------------------------------: | :-----------------------------------------------------------------------: |
| [![][deploy-button-image]][deploy-link] | [![][deploy-on-zeabur-button-image]][deploy-on-zeabur-link] | [![][deploy-on-sealos-button-image]][deploy-on-sealos-link] | [![][deploy-on-alibaba-cloud-button-image]][deploy-on-alibaba-cloud-link] |

</div>

#### Fork 之後

在 Fork 後，請只保留 "upstream sync" Action 並在你 fork 的 GitHub Repo 中禁用其他 Action。

#### 保持更新

如果你根據 README 中的一鍵部署步驟部署了自己的項目，你可能會發現總是被提示 "有可用更新"。這是因為 Vercel 預設為你建立新項目而非 fork 本項目，這將導致無法準確檢測更新。

> \[!TIP]
>
> 我們建議按照 [📘 自動同步更新][docs-upstream-sync] 步驟重新部署。

<br/>

### `B` 使用 Docker 部署

[![][docker-release-shield]][docker-release-link]
[![][docker-size-shield]][docker-size-link]
[![][docker-pulls-shield]][docker-pulls-link]

我們提供了一個用於在您自己的私有設備上部署 LobeHub 服務的 Docker 鏡像。請使用以下命令啟動 LobeHub 服務：

1. 建立一個用於存儲檔案的資料夾

```fish
$ mkdir lobe-chat-db && cd lobe-chat-db
```

2. 啟動一鍵腳本

```fish
bash <(curl -fsSL https://lobe.li/setup.sh) -l zh_TW
```

3. 啟動 LobeHub

```fish
docker compose up -d
```

> \[!NOTE]
>
> 有關 Docker 部署的詳細說明，詳見 [📘 使用 Docker 部署][docs-docker]

<br/>

### 環境變數

本項目提供了一些額外的設定項，使用環境變數進行設定：

| 環境變數            | 類型 | 描述                                                                                                                          | 示例                                                                                                   |
| ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`    | 必選 | 這是你在 OpenAI 帳號頁面申請的 API 密鑰                                                                                       | `sk-xxxxxx...xxxxxx`                                                                                   |
| `OPENAI_PROXY_URL`  | 可選 | 如果你手動設定了 OpenAI 接口代理，可以使用此設定項來覆蓋預設的 OpenAI API 請求基礎 URL                                        | `https://api.chatanywhere.cn` 或 `https://aihubmix.com/v1`<br/>預設值:<br/>`https://api.openai.com/v1` |
| `OPENAI_MODEL_LIST` | 可選 | 用來控制模型列表，使用 `+` 增加一個模型，使用 `-` 來隱藏一個模型，使用 `模型名=展示名` 來自訂模型的展示名，用英文逗號隔開。 | `qwen-7b-chat,+glm-6b,-gpt-3.5-turbo`                                                                  |

> \[!NOTE]
>
> 完整環境變數可見 [📘 環境變數][docs-env-var]

<br/>

### 獲取 OpenAI API Key

API Key 是使用 LobeHub 進行大語言模型會話的必要資訊，本節以 OpenAI 模型服務商為例，簡要介紹獲取 API Key 的方式。

#### `A` 通過 OpenAI 官方管道

- 註冊一個 [OpenAI 帳號](https://platform.openai.com/signup)，你需要使用國際手機號、非大陸信箱進行註冊；
- 註冊完畢後，前往 [API Keys](https://platform.openai.com/api-keys) 頁面，點擊 `Create new secret key` 建立新的 API Key:

| 步驟 1：開啟建立視窗                                                                                                                               | 步驟 2：建立 API Key                                                                                                                               | 步驟 3：獲取 API Key                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296253192-ff2193dd-f125-4e58-82e8-91bc376c0d68.png" height="200"/> | <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296254170-803bacf0-4471-4171-ae79-0eab08d621d1.png" height="200"/> | <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/28616219/296255167-f2745f2b-f083-4ba8-bc78-9b558e0002de.png" height="200"/> |

- 將此 API Key 填寫到 LobeHub 的 API Key 設定中，即可開始使用。

> \[!TIP]
>
> 帳號註冊後，一般有 5 美元的免費額度，但有效期只有三個月。
> 如果你希望長期使用你的 API Key，你需要完成支付的信用卡綁定。由於 OpenAI 只支援外幣信用卡，因此你需要找到合適的支付管道，此處不再詳細展開。

<br/>

#### `B` 通過 OpenAI 第三方代理商

如果你發現註冊 OpenAI 帳號或者綁定外幣信用卡比較麻煩，可以考慮藉助一些知名的 OpenAI 第三方代理商來獲取 API Key，這可以有效降低獲取 OpenAI API Key 的門檻。但與此同時，一旦使用三方服務，你可能也需要承擔潛在的風險，
請根據你自己的實際情況自行決策。以下是常見的第三方模型代理商列表，供你參考：

|                                                                                                                                                   | 服務商       | 特性說明                                                        | Proxy 代理位址            | 連結                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------- | ------------------------- | ------------------------------- |
| <img src="https://github-production-user-asset-6210df.s3.amazonaws.com/17870709/296272721-c3ac0bf3-e433-4496-89c4-ebdc20689c17.jpg" width="48" /> | **AiHubMix** | 使用 OpenAI 企業接口，全站模型價格為官方 **86 折**（含 GPT-4 ） | `https://aihubmix.com/v1` | [獲取](https://lobe.li/XHnZIUP) |

> \[!WARNING]
>
> **免責申明**: 在此推薦的 OpenAI API Key 由第三方代理商提供，所以我們不對 API Key 的 **有效性** 和 **安全性** 負責，請你自行承擔購買和使用 API Key 的風險。

> \[!NOTE]
>
> 如果你是模型服務商，並認為自己的服務足夠穩定且價格實惠，歡迎聯繫我們，我們會在自行體驗和測試後酌情推薦。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 📦 生態系統

| NPM                               | 倉庫                                    | 描述                                                                                     | 版本                                      |
| --------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| [@lobehub/ui][lobe-ui-link]       | [lobehub/lobe-ui][lobe-ui-github]       | 構建 AIGC 網頁應用程式而設計的開源 UI 組件庫                                             | [![][lobe-ui-shield]][lobe-ui-link]       |
| [@lobehub/icons][lobe-icons-link] | [lobehub/lobe-icons][lobe-icons-github] | 主流 AI / LLM 模型和公司 SVG Logo 與 Icon 合集                                           | [![][lobe-icons-shield]][lobe-icons-link] |
| [@lobehub/tts][lobe-tts-link]     | [lobehub/lobe-tts][lobe-tts-github]     | AI TTS / STT 語音合成 / 識別 React Hooks 庫                                              | [![][lobe-tts-shield]][lobe-tts-link]     |
| [@lobehub/lint][lobe-lint-link]   | [lobehub/lobe-lint][lobe-lint-github]   | LobeHub 程式碼樣式規範 ESlint，Stylelint，Commitlint，Prettier，Remark 和 Semantic Release | [![][lobe-lint-shield]][lobe-lint-link]   |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧩 插件體系

插件提供了擴充功能 LobeHub [Function Calling][docs-function-call] 能力的方法。可以用於引入新的 Function Calling，甚至是新的訊息結果渲染方式。如果你對插件開發感興趣，請在 Wiki 中查閱我們的 [📘 插件開發指引][docs-plugin-dev] 。

- [lobe-chat-plugins][lobe-chat-plugins]：插件索引從該倉庫的 index.json 中獲取插件列表並顯示給使用者。
- [chat-plugin-template][chat-plugin-template]：插件開發模版，你可以通過項目模版快速新建插件項目。
- [@lobehub/chat-plugin-sdk][chat-plugin-sdk]：插件 SDK 可幫助您建立出色的 LobeHub 插件。
- [@lobehub/chat-plugins-gateway][chat-plugins-gateway]：插件閘道是一個後端服務，作為 LobeHub 插件的閘道。我們使用 Vercel 部署此服務。主要的 API POST /api/v1/runner 被部署為 Edge Function。

> \[!NOTE]
>
> 插件系統目前正在進行重大開發。您可以在以下 Issues 中瞭解更多資訊:
>
> - [x] [**插件一期**](https://github.com/lobehub/lobe-chat/issues/73): 實現插件與主體分離，將插件拆分為獨立倉庫維護，並實現插件的動態載入
> - [x] [**插件二期**](https://github.com/lobehub/lobe-chat/issues/97): 插件的安全性與使用的穩定性，更加精準地呈現異常狀態，插件架構的可維護性與開發者友好
> - [x] [**插件三期**](https://github.com/lobehub/lobe-chat/issues/149)：更高階與完善的自訂能力，支援插件認證與示例

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ⌨️ 本地開發

可以使用 GitHub Codespaces 進行線上開發：

[![][codespaces-shield]][codespaces-link]

或者使用以下命令進行本地開發：

```fish
$ git clone https://github.com/lobehub/lobe-chat.git
$ cd lobe-chat
$ pnpm install
$ pnpm run dev
```

如果你希望瞭解更多詳情，歡迎可以查閱我們的 [📘 開發指南][docs-dev-guide]

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🤝 參與貢獻

我們非常歡迎各種形式的貢獻。如果你對貢獻程式碼感興趣，可以查看我們的 GitHub [Issues][github-issues-link] 和 [Projects][github-project-link]，大展身手，向我們展示你的奇思妙想。

> \[!TIP]
>
> 我們希望建立一個技術分享型社群，一個可以促進知識共享、想法交流，激發彼此鼓勵和協作的環境。
> 同時歡迎聯繫我們提供產品功能和使用體驗回饋，幫助我們將 LobeHub 建設得更好。
>
> **組織維護者:** [@arvinxx](https://github.com/arvinxx) [@canisminor1990](https://github.com/canisminor1990)

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

## ❤ 社群贊助

每一分支援都珍貴無比，匯聚成我們支援的璀璨銀河！你就像一顆劃破夜空的流星，瞬間點亮我們前行的道路。感謝你對我們的信任 —— 你的支援筆就像星辰導航，一次又一次地為項目指明前進的光芒。

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

- **[🅰️ Lobe SD Theme][lobe-theme]:** Stable Diffusion WebUI 的現代主題，精緻的界面設計，高度可定製的 UI，以及提高效率的功能。
- **[⛵️ Lobe Midjourney WebUI][lobe-midjourney-webui]:** Midjourney WebUI, 能夠根據文字提示快速生成豐富多樣的圖像，激發創造力，增強對話交流。
- **[🌏 Lobe i18n][lobe-i18n]:** Lobe i18n 是一個由 ChatGPT 驅動的 i18n（國際化）翻譯過程的自動化工具。它支援自動分割大檔案、增量更新，以及為 OpenAI 模型、API 代理和溫度提供定製選項的功能。
- **[💌 Lobe Commit][lobe-commit]:** Lobe Commit 是一個 CLI 工具，它利用 Langchain/ChatGPT 生成基於 Gitmoji 的提交訊息。

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
[codecov-link]: https://codecov.io/gh/lobehub/lobe-chat
[codecov-shield]: https://img.shields.io/codecov/c/github/lobehub/lobe-chat?labelColor=black&style=flat-square&logo=codecov&logoColor=white
[codespaces-link]: https://codespaces.new/lobehub/lobe-chat
[codespaces-shield]: https://github.com/codespaces/badge.svg
[deploy-button-image]: https://vercel.com/button
[deploy-link]: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat&env=OPENAI_API_KEY&envDescription=Find%20your%20OpenAI%20API%20Key%20by%20click%20the%20right%20Learn%20More%20button.&envLink=https%3A%2F%2Fplatform.openai.com%2Faccount%2Fapi-keys&project-name=lobe-chat&repository-name=lobe-chat
[deploy-on-alibaba-cloud-button-image]: https://service-info-public.oss-cn-hangzhou.aliyuncs.com/computenest-en.svg
[deploy-on-alibaba-cloud-link]: https://computenest.console.aliyun.com/service/instance/create/default?type=user&ServiceName=LobeHub%E7%A4%BE%E5%8C%BA%E7%89%88
[deploy-on-sealos-button-image]: https://raw.githubusercontent.com/labring-actions/templates/main/Deploy-on-Sealos.svg
[deploy-on-sealos-link]: https://template.hzh.sealos.run/deploy?templateName=lobe-chat-db
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
[fossa-license-link]: https://app.fossa.com/projects/git%2Bgithub.com%2Flobehub%2Flobe-chat
[fossa-license-shield]: https://app.fossa.com/api/projects/git%2Bgithub.com%2Flobehub%2Flobe-chat.svg?type=large
[github-action-release-link]: https://github.com/lobehub/lobe-chat/actions/workflows/release.yml
[github-action-release-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobe-chat/release.yml?label=release&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-action-test-link]: https://github.com/lobehub/lobe-chat/actions/workflows/test.yml
[github-action-test-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobe-chat/test.yml?label=test&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-contributors-link]: https://github.com/lobehub/lobe-chat/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/lobehub/lobe-chat?color=c4f042&labelColor=black&style=flat-square
[github-forks-link]: https://github.com/lobehub/lobe-chat/network/members
[github-forks-shield]: https://img.shields.io/github/forks/lobehub/lobe-chat?color=8ae8ff&labelColor=black&style=flat-square
[github-hello-shield]: https://abroad.hellogithub.com/v1/widgets/recommend.svg?rid=39701baf5a734cb894ec812248a5655a&claim_uid=HxYvFN34htJzGCD&theme=dark&theme=neutral&theme=dark&theme=neutral
[github-hello-url]: https://hellogithub.com/repository/39701baf5a734cb894ec812248a5655a
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
[share-mastodon-link]: https://mastodon.social/share?text=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source,%20extensible%20(Function%20Calling),%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT/LLM%20web%20application.%20https://github.com/lobehub/lobe-chat%20#chatbot%20#chatGPT%20#openAI
[share-mastodon-shield]: https://img.shields.io/badge/-share%20on%20mastodon-black?labelColor=black&logo=mastodon&logoColor=white&style=flat-square
[share-reddit-link]: https://www.reddit.com/submit?title=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat
[share-reddit-shield]: https://img.shields.io/badge/-share%20on%20reddit-black?labelColor=black&logo=reddit&logoColor=white&style=flat-square
[share-telegram-link]: https://t.me/share/url"?text=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat
[share-telegram-shield]: https://img.shields.io/badge/-share%20on%20telegram-black?labelColor=black&logo=telegram&logoColor=white&style=flat-square
[share-weibo-link]: http://service.weibo.com/share/share.php?sharesource=weibo&title=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat
[share-weibo-shield]: https://img.shields.io/badge/-share%20on%20weibo-black?labelColor=black&logo=sinaweibo&logoColor=white&style=flat-square
[share-whatsapp-link]: https://api.whatsapp.com/send?text=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F%20https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat%20%23chatbot%20%23chatGPT%20%23openAI
[share-whatsapp-shield]: https://img.shields.io/badge/-share%20on%20whatsapp-black?labelColor=black&logo=whatsapp&logoColor=white&style=flat-square
[share-x-link]: https://x.com/intent/tweet?hashtags=chatbot%2CchatGPT%2CopenAI&text=%E6%8E%A8%E8%8D%90%E4%B8%80%E4%B8%AA%20GitHub%20%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%20%F0%9F%A4%AF%20LobeHub%20-%20%E5%BC%80%E6%BA%90%E7%9A%84%E3%80%81%E5%8F%AF%E6%89%A9%E5%B1%95%E7%9A%84%EF%BC%88Function%20Calling%EF%BC%89%E9%AB%98%E6%80%A7%E8%83%BD%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA%E6%A1%86%E6%9E%B6%E3%80%82%0A%E5%AE%83%E6%94%AF%E6%8C%81%E4%B8%80%E9%94%AE%E5%85%8D%E8%B4%B9%E9%83%A8%E7%BD%B2%E7%A7%81%E4%BA%BA%20ChatGPT%2FLLM%20%E7%BD%91%E9%A1%B5%E5%BA%94%E7%94%A8%E7%A8%8B%E5%BA%8F&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobe-chat
[share-x-shield]: https://img.shields.io/badge/-share%20on%20x-black?labelColor=black&logo=x&logoColor=white&style=flat-square
[sponsor-link]: https://opencollective.com/lobehub 'Become ❤ LobeHub Sponsor'
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20LobeHub-f04f88?logo=opencollective&logoColor=white&style=flat-square
[submit-agents-link]: https://github.com/lobehub/lobe-chat-agents
[submit-agents-shield]: https://img.shields.io/badge/🤖/🏪_submit_agent-%E2%86%92-c4f042?labelColor=black&style=for-the-badge
[submit-plugin-link]: https://github.com/lobehub/lobe-chat-plugins
[submit-plugin-shield]: https://img.shields.io/badge/🧩/🏪_submit_plugin-%E2%86%92-95f3d9?labelColor=black&style=for-the-badge
[vercel-link]: https://chat-preview.lobehub.com
[vercel-shield]: https://img.shields.io/badge/vercel-online-55b467?labelColor=black&logo=vercel&style=flat-square
