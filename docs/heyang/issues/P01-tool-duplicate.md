# P01 工具函数名重复排查报告

更新时间：2026-05-14

结论：根因已确认，暂未写最终去重修复逻辑。`数据科学家 📊` Agent 只启用了一个 MCP 型 installed plugin：`emblemcompany-agent-skills`。该 manifest 自身的 `api` 数组里存在重复 API 名，LobeHub 当前工具生成链路按 `manifest.api.map(...)` 逐项生成 `tools`，没有按最终 `function.name` 去重，因此请求到 NewAPI 时出现重复函数名。

## 复现步骤

1. 启动本地 LobeHub，并打开诊断开关。

   已在 `.codex/start-dev.ps1` 加入：

   ```powershell
   $env:DEBUG_NEWAPI_SAFE_PAYLOAD = "1"
   $env:DEBUG_TOOL_DUPLICATE = "1"
   $env:NEXT_PUBLIC_DEBUG_TOOL_DUPLICATE = "1"
   ```

2. 使用 `数据科学家 📊` Agent。

   数据库确认：

   ```text
   agent_id          : agt_udqukA8UYJiL
   title             : 数据科学家 📊
   provider/model    : newapi / kimi-k2.6
   plugins           : ["emblemcompany-agent-skills"]
   ```

3. 向该 Agent 发送任意消息。NewAPI 会在请求校验阶段拒绝重复 `tools[*].function.name`。

4. 独立最小复现：直连 NewAPI，构造两个同名 tool。

   请求已脱敏，Authorization 未写入报告：

   ```json
   {
     "messages": [
       {
         "role": "user",
         "content": "duplicate tool validation test"
       }
     ],
     "model": "kimi-k2.6",
     "stream": false,
     "tools": [
       {
         "type": "function",
         "function": {
           "name": "emblemcompany-agent-skills____getPolyMarketEvents____mcp",
           "description": "duplicate A",
           "parameters": {
             "type": "object",
             "properties": {},
             "required": []
           }
         }
       },
       {
         "type": "function",
         "function": {
           "name": "emblemcompany-agent-skills____getPolyMarketEvents____mcp",
           "description": "duplicate B",
           "parameters": {
             "type": "object",
             "properties": {},
             "required": []
           }
         }
       }
     ]
   }
   ```

   NewAPI 返回：

   ```json
   {
     "Body": "{\"error\":{\"message\":\"Invalid request: function name emblemcompany-agent-skills____getPolyMarketEvents____mcp is duplicated\",\"type\":\"invalid_request_error\",\"param\":\"\",\"code\":null}}",
     "StatusCode": 400
   }
   ```

## 已加临时诊断日志

本次只加入受控日志，不改变去重行为。

| 位置                                                               | 作用                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/helpers/toolEngineering/index.ts`                             | 在 `createAgentToolsEngine` / `createToolsEngine` 打印 manifest 来源、最终生成的 function name、重复项 |
| `src/store/chat/agents/createAgentExecutors.ts`                    | 在当前前端 AgentRuntime 调 LLM 前打印 `resolvedAgentConfig.tools` 的 function name 列表                |
| `packages/agent-runtime/src/core/runtime.ts`                       | 在 package runtime 的 `call_llm` executor 调 `modelRuntime(payload)` 前打印 payload tools              |
| `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts` | 在 NewAPI 最终请求前打印安全版 payload 摘要和完整 `tools` 数组                                         |
| `.codex/start-dev.ps1`                                             | 自动打开上述 DEBUG 开关                                                                                |

关键代码路径：

- `src/helpers/toolEngineering/index.ts:214`：`createAgentToolsEngine`
- `src/helpers/toolEngineering/index.ts:152`：`createToolsEngine`
- `packages/context-engine/src/engine/tools/ToolsEngine.ts:99`：`generateToolsDetailed`
- `packages/context-engine/src/engine/tools/ToolsEngine.ts:261`：`convertManifestsToTools`
- `src/store/chat/agents/createAgentExecutors.ts:370`：`offeredToolNames`
- `src/services/chat/index.ts:314`：`createAssistantMessage` 将 `tools` 传给 `getChatCompletion`
- `src/services/chat/index.ts:472`：`fetchSSE` 提交请求体
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts:522`：组装 `finalPayload`
- `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts:605`：调用 `client.chat.completions.create(finalPayload, ...)`

## 完整日志（脱敏）

### Agent 与插件配置

