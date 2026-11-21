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
    Given I navigate to "/marketplace/agent"
    When I type "developer" in the search bar
    And I wait for the search results to load
    Then I should see only "Code Assistant" in the assistant catalog

  @COMMUNITY-INTERACT-002 @P1
  Scenario: Filter assistants by category
    Given I navigate to "/marketplace/agent"
    When I open the assistant category "programming"
    And I wait for the filtered results to load
    Then I should see only "Code Assistant" in the assistant catalog
    And the URL should contain the category parameter

  @COMMUNITY-INTERACT-003 @P1
  Scenario: Navigate to next page of assistants
    Given I navigate to "/marketplace/agent"
    When I open the recommended assistants
    And I click the next page button
    Then I should be navigated to "/marketplace/agent?sort=recommended&page=2"
    And I should see the assistant cards for page two

  @COMMUNITY-INTERACT-004 @P1
  Scenario: Navigate to assistant detail page
    Given I navigate to "/marketplace/agent"
    When I click on the first assistant card
    Then I should be navigated to the assistant detail page
    And I should see the assistant detail content

  # ============================================
  # Model Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-005 @P1
  Scenario: Sort models
    Given I navigate to "/marketplace/model"
    When I click on the sort dropdown
    And I select a sort option
    And I wait for the sorted results to load
    Then I should see model cards in the sorted order

  @COMMUNITY-INTERACT-006 @P1
  Scenario: Navigate to model detail page
    Given I navigate to "/marketplace/model"
    When I click on the first model card
    Then I should be navigated to the model detail page
    And I should see the model detail content

  # ============================================
  # Provider Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-007 @P1
  Scenario: Navigate to provider detail page
    Given I navigate to "/marketplace/provider"
    When I click on the first provider card
    Then I should be navigated to the provider detail page
    And I should see the provider detail content

  # ============================================
  # MCP Page Interactions
  # ============================================

  @COMMUNITY-INTERACT-008 @P1
  Scenario: Browse a category in Connectors Discover
    Given I navigate to "/marketplace/connector"
    When I select the "Public" connector filter
    And I open the MCP category "developer"
    Then I should be navigated to "/marketplace/connector?category=developer&source=public"
    And I should see only these MCP cards
      | File Manager      |
      | Build Runner      |
      | Code Search       |
      | Container Manager |
      | Database Browser  |
      | Git Client        |
      | Log Viewer        |

  @COMMUNITY-INTERACT-009 @P1
  Scenario: Navigate to MCP detail page
    Given I navigate to "/marketplace/connector?source=public"
    When I click on the first MCP card
    Then I should be navigated to the MCP detail page
    And I should see the MCP detail content

  @COMMUNITY-INTERACT-010 @P1
  Scenario: Open an old marketplace bookmark with a search
    Given I navigate to "/community?q=developer"
    Then I should be navigated to "/marketplace/connector?q=developer"
    And the "Verified" connector filter should be selected
    When I select the "Public" connector filter
    Then I should see only these MCP cards
      | File Manager |
