Feature: Argument Character Counter
  The argument textarea enforces a 280-character limit with a live counter.
  The server also rejects over-limit submissions independently of the client.

  Background:
    Given the local game stack is running

  Scenario: Live counter updates and blocks over-limit submission
    Given a 3-player room is in the ARGUMENT phase
    When a player types 260 characters into the argument field
    Then the character counter shows "260 / 280"
    And the submit button is enabled

    When the player types 20 more characters
    Then the character counter shows "280 / 280"
    And the submit button is enabled

    When the player types 1 more character
    Then the character counter is in the "over-limit" state
    And the submit button is disabled

    When the player removes the last character
    Then the character counter shows "280 / 280"
    And the submit button is enabled

  Scenario: Server rejects an over-limit argument directly
    Given a 3-player room is in the ARGUMENT phase
    When a player directly submits a 281-character argument via the API
    Then the API returns status 400
    And the error message mentions the character limit