```text
select id,title,provider,model,plugins
from agents
where plugins::text ilike '%emblemcompany-agent-skills%';

id                | title           | provider | model     | plugins
------------------+-----------------+----------+-----------+--------------------------------
agt_udqukA8UYJiL  | 数据科学家 📊   | newapi   | kimi-k2.6 | ["emblemcompany-agent-skills"]
```

```text
select user_id, identifier, type, source,
       jsonb_array_length(coalesce(manifest->'api','[]'::jsonb)) as api_count,
       manifest->>'type' as manifest_type
from user_installed_plugins
where identifier ilike '%emblem%'
   or manifest::text ilike '%getPolyMarketEvents%';

user_id                            | identifier                 | type   | source | api_count | manifest_type
-----------------------------------+----------------------------+--------+--------+-----------+--------------
user_2LKVypLf62RZNIxGtwVbkhCVqP3   | emblemcompany-agent-skills | plugin |        | 133       | mcp
```

```text
select user_id, id, name, identifier, source,
       jsonb_array_length(coalesce(manifest->'api','[]'::jsonb)) as api_count,
       manifest->>'type' as manifest_type
from agent_skills
where identifier ilike '%emblem%'
   or manifest::text ilike '%getPolyMarketEvents%';

0 rows
```

说明：不是 `agent_skills` 与 MCP 同时注册。当前来源是 `user_installed_plugins` 中一个 manifest，类型为 `mcp`。

### 重复 API 名

```text
with apis as (
  select identifier, elem->>'name' as api_name
  from user_installed_plugins, jsonb_array_elements(manifest->'api') elem
  where identifier='emblemcompany-agent-skills'
)
select api_name, count(*) as n
from apis
group by api_name
having count(*) > 1
order by n desc, api_name;

api_name                 | n
-------------------------+---
getPolyMarketEvents      | 2
getPolyMarketEventsByTag | 2
getPolyMarketTags        | 2
```

重复项位置：

```text
idx | api_name                 | description
----+--------------------------+---------------------------------------------------------------
104 | getPolyMarketEvents      | Get Polymarket events list. Returns compacted data.
110 | getPolyMarketEvents      | Get Polymarket events list. Returns compacted data optimized for efficiency.
105 | getPolyMarketEventsByTag | Get Polymarket events by tag/category
111 | getPolyMarketEventsByTag | Get Polymarket events filtered by tag/category
106 | getPolyMarketTags        | Get Polymarket categories/tags
112 | getPolyMarketTags        | Get Polymarket categories/tags for filtering events
```

### 最终 function.name 清单

`ToolNameResolver` 对 MCP manifest 的生成规则是：

```text
{identifier}____{api.name}____{type}
```

因此该 manifest 生成 133 个 tool function，其中以下清单包含重复项：

