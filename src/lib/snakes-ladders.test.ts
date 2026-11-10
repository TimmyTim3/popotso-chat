import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rollFairDie, shouldRollAgain, resolveLadderCollision } from "./snakes-ladders";

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

describe("Snakes and Ladders collision rules", () => {
  it("sends the opponent back to start when a player lands on their square", () => {
    const result = resolveLadderCollision({ player: 12, opponent: 18 }, "player", 18);
    assert.deepEqual(result.positions, { player: 18, opponent: 0 });
    assert.equal(result.kickedPlayer, "opponent");
  });

  it("does not move the opponent when the landing square is empty", () => {
    const result = resolveLadderCollision({ player: 12, opponent: 18 }, "player", 20);
    assert.deepEqual(result.positions, { player: 20, opponent: 18 });
    assert.equal(result.kickedPlayer, null);
  });

  it("does not kick the moving player when they remain on their own square", () => {
    const result = resolveLadderCollision({ player: 12, opponent: 18 }, "player", 12);
    assert.deepEqual(result.positions, { player: 12, opponent: 18 });
    assert.equal(result.kickedPlayer, null);
  });
});
