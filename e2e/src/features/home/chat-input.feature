@journey @home @chat-input
Feature: Home 页面默认 Chat Input 发送链路
  作为用户，我希望首次从 Home 页面发送默认消息时，可以稳定进入新建 Topic 对话页面

  Background:
    Given 用户已登录系统

  @HOME-CHAT-COLD-001 @P0
  Scenario: 首次打开 Agent 路由且无缓存时，Home 默认输入发送后应跳转到新建 Topic
    Given 用户在冷启动 Home 页面并延迟 Agent 路由加载
    When 用户在输入框中输入 "cold route home message"
    And 用户按 Enter 从 Home 默认输入发送
    Then 页面应该跳转到新建 Topic 对话页面
    And 用户消息 "cold route home message" 应该保留在对话中