```text
1|emblemcompany-agent-skills____firecrawlExtract____mcp
2|emblemcompany-agent-skills____websearch____mcp
3|emblemcompany-agent-skills____baseFindClankerTokens____mcp
4|emblemcompany-agent-skills____baseGetBalances____mcp
5|emblemcompany-agent-skills____baseSwapQuote____mcp
6|emblemcompany-agent-skills____bscfindMemeCoinsViaFourMeme____mcp
7|emblemcompany-agent-skills____bscGetBalances____mcp
8|emblemcompany-agent-skills____bscSwapQuote____mcp
9|emblemcompany-agent-skills____isFourMemeToken____mcp
10|emblemcompany-agent-skills____getCoinglassBitcoinEtfList____mcp
11|emblemcompany-agent-skills____getCoinglassBitcoinETFNetAssetsHistory____mcp
12|emblemcompany-agent-skills____getCoinglassBitfinexMarginData____mcp
13|emblemcompany-agent-skills____getCoinglassBorrowInterestRate____mcp
14|emblemcompany-agent-skills____getCoinglassCDRIIndex____mcp
15|emblemcompany-agent-skills____getCoinglassCGDIIndex____mcp
16|emblemcompany-agent-skills____getCoinglassEthereumEtfList____mcp
17|emblemcompany-agent-skills____getCoinglassEthereumETFNetAssetsHistory____mcp
18|emblemcompany-agent-skills____getCoinglassExchangeAssets____mcp
19|emblemcompany-agent-skills____getCoinglassExchangeBalanceList____mcp
20|emblemcompany-agent-skills____getCoinglassFutureBasis____mcp
21|emblemcompany-agent-skills____getCoinglassFuturesWhaleIndex____mcp
22|emblemcompany-agent-skills____getCoinglassGrayscaleHoldings____mcp
23|emblemcompany-agent-skills____getCoinglassHyperliquidWhaleAlert____mcp
24|emblemcompany-agent-skills____getCoinglassHyperliquidWhalePosition____mcp
25|emblemcompany-agent-skills____getCoinglassOnChainTransfers____mcp
26|emblemcompany-agent-skills____getCoinglassOpenInterestHistory____mcp
27|emblemcompany-agent-skills____getCoinglassOptionsInfo____mcp
28|emblemcompany-agent-skills____getCoinglassPremiumIndex____mcp
29|emblemcompany-agent-skills____emblemGetCollectionAssets____mcp
30|emblemcompany-agent-skills____emblemGetDepositAddress____mcp
31|emblemcompany-agent-skills____emblemListCollections____mcp
32|emblemcompany-agent-skills____emblemListMyVaults____mcp
33|emblemcompany-agent-skills____emblemResolveAsset____mcp
34|emblemcompany-agent-skills____ethGetBalances____mcp
35|emblemcompany-agent-skills____ethSwapQuote____mcp
36|emblemcompany-agent-skills____hederaAccountIdToEvmAddress____mcp
37|emblemcompany-agent-skills____hederaContractIdToEvmAddress____mcp
38|emblemcompany-agent-skills____hederaFindMemeCoins____mcp
39|emblemcompany-agent-skills____hederaFindTokens____mcp
40|emblemcompany-agent-skills____hederaTokensSwapQuote____mcp
41|emblemcompany-agent-skills____nansen_defi_portfolio____mcp
42|emblemcompany-agent-skills____nansen_perp_positions____mcp
43|emblemcompany-agent-skills____nansen_pnl_leaderboard____mcp
44|emblemcompany-agent-skills____nansen_smart_money_flows____mcp
45|emblemcompany-agent-skills____nansen_smart_money_holdings____mcp
46|emblemcompany-agent-skills____nansen_smart_money_trades____mcp
47|emblemcompany-agent-skills____nansen_token_screener____mcp
48|emblemcompany-agent-skills____nansen_wallet_profiler____mcp
49|emblemcompany-agent-skills____nansen_who_bought_sold____mcp
50|emblemcompany-agent-skills____openseaGetBestListings____mcp
51|emblemcompany-agent-skills____openseaGetCollectionActivity____mcp
52|emblemcompany-agent-skills____openseaGetCollectionStats____mcp
53|emblemcompany-agent-skills____openseaGetMyNFTs____mcp
54|emblemcompany-agent-skills____openseaGetNFTListings____mcp
55|emblemcompany-agent-skills____openseaGetNFTOffers____mcp
56|emblemcompany-agent-skills____openseaGetTrendingCollections____mcp
57|emblemcompany-agent-skills____checkRuneUnlock____mcp
58|emblemcompany-agent-skills____getAlkaneAddressBalance____mcp
59|emblemcompany-agent-skills____getAlkaneAddressUTXOs____mcp
60|emblemcompany-agent-skills____getAlkaneInfo____mcp
61|emblemcompany-agent-skills____getBitcoinCollections____mcp
62|emblemcompany-agent-skills____getBRC20Activity____mcp
63|emblemcompany-agent-skills____getBRC20TokenInfo____mcp
64|emblemcompany-agent-skills____getBTCBalances____mcp
65|emblemcompany-agent-skills____getCollectionInfo____mcp
66|emblemcompany-agent-skills____getCollectionInscriptions____mcp
67|emblemcompany-agent-skills____getCollectionMarketInfo____mcp
68|emblemcompany-agent-skills____getCollectionVolume____mcp
69|emblemcompany-agent-skills____getCryptoPrice____mcp
70|emblemcompany-agent-skills____getInscriptionActivity____mcp
71|emblemcompany-agent-skills____getInscriptionInfo____mcp
72|emblemcompany-agent-skills____getInscriptionsByAddress____mcp
73|emblemcompany-agent-skills____getInscriptionTraits____mcp
74|emblemcompany-agent-skills____getLatestInscriptions____mcp
75|emblemcompany-agent-skills____getLatestRunes____mcp
76|emblemcompany-agent-skills____getMagicEdenRunePrice____mcp
77|emblemcompany-agent-skills____getOwnedInscriptionIds____mcp
78|emblemcompany-agent-skills____getRareSats____mcp
79|emblemcompany-agent-skills____getRecentStamps____mcp
80|emblemcompany-agent-skills____getRuneBalances____mcp
81|emblemcompany-agent-skills____getRuneInfo____mcp
82|emblemcompany-agent-skills____getRuneMarketInfo____mcp
83|emblemcompany-agent-skills____getRunesActivity____mcp
84|emblemcompany-agent-skills____getSatRangesForUTXO____mcp
85|emblemcompany-agent-skills____getSRC20Token____mcp
86|emblemcompany-agent-skills____getStamp____mcp
87|emblemcompany-agent-skills____getStampsByAddress____mcp
88|emblemcompany-agent-skills____getTopBRC20ByMarketCap____mcp
89|emblemcompany-agent-skills____getTopBRC20ByVolume____mcp
90|emblemcompany-agent-skills____getTopCollectionsByFloor____mcp
91|emblemcompany-agent-skills____getTopCollectionsByVolume____mcp
92|emblemcompany-agent-skills____getTopRunesByMarketCap____mcp
93|emblemcompany-agent-skills____getTopRunesByVolume____mcp
94|emblemcompany-agent-skills____getTrendingCoins____mcp
95|emblemcompany-agent-skills____getUtxoRunes____mcp
96|emblemcompany-agent-skills____getXCPBalances____mcp
97|emblemcompany-agent-skills____inscriptionTransferActivity____mcp
98|emblemcompany-agent-skills____listAlkanes____mcp
99|emblemcompany-agent-skills____listBRC20Tokens____mcp
100|emblemcompany-agent-skills____rareSatsForUTXO____mcp
101|emblemcompany-agent-skills____searchCryptoByName____mcp
102|emblemcompany-agent-skills____searchSRC20Tokens____mcp
103|emblemcompany-agent-skills____searchStamps____mcp
104|emblemcompany-agent-skills____getPolyMarketEvents____mcp
105|emblemcompany-agent-skills____getPolyMarketEventsByTag____mcp
106|emblemcompany-agent-skills____getPolyMarketTags____mcp
107|emblemcompany-agent-skills____polygonGetBalances____mcp
108|emblemcompany-agent-skills____polygonSwapQuote____mcp
109|emblemcompany-agent-skills____getPolyMarketEvent____mcp
110|emblemcompany-agent-skills____getPolyMarketEvents____mcp
111|emblemcompany-agent-skills____getPolyMarketEventsByTag____mcp
112|emblemcompany-agent-skills____getPolyMarketTags____mcp
113|emblemcompany-agent-skills____getPolyMarketUserPositions____mcp
114|emblemcompany-agent-skills____searchPolyMarketEvents____mcp
115|emblemcompany-agent-skills____birdeyeTradeData____mcp
116|emblemcompany-agent-skills____birdeyeTrendingTokens____mcp
117|emblemcompany-agent-skills____findPositionById____mcp
118|emblemcompany-agent-skills____getAllPositions____mcp
119|emblemcompany-agent-skills____getChangeNowSupportedCurrencies____mcp
120|emblemcompany-agent-skills____getChangeNowSwapQuote____mcp
121|emblemcompany-agent-skills____getLeaderboard____mcp
122|emblemcompany-agent-skills____listPositions____mcp
123|emblemcompany-agent-skills____searchEvmTokensBirdeye____mcp
124|emblemcompany-agent-skills____tokenMetadataInfo____mcp
125|emblemcompany-agent-skills____wallet____mcp
126|emblemcompany-agent-skills____discoverLaunchLabTokens____mcp
127|emblemcompany-agent-skills____findSolanaGems____mcp
128|emblemcompany-agent-skills____findSolanaSwapToken____mcp
129|emblemcompany-agent-skills____getPumpFunTokens____mcp
130|emblemcompany-agent-skills____rugcheck____mcp
131|emblemcompany-agent-skills____solanaBalances____mcp
132|emblemcompany-agent-skills____solanaGetTokenPairPrice____mcp
133|emblemcompany-agent-skills____solanaGetTokenPrices____mcp
```

