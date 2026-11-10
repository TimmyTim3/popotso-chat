import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rollFairDie, shouldRollAgain } from "./snakes-ladders";

describe("Snakes and Ladders dice rules", () => {
  it("grants another turn when a player rolls a six", () => {
    assert.equal(shouldRollAgain(6, null), true);
  });

  it("does not grant another turn on a non-six roll", () => {
    assert.equal(shouldRollAgain(5, null), false);
  });

  it("ends the game instead of granting another turn after a win", () => {
    assert.equal(shouldRollAgain(6, "You win!"), false);
  });

  it("always returns an integer from one to six", () => {
    for (let roll = 0; roll < 100; roll += 1) {
      const result = rollFairDie();
      assert.equal(Number.isInteger(result), true);
      assert.equal(result >= 1 && result <= 6, true);
    }
  });
});