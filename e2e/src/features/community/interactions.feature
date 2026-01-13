@community @interactions
Feature: Discover Interactions
  Tests for user interactions within the discover module

  Background:
    Given the application is running

  # ============================================
  # Assistant Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-001 @P1
  Scenario: Search for assistants
    Given I navigate to "/community/assistant"
    When I type "developer" in the search bar
    And I wait for the search results to load
    Then I should see filtered assistant cards

  @COMMUNITY-INTERACT-002 @P1
  Scenario: Filter assistants by category
    Given I navigate to "/community/assistant"
    When I click on a category in the category menu
    And I wait for the filtered results to load
    Then I should see assistant cards filtered by the selected category
    And the URL should contain the category parameter

  @COMMUNITY-INTERACT-003 @P1
  Scenario: Navigate to next page of assistants
    Given I navigate to "/community/assistant"
    When I click the next page button
    And I wait for the next page to load
    Then I should see different assistant cards
    And the URL should contain the page parameter

  @COMMUNITY-INTERACT-004 @P1
  Scenario: Navigate to assistant detail page
    Given I navigate to "/community/assistant"
    When I click on the first assistant card
    Then I should be navigated to the assistant detail page
    And I should see the assistant detail content

  # ============================================
  # Model Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-005 @P1
  Scenario: Sort models
    Given I navigate to "/community/model"
    When I click on the sort dropdown
    And I select a sort option
    And I wait for the sorted results to load
    Then I should see model cards in the sorted order

  @COMMUNITY-INTERACT-006 @P1
  Scenario: Navigate to model detail page
    Given I navigate to "/community/model"
    When I click on the first model card
    Then I should be navigated to the model detail page
    And I should see the model detail content

  # ============================================
  # Provider Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-007 @P1
  Scenario: Navigate to provider detail page
    Given I navigate to "/community/provider"
    When I click on the first provider card
    Then I should be navigated to the provider detail page
    And I should see the provider detail content

  # ============================================
  # MCP Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-008 @P1
  Scenario: Filter MCP tools by category
    Given I navigate to "/community/mcp"
    When I click on a category in the category filter
    And I wait for the filtered results to load
    Then I should see MCP cards filtered by the selected category

  @COMMUNITY-INTERACT-009 @P1
  Scenario: Navigate to MCP detail page
    Given I navigate to "/community/mcp"
    When I click on the first MCP card
    Then I should be navigated to the MCP detail page
    And I should see the MCP detail content

  # ============================================
  # Home Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-010 @P1
  Scenario: Navigate from home to assistant list
    Given I navigate to "/community"
    When I click on the "more" link in the featured assistants section
    Then I should be navigated to "/community/assistant"
    And I should see the page body

  @COMMUNITY-INTERACT-011 @P1
  Scenario: Navigate from home to MCP list
    Given I navigate to "/community"
    When I click on the "more" link in the featured MCP tools section
    Then I should be navigated to "/community/mcp"
    And I should see the page body

  @COMMUNITY-INTERACT-012 @P1
  Scenario: Click featured assistant from home
    Given I navigate to "/community"
    When I click on the first featured assistant card
    Then I should be navigated to the assistant detail page
    And I should see the assistant detail content
