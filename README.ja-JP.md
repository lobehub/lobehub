<div align="center"><a name="readme-top"></a>

[![][image-banner]][vercel-link]

# LobeHub

LobeHub は、あなたの Agent を 7×24 体制で稼働させます。

AI チーム全体の採用、スケジューリング、レポート作成を自動で支援します。

常時オンラインでなくても、主導権はあなたの手に。

[English](./README.md) · [简体中文](./README.zh-CN.md) · **日本語** · [公式サイト][official-site] · [更新履歴][changelog] · [ドキュメント][docs] · [ブログ][blog] · [フィードバック][github-issues-link]

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

**LobeHub リポジトリを共有**

[![][share-x-shield]][share-x-link]
[![][share-telegram-shield]][share-telegram-link]
[![][share-whatsapp-shield]][share-whatsapp-link]
[![][share-reddit-shield]][share-reddit-link]
[![][share-weibo-shield]][share-weibo-link]
[![][share-mastodon-shield]][share-mastodon-link]
[![][share-linkedin-shield]][share-linkedin-link]

<sup>あなたの Chief Agent Operator</sup>

<a href="https://www.producthunt.com/products/lobehub?embed=true&amp;utm_source=badge-top-post-badge&amp;utm_medium=badge&amp;utm_campaign=badge-lobehub-2" target="_blank" rel="noopener noreferrer"><img alt="LobeHub - Your Chief Agent Operator for multi-agent work | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/top-post-badge.svg?post_id=1147569&amp;theme=light&amp;period=daily&amp;t=1779247564355"></a> <a href="https://trendshift.io/repositories/19224" target="_blank"><img src="https://trendshift.io/api/badge/repositories/19224" alt="lobehub%2Flobehub | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[![](https://vercel.com/oss/program-badge.svg)](https://vercel.com/oss)

</div>

<details>
<summary><kbd>目次</kbd></summary>

#### TOC

