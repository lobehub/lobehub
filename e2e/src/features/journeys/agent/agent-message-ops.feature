@journey @agent @message-ops
Feature: Agent 消息操作用户体验链路
  作为用户，我希望能够对消息进行各种操作

  Background:
    Given 用户已登录系统
    And 用户进入 Lobe AI 对话页面
    And 用户已发送消息 "hello"

  @AGENT-MSG-001 @P1
  Scenario: 复制消息内容
    When 用户点击消息的复制按钮
    Then 消息内容应该被复制到剪贴板

  @AGENT-MSG-002 @P1
  Scenario: 编辑助手消息
    When 用户点击助手消息的编辑按钮
    And 用户修改消息内容为 "这是编辑后的内容"
    And 用户保存编辑
    Then 消息内容应该更新为 "这是编辑后的内容"

  @AGENT-MSG-003 @P1
  Scenario: 删除单条消息
    When 用户点击消息的更多操作按钮
    And 用户选择删除消息选项
    And 用户确认删除消息
    Then 该消息应该从对话中移除

  @AGENT-MSG-004 @P1
  Scenario: 折叠和展开消息
    When 用户点击消息的更多操作按钮
    And 用户选择折叠消息选项
    Then 消息内容应该被折叠
    When 用户点击消息的更多操作按钮
    And 用户选择展开消息选项
    Then 消息内容应该完整显示
