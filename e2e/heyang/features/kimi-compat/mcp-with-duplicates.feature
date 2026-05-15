@heyang @kimi @real-llm
Feature: Kimi MCP duplicate tool compatibility

  Scenario: 重复 api.name 的 MCP manifest 会被去重
    Given Kimi 测试配置已加载
    When 使用重复 api.name 的 MCP manifest 生成工具
    Then 生成的 Kimi 工具列表没有重复 function name

  Scenario: 重复 api.name 的 MCP 工具可真实调用
    Given Kimi 测试配置已加载
    When 使用重复 api.name 的 MCP 工具请求 Kimi
    Then Kimi 工具回合返回最终回复且没有 duplicate 错误

  Scenario: 无重复 api.name 的 MCP manifest 仍然兼容
    Given Kimi 测试配置已加载
    When 使用无重复 api.name 的 MCP 工具请求 Kimi
    Then Kimi 工具回合返回最终回复且没有 duplicate 错误
