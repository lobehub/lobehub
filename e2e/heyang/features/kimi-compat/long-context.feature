@heyang @kimi @real-llm
Feature: Kimi long context compatibility

  Scenario: 8K 上下文请求成功
    Given Kimi 测试配置已加载
    When 发送 Kimi 8K 上下文请求
    Then Kimi 返回非空回复

  Scenario: 8K 上下文开头信息可引用
    Given Kimi 测试配置已加载
    When 发送包含开头哨兵的 Kimi 8K 上下文请求
    Then Kimi 回复包含哨兵 "START-SENTINEL-42"

  Scenario: 8K 上下文结尾信息可引用
    Given Kimi 测试配置已加载
    When 发送包含结尾哨兵的 Kimi 8K 上下文请求
    Then Kimi 回复包含哨兵 "END-SENTINEL-84"
