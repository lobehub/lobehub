@journey @agent @conversation
Feature: Agent 对话用户体验链路
  作为用户，我希望能够与 AI 助手进行流畅的对话

  Background:
    Given 用户已登录系统

  @AGENT-CHAT-001 @P0 @smoke
  Scenario: 使用 Lobe AI 发送消息并获得回复
    Given 用户进入 Lobe AI 对话页面
    When 用户发送消息 "hello"
    Then 用户应该收到助手的回复
    And 回复内容应该可见

  @AGENT-CHAT-002 @P0
  Scenario: 多轮对话保持上下文
    Given 用户进入 Lobe AI 对话页面
    When 用户发送消息 "我的名字是小明"
    Then 用户应该收到助手的回复
    When 用户发送消息 "我刚才说我的名字是什么？"
    Then 用户应该收到助手的回复
    And 回复内容应该包含 "小明"

  @AGENT-CHAT-003 @P0
  Scenario: 清空对话历史
    Given 用户进入 Lobe AI 对话页面
    And 用户已发送消息 "hello"
    When 用户点击清空对话按钮
    Then 对话历史应该被清空
    And 页面应该显示欢迎界面

  @AGENT-CHAT-004 @P0
  Scenario: 重新生成回复
    Given 用户进入 Lobe AI 对话页面
    And 用户已发送消息 "hello"
    When 用户点击重新生成按钮
    Then 用户应该收到新的助手回复

  @AGENT-CHAT-005 @P0
  Scenario: 停止生成回复
    Given 用户进入 Lobe AI 对话页面
    When 用户发送消息 "写一篇很长的文章"
    And 用户在生成过程中点击停止按钮
    Then 回复应该停止生成
    And 已生成的内容应该保留
