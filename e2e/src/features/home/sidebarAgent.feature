@journey @home @sidebar @agent
Feature: Home 页面 Agent 管理
  作为用户，我希望能够在 Home 页面管理 Agent

  Background:
    Given 用户已登录系统
    And 用户在 Home 页面有一个 Agent

  # ============================================
  # 重命名
  # ============================================

  @HOME-AGENT-RENAME-001 @P0
  Scenario: 通过右键菜单重命名 Agent
    When 用户右键点击该 Agent
    And 用户在菜单中选择重命名
    And 用户输入新的名称 "My Renamed Agent"
    Then 该项名称应该更新为 "My Renamed Agent"

  @HOME-AGENT-RENAME-002 @P0
  Scenario: 通过更多操作菜单重命名 Agent
    When 用户悬停在该 Agent 上
    And 用户点击更多操作按钮
    And 用户在菜单中选择重命名
    And 用户输入新的名称 "Agent From Menu"
    Then 该项名称应该更新为 "Agent From Menu"

  @HOME-AGENT-RENAME-003 @P1
  Scenario: 重命名后按 Enter 确认
    When 用户右键点击该 Agent
    And 用户在菜单中选择重命名
    And 用户输入新的名称 "Enter Confirmed" 并按 Enter
    Then 该项名称应该更新为 "Enter Confirmed"

  # ============================================
  # 置顶
  # ============================================

  @HOME-AGENT-PIN-001 @P1
  Scenario: 置顶 Agent
    Given 该 Agent 未被置顶
    When 用户右键点击该 Agent
    And 用户在菜单中选择置顶
    Then Agent 应该显示置顶图标

  @HOME-AGENT-PIN-002 @P1
  Scenario: 取消置顶 Agent
    Given 该 Agent 已被置顶
    When 用户右键点击该 Agent
    And 用户在菜单中选择取消置顶
    Then Agent 不应该显示置顶图标

  # ============================================
  # 删除
  # ============================================

  @HOME-AGENT-DELETE-001 @P0
  Scenario: 删除 Agent
    When 用户右键点击该 Agent
    And 用户在菜单中选择删除
    And 用户在弹窗中确认删除
    Then Agent 应该从列表中移除
