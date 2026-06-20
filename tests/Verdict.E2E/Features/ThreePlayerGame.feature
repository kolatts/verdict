Feature: Three-Player Game
  A complete multiplayer game of Verdict played by three simultaneous players.
  Verifies the full round-trip: lobby → argument → vote → reveal → final.

  Background:
    Given the local game stack is running

  Scenario: Complete two-round game with all three players
    # ── Lobby ──────────────────────────────────────────────────────────────
    Given "Judge" creates a room with 2 rounds and these takes:
      | Take                               |
      | Open offices were a war crime      |
      | Unlimited PTO means zero PTO       |
    And "Alice" joins the room
    And "Bob" joins the room
    Then the lobby for "Judge" shows 3 players
    And the room is locked

    # ── Round 1: Arguments ─────────────────────────────────────────────────
    When "Judge" starts the game
    Then all players are in the "ARGUMENT" phase for round 1
    And "Judge" sees their own side but not "Alice"'s side
    And "Alice" sees their own side but not "Bob"'s side

    When "Judge" submits the argument "Open offices are an affront to human dignity and productivity."
    And "Alice" submits the argument "Face-to-face collaboration cannot be replicated without the office."
    And "Bob" submits the argument "The problem was poor implementation not the concept itself."
    Then all players are in the "VOTE" phase

    # ── Round 1: Voting ────────────────────────────────────────────────────
    And "Judge" sees 3 anonymous argument cards
    And argument cards shown to "Judge" contain no author names

    When "Judge" votes for the argument containing "Face-to-face" with stance "AGREE"
    And "Alice" votes for the argument containing "problem was poor" with stance "DISAGREE"
    And "Bob" votes for the argument containing "affront to human dignity" with stance "AGREE"
    Then all players are in the "REVEAL" phase

    # ── Round 1: Reveal ────────────────────────────────────────────────────
    And "Judge" sees the author "Alice" revealed on the "Face-to-face" argument
    And "Judge" sees the author "Bob" revealed on the "problem was poor" argument
    And scores have been updated correctly

    # ── Round 2 ────────────────────────────────────────────────────────────
    When "Judge" advances to the next round
    Then all players are in the "ARGUMENT" phase for round 2

    When all players submit their round 2 arguments
    And all players cast their round 2 votes
    Then all players are in the "REVEAL" phase

    # ── Final leaderboard ──────────────────────────────────────────────────
    When "Judge" advances to the final leaderboard
    Then all players are in the "FINAL" phase
    And the final leaderboard shows cumulative scores for all 3 players
