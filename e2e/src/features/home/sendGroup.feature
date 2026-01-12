@journey @home @send-group
Feature: Home 页面通过 sendAsGroup 创建 Agent Group
  作为用户，我希望在 Home 页面可以通过创建 Group 模式快速创建一个 Agent Group，返回首页后在侧边栏中看到它

  Background:
    Given 用户已登录系统

  # ============================================
  # 创建 Group 后侧边栏刷新
  # ============================================

  @HOME-SEND-GROUP-001 @P0
  Scenario: 通过 Home 页面创建 Group 后返回首页侧边栏应显示新创建的 Group
    Given 用户在 Home 页面
    When 用户点击创建 Group 按钮
    And 用户在输入框中输入 "E2E Test Group"
    And 用户按 Enter 发送
    Then 页面应该跳转到 Group 的 profile 页面
    When 用户返回 Home 页面
    Then 新创建的 Group "E2E Test Group" 应该在侧边栏中显示
