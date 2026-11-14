@perf @render-budget
Feature: 打开与切换 chat 的渲染预算
  作为用户，我希望打开 chat 页面和在话题之间切换时界面不卡顿：
  侧栏、会话区、消息区各自的渲染次数和渲染耗时，以及最长帧间隔都不超过预算。
  只在 LOBE_REACT_PROFILING=1 构建上运行（E2E_PERF=1），预算在 e2e/src/performance/chatRenderBudgets.ts。

  Background:
    Given 用户已登录系统
    And 用户有一个带多个历史话题的 Agent

  @PERF-CHAT-001
  Scenario: 打开 chat 页面
    When 用户多次打开该 Agent 的 chat 页面
    Then "open" 场景的渲染不超过预算

  @PERF-CHAT-002
  Scenario: 切换到已缓存的话题
    When 用户在已打开过的话题之间来回切换
    Then "switchCached" 场景的渲染不超过预算

  @PERF-CHAT-003
  Scenario: 刷新页面后切换到话题
    When 用户每次刷新页面后切换到另一个话题
    Then "switchUncached" 场景的渲染不超过预算

  @PERF-CHAT-004
  Scenario: 冷启动后切换到话题
    When 用户每次在全新的浏览器环境中打开 chat 后切换到另一个话题
    Then "switchCold" 场景的渲染不超过预算
