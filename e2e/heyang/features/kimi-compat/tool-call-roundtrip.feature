@heyang @kimi @real-llm
Feature: Kimi tool call roundtrip compatibility

  Scenario: 单工具调用
    Given Kimi 测试配置已加载
    When Kimi 执行单工具调用回合
    Then Kimi 工具回合返回最终回复且没有 reasoning_content 错误

  Scenario: 多工具串联
    Given Kimi 测试配置已加载
    When Kimi 执行搜索加沙箱多工具串联
    Then Kimi 工具回合返回最终回复且没有 reasoning_content 错误

  Scenario: 工具调用失败的恢复
    Given Kimi 测试配置已加载
    When Kimi 遇到工具错误并继续回复
    Then Kimi 工具回合返回最终回复且没有 reasoning_content 错误

  Scenario: thinking 参数不会进入工具回填请求
    Given Kimi 测试配置已加载
    When Kimi 执行带 thinking 的工具回填请求
    Then Kimi 工具回填请求已移除 thinking 参数
