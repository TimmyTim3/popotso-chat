export const rollFairDie = () => {
  const values = new Uint32Array(1);
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / 6) * 6;
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0]! >= limit);
  return (values[0]! % 6) + 1;
};

export const shouldRollAgain = (dice: number, winner: string | null) => dice === 6 && winner === null;

/** If a player finishes a move on the opponent's square, send the opponent back to start. */
export const resolveLadderCollision = (positions: Record<string, number>, player: string, destination: number) => {
  const next = { ...positions, [player]: destination };
  const kickedPlayer = Object.keys(next).find((id) => id !== player && next[id] === destination) ?? null;
  if (kickedPlayer) next[kickedPlayer] = 0;
  return { positions: next, kickedPlayer };
};