## 根因分析

### 不是 NewAPI 网关错误

NewAPI 直连最小请求已复现同名 tool 被拒绝。OpenAI-compatible 工具调用协议要求 `tools[*].function.name` 在同一次请求中唯一，NewAPI 拒绝重复名称是合理行为。

### 不是 Skill 与 MCP 同时注册

`agent_skills` 表中没有 `emblemcompany-agent-skills` 或 `getPolyMarketEvents` 命中。`数据科学家 📊` Agent 的 `plugins` 只包含 `["emblemcompany-agent-skills"]`。重复来自同一个 installed plugin manifest 内部。

### 具体重复来源

数据库表 `user_installed_plugins` 中：

```text
identifier      = emblemcompany-agent-skills
type            = plugin
manifest.type   = mcp
manifest.api    = 133 items
```

其中 `manifest.api` 内部存在 3 组重复 API 名。由于工具名生成规则包含 `identifier + api.name + type`，重复 API 名会生成完全相同的 `function.name`：

```text
emblemcompany-agent-skills____getPolyMarketEvents____mcp
emblemcompany-agent-skills____getPolyMarketEventsByTag____mcp
emblemcompany-agent-skills____getPolyMarketTags____mcp
```

### LobeHub 当前链路为什么没有兜住

1. `src/helpers/toolEngineering/index.ts:158` 从 `pluginSelectors.installedPluginManifestList(...)` 取 installed plugins。
2. `src/helpers/toolEngineering/index.ts:240` 创建 `ToolsEngine`。
3. `packages/context-engine/src/engine/tools/ToolsEngine.ts:37` 用 `new Map(...)` 按 manifest identifier 去重，但这里只能去掉重复 manifest，不能去掉同一个 manifest 内部重复的 `api.name`。
4. `packages/context-engine/src/engine/tools/ToolsEngine.ts:261` 的 `convertManifestsToTools(...)` 直接执行 `manifest.api.map(...)`。
5. `src/store/chat/agents/createAgentExecutors.ts:370` 把 `resolvedAgentConfig.tools` 的名字作为本次 LLM offered tools。
6. `src/services/chat/index.ts:322` 将 `tools` 放进 payload。
7. `packages/model-runtime/src/core/openaiCompatibleFactory/index.ts:605` 发送给 NewAPI。

