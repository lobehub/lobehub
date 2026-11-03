@journey @agent @conversation-mgmt
Feature: Agent 对话管理用户体验链路
  作为用户，我希望能够管理我的对话历史

  Background:
    Given 用户已登录系统
    And 用户进入 Lobe AI 对话页面

  @AGENT-CONV-001 @P0
  Scenario: 创建新对话
    Given 用户已有一个对话
    When 用户点击新建对话按钮
    Then 应该创建一个新的空白对话
    And 页面应该显示欢迎界面

  @AGENT-CONV-002 @P0
  Scenario: 切换不同对话
    Given 用户有多个对话历史
    When 用户点击另一个对话
    Then 应该切换到该对话
    And 显示该对话的历史消息

  @AGENT-CONV-003 @P0
  Scenario: 重命名对话
    Given 用户已有一个对话
    When 用户右键点击对话
    And 用户选择重命名选项
    And 用户输入新的对话名称 "测试对话"
    Then 对话名称应该更新为 "测试对话"

  @AGENT-CONV-004 @P0
  Scenario: 删除对话
    Given 用户有多个对话历史
    When 用户右键点击一个对话
    And 用户选择删除选项
    And 用户确认删除
    Then 该对话应该被删除
    And 对话列表中不再显示该对话

  @AGENT-CONV-005 @P1
  Scenario: 搜索历史对话
    Given 用户有多个对话历史
    When 用户在搜索框中输入 "测试"
    Then 应该显示包含 "测试" 的对话
    And 不相关的对话应该被过滤
