@journey @home @sidebar @group
Feature: Home 页面 Agent Group 管理
  作为用户，我希望能够在 Home 页面管理 Agent Group

  Background:
    Given 用户已登录系统
    And 用户在 Home 页面有一个 Agent Group

  # ============================================
  # 重命名
  # ============================================

  @HOME-GROUP-RENAME-001 @P0
  Scenario: 通过右键菜单重命名 Agent Group
    When 用户右键点击该 Agent Group
    And 用户在菜单中选择重命名
    And 用户输入新的名称 "My Renamed Group"
    Then 该项名称应该更新为 "My Renamed Group"

  @HOME-GROUP-RENAME-002 @P0
  Scenario: 通过更多操作菜单重命名 Agent Group
    When 用户悬停在该 Agent Group 上
    And 用户点击更多操作按钮
    And 用户在菜单中选择重命名
    And 用户输入新的名称 "Group From Menu"
    Then 该项名称应该更新为 "Group From Menu"

  @HOME-GROUP-RENAME-003 @P1
  Scenario: 重命名后按 Enter 确认
    When 用户右键点击该 Agent Group
    And 用户在菜单中选择重命名
    And 用户输入新的名称 "Enter Confirmed" 并按 Enter
    Then 该项名称应该更新为 "Enter Confirmed"

  # ============================================
  # 置顶
  # ============================================

  @HOME-GROUP-PIN-001 @P1
  Scenario: 置顶 Agent Group
    Given 该 Agent Group 未被置顶
    When 用户右键点击该 Agent Group
    And 用户在菜单中选择置顶
    Then Agent Group 应该显示置顶图标

  @HOME-GROUP-PIN-002 @P1
  Scenario: 取消置顶 Agent Group
    Given 该 Agent Group 已被置顶
    When 用户右键点击该 Agent Group
    And 用户在菜单中选择取消置顶
    Then Agent Group 不应该显示置顶图标

  # ============================================
  # 删除
  # ============================================

  @HOME-GROUP-DELETE-001 @P0
  Scenario: 删除 Agent Group
    When 用户右键点击该 Agent Group
    And 用户在菜单中选择删除
    And 用户在弹窗中确认删除
    Then Agent Group 应该从列表中移除
