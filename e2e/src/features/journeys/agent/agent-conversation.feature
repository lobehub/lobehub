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
