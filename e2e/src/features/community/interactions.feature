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
    Given I navigate to "/community/agent"
    When I type "developer" in the search bar
    And I wait for the search results to load
    Then I should see filtered assistant cards

  @COMMUNITY-INTERACT-002 @P1
  Scenario: Filter assistants by category
    Given I navigate to "/community/agent"
    When I click on a category in the category menu
    And I wait for the filtered results to load
    Then I should see assistant cards filtered by the selected category
    And the URL should contain the category parameter

  @COMMUNITY-INTERACT-003 @P1
  Scenario: Navigate to next page of assistants
    Given I navigate to "/community/agent"
    When I click the next page button
    And I wait for the next page to load
    Then I should see different assistant cards
    And the URL should contain the page parameter

  @COMMUNITY-INTERACT-004 @P1
  Scenario: Navigate to assistant detail page
    Given I navigate to "/community/agent"
    When I click on the first assistant card
    Then I should be navigated to the assistant detail page
    And I should see the assistant detail content

  # Models / Model Providers are hidden from the Marketplace (routes redirect to the
  # Marketplace home, see src/spa/router/communityHiddenRoutes.tsx). Their scenarios are
  # kept under @skip until the pages are either restored or deleted for good.

  # ============================================
  # Model Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-005 @P1 @skip
  Scenario: Sort models
    Given I navigate to "/community/model"
    When I click on the sort dropdown
    And I select a sort option
    And I wait for the sorted results to load
    Then I should see model cards in the sorted order

  @COMMUNITY-INTERACT-006 @P1 @skip
  Scenario: Navigate to model detail page
    Given I navigate to "/community/model"
    When I click on the first model card
    Then I should be navigated to the model detail page
    And I should see the model detail content

  # ============================================
  # Provider Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-007 @P1 @skip
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
  Scenario: Inspect a connector without leaving the catalogue
    Given I navigate to "/community/mcp"
    When I click on the first MCP card
    Then I should see its details in a dialog on the same page

  # ============================================
  # Home Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-010 @P1
  Scenario: Navigate from the Marketplace to Skills
    Given I navigate to "/community"
    When I open the "skill" Marketplace directory
    Then I should be navigated to "/community/skill"
    And I should see the page body

  @COMMUNITY-INTERACT-011 @P1
  Scenario: Navigate from home to MCP list
    Given I navigate to "/community"
    When I open the "mcp" Marketplace directory
    Then I should be navigated to "/community/mcp"
    And I should see the page body

  @COMMUNITY-INTERACT-012 @P1
  Scenario: Open an assistant from the Marketplace entry
    Given I navigate to "/community"
    When I click on the first assistant card
    Then I should be navigated to the assistant detail page
    And I should see the assistant detail content
