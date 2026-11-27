@perf @render-budget
Feature: 流式输出时的渲染与内存预算
  作为用户，我希望 AI 流式回复时界面不卡顿、不越用越占内存：
  大段文本、密集工具调用、富文本回复，以及后台对话流式输出时前台话题的
  渲染次数、渲染耗时、最长帧间隔和堆内存增长都不超过预算。
  回复由 LLM mock 按固定节奏流式发出；预算在 e2e/src/performance/streamingRenderBudgets.ts。

  Background:
    Given 用户已登录系统
    And 用户有一个带多个历史话题的 Agent

  @PERF-STREAM-001
  Scenario: 大段文本流式输出
    When 用户多次在新对话中收到 "bigstream" 流式回复
    Then "bigstream" 流式场景的渲染与内存不超过预算

  @PERF-STREAM-002
  Scenario: 密集工具调用
    When 用户多次在新对话中收到 "toolstorm" 流式回复
    Then "toolstorm" 流式场景的渲染与内存不超过预算

  @PERF-STREAM-003
  Scenario: 富文本回复
    When 用户多次在新对话中收到 "richreply" 流式回复
    Then "richreply" 流式场景的渲染与内存不超过预算

  @PERF-STREAM-004
  Scenario: 后台对话流式输出时停留在另一个话题
    When 用户在一个对话流式输出时多次切换到另一个话题等待它完成
    Then "background" 流式场景的渲染与内存不超过预算
