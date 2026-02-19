# @lobechat/web-crawler

LobeChat 搭載的網頁抓取模組，用於智慧提取網頁內容並轉換為 Markdown 格式。

## 📝 簡介

`@lobechat/web-crawler` 是 LobeChat 的核心組件，負責網頁內容的智慧抓取與處理。它能夠從各類網頁中提取有價值的內容，過濾掉干擾元素，並生成結構化的 Markdown 文字。

## 🛠️ 核心功能

- **智慧內容提取**：基於 Mozilla Readability 算法識別主要內容
- **多級抓取策略**：支援多種抓取實現，包括基礎抓取、Jina、Search1API 和 Browserless 渲染抓取
- **自訂 URL 規則**：通過靈活的規則系統處理特定網站的抓取邏輯

## 🤝 參與共建

網頁結構多樣複雜，我們歡迎社群貢獻特定網站的抓取規則。您可以通過以下方式參與改進：

### 如何貢獻 URL 規則

1. 在 [urlRules.ts](https://github.com/lobehub/lobe-chat/blob/main/packages/web-crawler/src/urlRules.ts) 檔案中新增新規則
2. 規則示例：

```typescript
// 示例：處理特定網站
const url = [
  // ... 其他 url 匹配規則
  {
    // URL 匹配模式，僅支援正規表達式
    urlPattern: 'https://example.com/articles/(.*)',

    // 可選：URL 轉換，用於重新導向到更易抓取的版本
    urlTransform: 'https://example.com/print/$1',

    // 可選：指定抓取實現方式，支援 'naive'、'jina'、'search1api' 和 'browserless' 四種
    impls: ['naive', 'jina', 'search1api', 'browserless'],

    // 可選：內容過濾設定
    filterOptions: {
      // 是否啟用 Readability 算法，用於過濾干擾元素
      enableReadability: true,
      // 是否轉換為純文字
      pureText: false,
    },
  },
];
```

### 規則提交流程

1. Fork [LobeChat 倉庫](https://github.com/lobehub/lobe-chat)
2. 新增或修改 URL 規則
3. 提交 Pull Request 並描述：

- 目標網站特點
- 規則解決的問題
- 測試用例（示例 URL）

## 📌 注意事項

這是 LobeHub 的內部模組（`"private": true`），專為 LobeChat 設計，不作為獨立包發佈使用。
