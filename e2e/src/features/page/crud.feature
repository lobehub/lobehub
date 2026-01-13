@journey @P0 @page
Feature: Page 文稿 CRUD 操作

  作为用户，我希望能够创建、编辑和管理文稿页面，
  以便记录和组织我的笔记和文档

  Background:
    Given 用户已登录系统

  # ============================================
  # 创建
  # ============================================

  @PAGE-CREATE-001
  Scenario: 创建新文稿
    Given 用户在 Page 页面
    When 用户点击新建文稿按钮
    Then 应该创建一个新的文稿
    And 文稿列表中应该显示新文稿

  # ============================================
  # 重命名
  # ============================================

  @PAGE-RENAME-001
  Scenario: 通过右键菜单重命名文稿
    Given 用户在 Page 页面有一个文稿
    When 用户右键点击该文稿
    And 用户在菜单中选择重命名
    And 用户输入新的文稿名称 "My Renamed Page"
    Then 该文稿名称应该更新为 "My Renamed Page"

  @PAGE-RENAME-002 @P1
  Scenario: 重命名文稿后按 Enter 确认
    Given 用户在 Page 页面有一个文稿
    When 用户右键点击该文稿
    And 用户在菜单中选择重命名
    And 用户输入新的文稿名称 "Enter Confirmed Page" 并按 Enter
    Then 该文稿名称应该更新为 "Enter Confirmed Page"

  # ============================================
  # 复制
  # ============================================

  @PAGE-DUPLICATE-001 @P1
  Scenario: 复制文稿
    Given 用户在 Page 页面有一个文稿 "Original Page"
    When 用户右键点击该文稿
    And 用户在菜单中选择复制
    Then 文稿列表中应该出现 "Original Page (Copy)"

  # ============================================
  # 删除
  # ============================================

  @PAGE-DELETE-001
  Scenario: 删除文稿
    Given 用户在 Page 页面有一个文稿
    When 用户右键点击该文稿
    And 用户在菜单中选择删除
    And 用户在弹窗中确认删除
    Then 该文稿应该从列表中移除
