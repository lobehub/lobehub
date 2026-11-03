Feature: Agent 运行时协调器
  作为一个使用 Agent 运行时系统的开发者
  我想要协调智能体状态管理和事件流
  以便我能够正确跟踪智能体生命周期并处理事件

  Background:
    Given 智能体运行时系统已经启动
    And 协调器已经初始化完成

  Scenario: 创建新的智能体会话
    When 我创建一个新的智能体会话 "chat-session-001"
    And 会话配置为:
      | 字段          | 值                    |
      | 用户ID        | user-12345           |
      | 模型配置      | GPT-4 温度0.7        |
      | 智能体类型    | 对话助理             |
    Then 会话应该成功创建
    And 系统应该发布会话初始化事件
    And 事件应该包含会话的基本信息

  Scenario: 智能体执行任务并完成
    Given 智能体会话 "chat-session-001" 已经创建
    And 智能体当前状态为 "运行中"
    When 智能体完成所有任务
    And 会话状态更新为 "已完成"
    Then 系统应该保存最终状态
    And 应该发布会话结束事件
    And 事件应该包含执行结果和统计信息

  Scenario: 智能体正在执行任务
    Given 智能体会话 "chat-session-001" 已经创建
    And 智能体当前状态为 "空闲"
    When 智能体开始执行任务
    And 会话状态更新为 "运行中"
    Then 系统应该保存当前状态
    But 不应该发布会话结束事件

  Scenario: 完成单个执行步骤
    Given 智能体会话 "chat-session-001" 正在运行
    When 智能体完成第5个执行步骤
    And 该步骤标记为最终步骤
    Then 系统应该保存步骤结果
    And 应该发布会话结束事件
    And 事件应该包含完整的执行历史

  Scenario: 完成中间执行步骤
    Given 智能体会话 "chat-session-001" 正在运行
    When 智能体完成第3个执行步骤
    And 该步骤不是最终步骤
    Then 系统应该保存步骤结果
    But 不应该发布会话结束事件

  Scenario: 查询智能体执行状态
    Given 智能体会话 "chat-session-001" 存在
    When 我查询会话的当前状态
    Then 应该返回最新的状态信息
    And 信息应该包含当前步骤数和执行状态

  Scenario: 查询会话元数据
    Given 智能体会话 "chat-session-001" 存在
    When 我查询会话的元数据
    Then 应该返回会话的配置信息
    And 信息应该包含用户ID、模型配置和创建时间

  Scenario: 查询执行历史
    Given 智能体会话 "chat-session-001" 已经执行了多个步骤
    When 我查询最近10步的执行历史
    Then 应该返回包含10个步骤的历史记录
    And 每个记录应该包含步骤索引、执行时间和状态

  Scenario: 清理会话资源
    Given 智能体会话 "chat-session-001" 已经完成
    When 我删除该会话
    Then 会话的所有数据应该被清理
    And 相关的事件流数据也应该被清理

  Scenario: 断开系统连接
    Given 协调器正在运行中
    When 我关闭协调器
    Then 所有的数据库连接应该被正确关闭
    And 所有的资源应该被释放

  Scenario: 获取系统统计信息
    Given 系统中存在多个智能体会话
    When 我查询系统统计信息
    Then 应该返回活跃会话数量
    And 应该返回已完成会话数量
    And 应该返回出错会话数量

  Scenario: 清理过期会话
    Given 系统中存在一些长时间未活跃的会话
    When 我执行过期会话清理
    Then 超过保留期限的会话应该被删除
    And 应该返回清理的会话数量
