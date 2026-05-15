@heyang @smoke
Feature: 衡阳本地环境 smoke test

  Scenario: 服务健康检查
    Given 调用 /api/health 端点
    Then 返回 200

  Scenario: 登录页正常渲染
    When 访问 /signin
    Then 看到登录按钮
    And 品牌名是「衡阳镭目」

  Scenario: 数据库连接正常
    When 调用任何需要 session 的 API
    Then 不返回 FAILED_TO_GET_SESSION
