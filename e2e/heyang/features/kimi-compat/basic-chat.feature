@heyang @kimi @real-llm
Feature: Kimi basic chat compatibility

  Scenario: 简单问候
    Given Kimi 测试配置已加载
    When 发送 Kimi 简单问候
    Then Kimi 返回非空回复

  Scenario: 多轮上下文记忆
    Given Kimi 测试配置已加载
    When 进行 Kimi 两轮上下文记忆对话
    Then Kimi 第二轮能引用第一轮暗号

  Scenario: 流式输出
    Given Kimi 测试配置已加载
    When 请求 Kimi 流式输出
    Then 至少收到 2 个 Kimi 流式 chunk
