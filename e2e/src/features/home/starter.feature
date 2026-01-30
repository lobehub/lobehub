@journey @home @starter
Feature: Home 页面 Starter 快捷创建功能
  作为用户，我希望在 Home 页面可以通过 Starter 快捷创建 Agent、Group 或文档，并跳转到对应页面

  Background:
    Given 用户已登录系统

  # ============================================
  # 创建 Agent 后侧边栏刷新
  # ============================================

  @HOME-STARTER-AGENT-001 @P0
  Scenario: 通过 Home 页面创建 Agent 后返回首页侧边栏应显示新创建的 Agent
    Given 用户在 Home 页面
    When 用户点击创建 Agent 按钮
    And 用户在输入框中输入 "E2E Test Agent"
    And 用户按 Enter 发送
    Then 页面应该跳转到 Agent 的 profile 页面
    When 用户返回 Home 页面
    Then 新创建的 Agent 应该在侧边栏中显示

  # ============================================
  # 创建 Group 后侧边栏刷新
  # ============================================

  @HOME-STARTER-GROUP-001 @P0
  Scenario: 通过 Home 页面创建 Group 后返回首页侧边栏应显示新创建的 Group
    Given 用户在 Home 页面
    When 用户点击创建 Group 按钮
    And 用户在输入框中输入 "E2E Test Group"
    And 用户按 Enter 发送
    Then 页面应该跳转到 Group 的 profile 页面
    When 用户返回 Home 页面
    Then 新创建的 Group 应该在侧边栏中显示

  # ============================================
  # 创建文档并跳转到写作页面
  # ============================================

  @HOME-STARTER-WRITE-001 @P0
  Scenario: 通过 Home 页面快捷创建文档并跳转到写作页面
    Given 用户在 Home 页面
    When 用户点击写作按钮
    And 用户在输入框中输入 "帮我写一篇关于人工智能的文章"
    And 用户按 Enter 发送创建文档
    Then 页面应该跳转到文档编辑页面
    And Page Agent 应该收到用户的提示词
