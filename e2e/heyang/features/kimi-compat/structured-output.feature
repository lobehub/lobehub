@heyang @kimi @real-llm
Feature: Kimi structured output compatibility

  Scenario: json_object 返回对象
    Given Kimi 测试配置已加载
    When 请求 Kimi 返回 JSON 对象
    Then Kimi 返回合法 JSON

  Scenario: json_object 返回数组字段
    Given Kimi 测试配置已加载
    When 请求 Kimi 返回带数组字段的 JSON
    Then Kimi 返回合法 JSON

  Scenario: json_object 返回中文字段
    Given Kimi 测试配置已加载
    When 请求 Kimi 返回中文键 JSON
    Then Kimi 返回合法 JSON