- [👋🏻 はじめに & コミュニティ](#-はじめに--コミュニティ)
- [✨ 機能](#-機能)
  - [Operator: Agent を作業単位に](#operator-agent-を作業単位に)
  - [Create: Agent を作業単位に](#create-agent-を作業単位に)
  - [Collaborate: 新しいコラボレーションネットワークを拡張](#collaborate-新しいコラボレーションネットワークを拡張)
  - [Evolve: 人と Agent の共進化](#evolve-人と-agent-の共進化)
- [🛳 セルフホスティング](#-セルフホスティング)
  - [`A` Vercel、Zeabur、Sealos、Alibaba Cloud でデプロイ](#a-vercelzeabursealosalibaba-cloud-でデプロイ)
  - [`B` Docker でデプロイ](#b-docker-でデプロイ)
  - [環境変数](#環境変数)
- [📦 エコシステム](#-エコシステム)
- [🧩 プラグイン](#-プラグイン)
- [⌨️ ローカル開発](#️-ローカル開発)
- [🤝 コントリビューション](#-コントリビューション)
- [❤️ スポンサー](#️-スポンサー)
- [🔗 その他のプロダクト](#-その他のプロダクト)

####

<br/>

</details>

<br/>

<https://github.com/user-attachments/assets/0a33365f-b786-48b5-9ed6-f8af7927bccb>

## 👋🏻 はじめに & コミュニティ

私たちは e/acc なデザインエンジニアのチームです。AIGC のためのモダンなデザインコンポーネントとツールを提供したいと考えています。
Bootstrapping のアプローチを採用し、開発者とユーザーにとってよりオープンで透明性が高く、使いやすいプロダクトエコシステムを目指しています。

一般ユーザーにもプロの開発者にも、LobeHub は AI Agent の実験場になります。LobeHub は現在活発に開発中です。利用中に見つけた問題や要望は、ぜひ [issues][issues-link] でお知らせください。

| [![](https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1065874&theme=light&t=1769347414733)](https://www.producthunt.com/products/lobehub?launch=lobehub-2&embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-lobehub) | Product Hunt で公開されました！LobeHub を世界へ届けられることを嬉しく思います。人と Agent が共に進化する未来を信じているなら、ぜひ私たちの挑戦を応援してください。 |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![][discord-shield-badge]][discord-link]                                                                                                                                                                                                                          | Discord コミュニティに参加しましょう！開発者や LobeHub に熱心なユーザーとつながれる場所です。                                                    |

> \[!IMPORTANT]
>
> **Star をお願いします**。GitHub からリリース通知をすぐに受け取れます \~ ⭐️

[![][image-star]][github-stars-link]

<details>
  <summary><kbd>Star 履歴</kbd></summary>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=lobehub%2Flobehub&theme=dark&type=Date">
    <img width="100%" src="https://api.star-history.com/svg?repos=lobehub%2Flobehub&type=Date">
  </picture>
</details>

## ✨ 機能

今日の多くの Agent は、一度きりのタスク駆動型ツールです。文脈が不足し、孤立して動作し、異なるウィンドウやモデル間で手作業の引き継ぎが必要になります。メモリを持つものもありますが、多くはグローバルで浅く、無機質です。この状態では、ユーザーは断片化された会話を行き来することになり、構造化された生産性を築きにくくなります。

**LobeHub はそのすべてを変えます。**

LobeHub は、あなたと共に成長する Agent チームメイトを見つけ、構築し、協働するための仕事と生活の空間です。LobeHub では **Agent を作業単位** として扱い、人と Agent が共進化するためのインフラを提供します。

![](https://github.com/user-attachments/assets/89d1c402-a62b-4794-82ea-17e5ee1a6165)

### Operator: Agent を作業単位に

AI チーム全体の採用、スケジューリング、レポート作成を担います。

- **より高い生産性、より少ないツール**: すべての Agent をひとつの場所に集約します。
- **IM Gateway**: いつも会話している場所で Agent を使えます。

![](https://github.com/user-attachments/assets/7b08d6d9-9dff-4b06-a919-324630554509)

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://github.com/user-attachments/assets/81e89324-fc66-4024-99a3-aa8e16ec8184)

### Create: Agent を作業単位に

パーソナライズされた AI チームの構築は **Agent Builder** から始まります。必要なことを一度説明するだけで Agent のセットアップがすぐに始まり、自動設定が適用され、その場で使い始められます。

- **統合された知能**: あらゆるモデルとモダリティへシームレスにアクセスできます。すべてはあなたの管理下にあります。
- **10,000+ Skills**: 10,000 を超えるツールと MCP 互換プラグインのライブラリで、日々使うスキルに Agent を接続できます。

![](https://github.com/user-attachments/assets/949b8166-486d-4750-ad7a-cfe7bfcb84e3)

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/771ff3d30b9ef93e65e55021cc43d356.webp)

### Collaborate: 新しいコラボレーションネットワークを拡張

LobeHub は **Agent Groups** を導入し、Agent を本物のチームメイトのように扱えるようにします。システムがタスクに適した Agent を組み合わせ、並列的なコラボレーションと反復的な改善を可能にします。

- **Pages**: 共有コンテキストを使い、ひとつの場所で複数の Agent と文章を作成・改善できます。
- **Schedule**: 実行予定を設定し、不在時でも適切なタイミングで Agent に作業を任せられます。
- **Project**: 作業をプロジェクト単位で整理し、構造化された追跡しやすい状態を保ちます。
- **Workspace**: チームが Agent と協働するための共有空間です。組織内で明確な所有権と可視性を確保します。

![](https://github.com/user-attachments/assets/e51526c6-e09c-4a5a-9cec-dcd3fd68a3a8)

[![][back-to-top]](#readme-top)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

![](https://hub-apac-1.lobeobjects.space/blog/assets/fe98eae9fcb6acc47c8e1fb69bdb4b50.webp)

### Evolve: 人と Agent の共進化

最高の AI とは、あなたを深く理解してくれる AI です。LobeHub は、あなたのニーズを明確に理解するための **Personal Memory** を備えています。

- **継続学習**: Agent はあなたの働き方から学び、適切なタイミングで行動できるよう振る舞いを適応させます。
- **ホワイトボックスメモリ**: 私たちは透明性を重視します。Agent は構造化され編集可能なメモリを使うため、何を記憶するかをあなたが完全に管理できます。

![](https://github.com/user-attachments/assets/5c6e16f0-7f47-4baf-9aeb-3a00deb8ff5b)

<div align="right">

[![][back-to-top]](#readme-top)

</div>

> ✨ LobeHub の進化に合わせて、さらに多くの機能が追加されます。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🛳 セルフホスティング

LobeHub は Vercel、Alibaba Cloud、[Docker Image][docker-release-link] を使ったセルフホスティング版を提供しています。事前知識がなくても、数分で自分専用のチャットボットをデプロイできます。

> \[!TIP]
>
> [📘 自分だけの LobeHub を構築][docs-self-hosting] で詳しい手順を確認できます。

### `A` Vercel、Zeabur、Sealos、Alibaba Cloud でデプロイ

Vercel、Zeabur、Alibaba Cloud でこのサービスを自分でデプロイしたい場合は、次の手順に従ってください。

- [OpenAI API Key](https://platform.openai.com/account/api-keys) を準備します。
- 下のボタンをクリックしてデプロイを開始します。GitHub アカウントで直接ログインし、環境変数の欄に必須項目の `OPENAI_API_KEY` を入力してください。
- デプロイ完了後、すぐに利用を開始できます。
- カスタムドメインを紐づけます（任意）。一部地域では Vercel が割り当てるドメインの DNS が不安定な場合があるため、カスタムドメインを使うと直接接続できます。

<div align="center">

|          Vercel にデプロイ           |                     Zeabur にデプロイ                      |                     Sealos にデプロイ                      |                       RepoCloud にデプロイ                       |                         Alibaba Cloud にデプロイ                         |
| :-------------------------------------: | :---------------------------------------------------------: | :---------------------------------------------------------: | :---------------------------------------------------------------: | :-----------------------------------------------------------------------: |
| [![][deploy-button-image]][deploy-link] | [![][deploy-on-zeabur-button-image]][deploy-on-zeabur-link] | [![][deploy-on-sealos-button-image]][deploy-on-sealos-link] | [![][deploy-on-repocloud-button-image]][deploy-on-repocloud-link] | [![][deploy-on-alibaba-cloud-button-image]][deploy-on-alibaba-cloud-link] |

</div>

#### Fork 後

Fork 後は upstream sync action だけを残し、GitHub 上のリポジトリで他の Actions を無効化してください。

#### 最新状態を保つ

README のワンクリックデプロイ手順に従って自分のプロジェクトをデプロイした場合、「更新があります」という通知が繰り返し表示されることがあります。これは Vercel が既定でこのリポジトリを fork せず、新しいプロジェクトを作成するため、更新を正確に検出できないことが原因です。

> \[!TIP]
>
> [📘 最新版との自動同期][docs-upstream-sync] の手順に従って再デプロイすることをおすすめします。

<br/>

### `B` Docker でデプロイ

[![][docker-release-shield]][docker-release-link]
[![][docker-size-shield]][docker-size-link]
[![][docker-pulls-shield]][docker-pulls-link]

自分のプライベート環境に LobeHub サービスをデプロイするための Docker イメージを提供しています。次のコマンドで LobeHub サービスを起動します。

1. ストレージファイル用のフォルダを作成します

```fish
$ mkdir lobehub-db && cd lobehub-db
```

2. LobeHub のインフラを初期化します

```fish
bash <(curl -fsSL https://lobe.li/setup.sh)
```

3. LobeHub サービスを起動します

```fish
docker compose up -d
```

> \[!NOTE]
>
> Docker でのデプロイに関する詳細は [📘 Docker デプロイガイド][docs-docker] を参照してください。

<br/>

### 環境変数

このプロジェクトでは、環境変数で設定できる追加の設定項目を提供しています。

| 環境変数 | 必須 | 説明 | 例 |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | はい      | OpenAI アカウントページで発行する API キーです。 | `sk-xxxxxx...xxxxxx` |
| `OPENAI_PROXY_URL`   | いいえ       | OpenAI API のプロキシを手動で設定する場合、この項目で既定の OpenAI API リクエストベース URL を上書きできます。 | `https://api.chatanywhere.cn` または `https://aihubmix.com/v1` <br/>既定値:<br/>`https://api.openai.com/v1` |
| `OPENAI_MODEL_LIST`  | いいえ       | モデル一覧を制御します。`+` でモデルを追加し、`-` でモデルを非表示にし、`model_name=display_name` で表示名をカスタマイズします。カンマ区切りで指定します。 | `qwen-7b-chat,+glm-6b,-gpt-3.5-turbo` |

> \[!NOTE]
>
> 環境変数の完全な一覧は [📘 環境変数][docs-env-var] で確認できます。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 📦 エコシステム

| NPM                               | リポジトリ                              | 説明                                                                                           | バージョン                                   |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [@lobehub/ui][lobe-ui-link]       | [lobehub/lobe-ui][lobe-ui-github]       | AIGC Web アプリケーション構築のためのオープンソース UI コンポーネントライブラリです。                         | [![][lobe-ui-shield]][lobe-ui-link]       |
| [@lobehub/icons][lobe-icons-link] | [lobehub/lobe-icons][lobe-icons-github] | 主要な AI / LLM モデルブランドの SVG ロゴとアイコン集です。                                            | [![][lobe-icons-shield]][lobe-icons-link] |
| [@lobehub/tts][lobe-tts-link]     | [lobehub/lobe-tts][lobe-tts-github]     | 高品質で信頼性の高い TTS/STT React Hooks ライブラリです。                                                   | [![][lobe-tts-shield]][lobe-tts-link]     |
| [@lobehub/lint][lobe-lint-link]   | [lobehub/lobe-lint][lobe-lint-github]   | LobeHub 向けの ESLint、Stylelint、Commitlint、Prettier、Remark、Semantic Release 設定です。 | [![][lobe-lint-shield]][lobe-lint-link]   |

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🧩 プラグイン

プラグインは、LobeHub の [Function Calling][docs-function-call] 機能を拡張する手段です。新しい Function Calling や、メッセージ結果の新しいレンダリング方法を導入できます。プラグイン開発に興味がある場合は、Wiki の [📘 プラグイン開発ガイド][docs-plugin-dev] を参照してください。

- [lobe-chat-plugins][lobe-chat-plugins]: LobeHub のプラグインインデックスです。このリポジトリの index.json を参照し、利用可能なプラグイン一覧をユーザーに表示します。
- [chat-plugin-template][chat-plugin-template]: LobeHub プラグイン開発用のテンプレートです。
- [@lobehub/chat-plugin-sdk][chat-plugin-sdk]: LobeHub Plugin SDK は、優れた LobeHub プラグインの作成を支援します。
- [@lobehub/chat-plugins-gateway][chat-plugins-gateway]: LobeHub Plugins Gateway は、LobeHub プラグイン向けのゲートウェイを提供するバックエンドサービスです。このサービスは Vercel でデプロイしています。主要 API の POST /api/v1/runner は Edge Function としてデプロイされています。

> \[!NOTE]
>
> プラグインシステムは現在大きく開発が進められています。詳しくは以下の Issue を参照してください。
>
> - [x] [**Plugin Phase 1**](https://github.com/lobehub/lobehub/issues/73): プラグインを本体から分離し、独立したリポジトリで管理できるようにし、プラグインの動的読み込みを実現します。
> - [x] [**Plugin Phase 2**](https://github.com/lobehub/lobehub/issues/97): プラグイン利用時の安全性と安定性、異常状態のより正確な表示、プラグインアーキテクチャの保守性、開発者体験を改善します。
> - [x] [**Plugin Phase 3**](https://github.com/lobehub/lobehub/issues/149): より高度で包括的なカスタマイズ機能、プラグイン認証、サンプルをサポートします。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## ⌨️ ローカル開発

オンライン開発には GitHub Codespaces を利用できます。

[![][codespaces-shield]][codespaces-link]

または、クローンしてローカルで開発できます。

```fish
$ git clone https://github.com/lobehub/lobehub.git
$ cd lobehub
$ pnpm install
$ pnpm dev          # フルスタック (Next.js + Vite SPA)
$ bun run dev:spa   # SPA フロントエンドのみ (port 9876)
```

> **Debug Proxy**: `dev:spa` を実行すると、ターミナルに次のようなプロキシ URL が表示されます。
> `https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http%3A%2F%2Flocalhost%3A9876`。
> この URL を開くと、本番バックエンドに接続しながら HMR 付きでローカル開発できます。

詳しくは [📘 開発ガイド][docs-dev-guide] を参照してください。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🤝 コントリビューション

あらゆる形のコントリビューションを歓迎します。コードで貢献したい場合は、GitHub の [Issues][github-issues-link] や [Projects][github-project-link] を確認し、ぜひ参加してください。

> \[!TIP]
>
> 私たちは技術を軸にしたフォーラムを作り、知識の相互作用やアイデア交換を促進し、相互の刺激と協働的なイノベーションにつなげたいと考えています。
>
> LobeHub をより良くするため、プロダクトデザインやユーザー体験に関するフィードバックをぜひお寄せください。
>
> **主要メンテナー:** [@arvinxx](https://github.com/arvinxx) [@canisminor1990](https://github.com/canisminor1990)

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

## ❤️ スポンサー

どんな支援も大切です。単発の寄付も、私たちの支援の輪の中で輝きます。私たちを信じてくださりありがとうございます。あなたの寛大な支援は、私たちがミッションへ進むための力になります。

<a href="https://opencollective.com/lobehub" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/lobehub/.github/blob/main/static/sponsor-dark.png?raw=true">
    <img  src="https://github.com/lobehub/.github/blob/main/static/sponsor-light.png?raw=true">
  </picture>
</a>

<div align="right">

[![][back-to-top]](#readme-top)

</div>

## 🔗 その他のプロダクト

- **[🅰️ Lobe SD Theme][lobe-theme]:** Stable Diffusion WebUI 向けのモダンテーマです。洗練されたインターフェース、高いカスタマイズ性、生産性を高める機能を備えています。
- **[⛵️ Lobe Midjourney WebUI][lobe-midjourney-webui]:** Midjourney 向け WebUI です。テキストプロンプトから多様で豊かな画像をすばやく生成し、創造性と会話体験を高めます。
- **[🌏 Lobe i18n][lobe-i18n] :** Lobe i18n は ChatGPT を活用した i18n（国際化）翻訳プロセスの自動化ツールです。大きなファイルの自動分割、差分更新、OpenAI モデル・API プロキシ・temperature のカスタマイズに対応します。
- **[💌 Lobe Commit][lobe-commit]:** Lobe Commit は Langchain/ChatGPT を活用し、Gitmoji ベースのコミットメッセージを生成する CLI ツールです。

<div align="right">

[![][back-to-top]](#readme-top)

</div>

---

<details><summary><h4>📝 License</h4></summary>

[![][fossa-license-shield]][fossa-license-link]

</details>

Copyright © 2026 [LobeHub][profile-link]. <br />
This project is [LobeHub Community License](./LICENSE) licensed.

<!-- LINK GROUP -->

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
[blog]: https://lobehub.com/ja/blog
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
[deploy-on-repocloud-button-image]: https://d16t0pc4846x52.cloudfront.net/deploylobe.svg
[deploy-on-repocloud-link]: https://repocloud.io/details/?app_id=248
[deploy-on-sealos-button-image]: https://raw.githubusercontent.com/labring-actions/templates/main/Deploy-on-Sealos.svg
[deploy-on-sealos-link]: https://template.usw.sealos.io/deploy?templateName=lobehub-db
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
[docs]: https://lobehub.com/ja/docs/usage/start
[docs-dev-guide]: https://lobehub.com/docs/development/start
[docs-docker]: https://lobehub.com/ja/docs/self-hosting/server-database/docker-compose
[docs-env-var]: https://lobehub.com/docs/self-hosting/environment-variables
[docs-function-call]: https://lobehub.com/ja/blog/openai-function-call
[docs-plugin-dev]: https://lobehub.com/docs/usage/plugins/development
[docs-self-hosting]: https://lobehub.com/ja/docs/self-hosting/start
[docs-upstream-sync]: https://lobehub.com/docs/self-hosting/advanced/upstream-sync
[fossa-license-link]: https://app.fossa.com/projects/git%2Bgithub.com%2Flobehub%2Flobehub
[fossa-license-shield]: https://app.fossa.com/api/projects/git%2Bgithub.com%2Flobehub%2Flobehub.svg?type=large
[github-action-release-link]: https://github.com/actions/workflows/lobehub/lobehub/release.yml
[github-action-release-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobehub/release.yml?label=release&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-action-test-link]: https://github.com/actions/workflows/lobehub/lobehub/test.yml
[github-action-test-shield]: https://img.shields.io/github/actions/workflow/status/lobehub/lobehub/test.yml?label=test&labelColor=black&logo=githubactions&logoColor=white&style=flat-square
[github-contributors-link]: https://github.com/lobehub/lobehub/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/lobehub/lobehub?color=c4f042&labelColor=black&style=flat-square
[github-forks-link]: https://github.com/lobehub/lobehub/network/members
[github-forks-shield]: https://img.shields.io/github/forks/lobehub/lobehub?color=8ae8ff&labelColor=black&style=flat-square
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
[github-stars-shield]: https://img.shields.io/github/stars/lobehub/lobehub?color=ffcb47&labelColor=black&style=flat-square
[image-banner]: https://github.com/user-attachments/assets/5f78ae58-ed4f-4d38-8037-96109fbba58c
[image-star]: https://github.com/user-attachments/assets/3216e25b-186f-4a54-9cb4-2f124aec0471
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
[share-linkedin-link]: https://linkedin.com/feed
[share-linkedin-shield]: https://img.shields.io/badge/-share%20on%20linkedin-black?labelColor=black&logo=linkedin&logoColor=white&style=flat-square
[share-mastodon-link]: https://mastodon.social/share?text=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source,%20extensible%20%28Function%20Calling%29,%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT%2FLLM%20web%20application.%20https://github.com/lobehub/lobehub%20#chatbot%20#chatGPT%20#openAI
[share-mastodon-shield]: https://img.shields.io/badge/-share%20on%20mastodon-black?labelColor=black&logo=mastodon&logoColor=white&style=flat-square
[share-reddit-link]: https://www.reddit.com/submit?title=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source%2C%20extensible%20%28Function%20Calling%29%2C%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT%2FLLM%20web%20application.%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-reddit-shield]: https://img.shields.io/badge/-share%20on%20reddit-black?labelColor=black&logo=reddit&logoColor=white&style=flat-square
[share-telegram-link]: https://t.me/share/url"?text=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source%2C%20extensible%20%28Function%20Calling%29%2C%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT%2FLLM%20web%20application.%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-telegram-shield]: https://img.shields.io/badge/-share%20on%20telegram-black?labelColor=black&logo=telegram&logoColor=white&style=flat-square
[share-weibo-link]: http://service.weibo.com/share/share.php?sharesource=weibo&title=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source%2C%20extensible%20%28Function%20Calling%29%2C%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT%2FLLM%20web%20application.%20%23chatbot%20%23chatGPT%20%23openAI&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-weibo-shield]: https://img.shields.io/badge/-share%20on%20weibo-black?labelColor=black&logo=sinaweibo&logoColor=white&style=flat-square
[share-whatsapp-link]: https://api.whatsapp.com/send?text=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source%2C%20extensible%20%28Function%20Calling%29%2C%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT%2FLLM%20web%20application.%20https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub%20%23chatbot%20%23chatGPT%20%23openAI
[share-whatsapp-shield]: https://img.shields.io/badge/-share%20on%20whatsapp-black?labelColor=black&logo=whatsapp&logoColor=white&style=flat-square
[share-x-link]: https://x.com/intent/tweet?hashtags=chatbot%2CchatGPT%2CopenAI&text=Check%20this%20GitHub%20repository%20out%20%F0%9F%A4%AF%20LobeHub%20-%20An%20open-source%2C%20extensible%20%28Function%20Calling%29%2C%20high-performance%20chatbot%20framework.%20It%20supports%20one-click%20free%20deployment%20of%20your%20private%20ChatGPT%2FLLM%20web%20application.&url=https%3A%2F%2Fgithub.com%2Flobehub%2Flobehub
[share-x-shield]: https://img.shields.io/badge/-share%20on%20x-black?labelColor=black&logo=x&logoColor=white&style=flat-square
[submit-agents-link]: https://github.com/lobehub/lobe-chat-agents
[submit-agents-shield]: https://img.shields.io/badge/🤖/🏪_submit_agent-%E2%86%92-c4f042?labelColor=black&style=for-the-badge
[submit-plugin-link]: https://github.com/lobehub/lobe-chat-plugins
[submit-plugin-shield]: https://img.shields.io/badge/🧩/🏪_submit_plugin-%E2%86%92-95f3d9?labelColor=black&style=for-the-badge
[vercel-link]: https://app.lobehub.com
[vercel-shield]: https://img.shields.io/badge/vercel-online-55b467?labelColor=black&logo=vercel&style=flat-square
