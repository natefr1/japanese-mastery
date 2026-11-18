import { describe, expect, it } from "vitest";
import { blocked, DOORS, nearDoor, TILE } from "./Explore";

describe("exploration collisions and doors", () => {
  it("walls, buildings and water block; roads don't", () => {
    expect(blocked(TILE * 0.5, TILE * 7)).toBe(true); // outer wall
    expect(blocked(TILE * 3, TILE * 2)).toBe(true); // inside the apartment block
    expect(blocked(TILE * 12, TILE * 6.6)).toBe(false); // road
    expect(blocked(TILE * 14.5, TILE * 13.5)).toBe(true); // pond
  });
  it("every door is reachable and detectable from the tile in front of it", () => {
    for (const d of DOORS) {
      const x = d.x * TILE + TILE / 2;
      const y = d.y * TILE + TILE / 2 + 4;
      expect(blocked(x, y)).toBe(false);
      expect(nearDoor(x, y)?.id).toBe(d.id);
    }
  });
});