`packages/context-engine/src/engine/tools/ToolResolver.ts:69` 有一段按 `function.name` 去重的逻辑，但它用于 runtime step-level resolution；当前这条普通聊天请求链路在进入 NewAPI 前使用的是已经预生成的 `resolvedAgentConfig.tools`，没有经过这个去重兜底。

## 建议修复方案

先不直接改代码，建议评审后按以下顺序处理。

1. 在工具生成层统一按最终 `function.name` 去重。

   首选位置：
   - `packages/context-engine/src/engine/tools/ToolsEngine.ts:261`
   - `packages/context-engine/src/engine/tools/utils.ts:38`

   原因：这里是所有 manifest 转 wire tools 的公共出口。按最终 `function.name` 去重能同时覆盖：
   - 同一 MCP manifest 内 API 名重复
   - injected manifest 与 base tools 合并后重复
   - 后续 Skill / MCP /builtin source 混合时生成相同函数名

   行为建议：保留第一次出现的 tool，丢弃后续重复项，并在 DEBUG 或开发环境打印 warning，包含重复 `function.name`、manifest identifier、api name、source。

2. 在安装 / 同步 manifest 时增加校验。

   相关位置：
   - `packages/database/src/models/plugin.ts`
   - `packages/database/src/schemas/user.ts`
   - `src/server/modules/Mecha/AgentToolsEngine/index.ts`

   建议保存前检查 `manifest.api[*].name` 是否重复；如果来自远程 MCP/marketplace，可以先允许保存但标记 warning，运行时仍由第 1 条兜底。

3. 数据临时清理作为本地 unblock。

   可以从 `user_installed_plugins.manifest.api` 中移除 Polymarket 旧重复项，保留描述更完整的后 3 个：
   - 保留 idx 110：`getPolyMarketEvents`
   - 保留 idx 111：`getPolyMarketEventsByTag`
   - 保留 idx 112：`getPolyMarketTags`

   这只能修当前一条脏数据，不能替代代码层防御。

4. 回归测试。

   建议新增或扩展：
   - `packages/context-engine/src/engine/tools/__tests__/ToolsEngine.test.ts`
   - `packages/context-engine/src/engine/tools/__tests__/ToolResolver.test.ts`
   - 如需覆盖前端组装：`src/helpers/toolEngineering/index.test.ts`

   测试场景：
   - 单个 MCP manifest 内有两个同名 API，`generateToolsDetailed(...).tools` 只保留一个同名 `function.name`。
   - base tools + injected manifests 生成同名 `function.name`，最终 tools 无重复。
   - 保留第一个 tool 的 description/parameters，避免不可预期覆盖。

## 当前状态

- 已确认根因：同一个 `emblemcompany-agent-skills` MCP manifest 内部 API 名重复。
- 已确认 NewAPI 行为：重复 `function.name` 会返回 400。
- 已加入临时诊断日志：仅 DEBUG 开关下输出。
- 未执行最终修复：按 P01 要求，先交报告，修复代码待评审通过后再写。
