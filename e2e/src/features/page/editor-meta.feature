@journey @P0 @page
Feature: Page 编辑器元数据编辑

  作为用户，我希望能够编辑文稿的标题和图标，
  以便更好地组织和识别我的文档

  Background:
    Given 用户已登录系统

  # ============================================
  # 标题编辑
  # ============================================

  @PAGE-TITLE-001
  Scenario: 编辑文稿标题
    Given 用户打开一个文稿编辑器
    When 用户点击标题输入框
    And 用户输入标题 "我的测试文稿"
    And 用户按下 Enter 键
    Then 文稿标题应该更新为 "我的测试文稿"

  @PAGE-TITLE-002 @P1
  Scenario: 编辑标题后点击其他区域保存
    Given 用户打开一个文稿编辑器
    When 用户点击标题输入框
    And 用户输入标题 "Click Away Title"
    And 用户点击编辑器内容区域
    Then 文稿标题应该更新为 "Click Away Title"

  @PAGE-TITLE-003 @P1
  Scenario: 清空标题后显示占位符
    Given 用户打开一个文稿编辑器
    When 用户点击标题输入框
    And 用户清空标题内容
    Then 应该显示标题占位符

  # ============================================
  # Emoji 图标
  # ============================================

  @PAGE-EMOJI-001 @P1
  Scenario: 为文稿添加 Emoji 图标
    Given 用户打开一个文稿编辑器
    When 用户点击选择图标按钮
    And 用户选择一个 Emoji
    Then 文稿应该显示所选的 Emoji 图标

  @PAGE-EMOJI-002 @P1
  Scenario: 更换文稿的 Emoji 图标
    Given 用户打开一个带有 Emoji 的文稿
    When 用户点击已有的 Emoji 图标
    And 用户选择另一个 Emoji
    Then 文稿图标应该更新为新的 Emoji

  @PAGE-EMOJI-003 @P2
  Scenario: 删除文稿的 Emoji 图标
    Given 用户打开一个带有 Emoji 的文稿
    When 用户点击已有的 Emoji 图标
    And 用户点击删除图标按钮
    Then 文稿不应该显示 Emoji 图标
