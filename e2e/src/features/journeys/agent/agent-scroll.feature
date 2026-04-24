@journey @agent @conversation @scroll
Feature: 发送消息与流式输出期间的视口滚动行为
  作为用户，我希望视口能按我的设置正确响应 AI 流式输出：
  - 开启时视口应跟随最新内容，保持贴近底部
  - 关闭时视口应停留在我刚发送的消息，便于阅读
  - 流式过程中我手动向上滚动后，视口不应被自动拉回底

  Background:
    Given 用户已登录系统

  @AGENT-SCROLL-001 @P0 @journey
  Scenario: 开启流式自动滚动后，视口在流式输出结束时贴近底部
    Given 用户在设置中开启 "AI 回复时自动滚动"
    And 用户进入 Lobe AI 对话页面
    When 用户发送长文消息并等待回复完成
    Then 视口应贴近聊天列表底部

  @AGENT-SCROLL-002 @P0 @journey
  Scenario: 关闭流式自动滚动后，用户消息固定在顶部且视口不跟随
    Given 用户在设置中关闭 "AI 回复时自动滚动"
    And 用户进入 Lobe AI 对话页面
    When 用户发送长文消息并等待回复完成
    Then 用户消息应固定在聊天列表顶部
    And 视口不应贴近聊天列表底部

  @AGENT-SCROLL-003 @P0 @journey
  Scenario: 流式输出过程中手动向上滚动，视口不会被自动拉回底
    Given 用户在设置中开启 "AI 回复时自动滚动"
    And 流式响应被放慢以模拟长文输出
    And 用户进入 Lobe AI 对话页面
    When 用户发送一条触发长文输出的消息
    And 用户在流式响应进行中向上滚动 200 像素
    And 等待流式响应结束
    Then 视口不应贴近聊天列表底部

  @AGENT-SCROLL-004 @P0 @journey
  Scenario: 发送消息后，滚动条自动把用户发送的消息顶到列表顶部
    Given 流式响应被放慢以模拟长文输出
    And 用户进入 Lobe AI 对话页面
    When 用户发送一条触发长文输出的消息
    Then 用户消息应固定在聊天列表顶部
