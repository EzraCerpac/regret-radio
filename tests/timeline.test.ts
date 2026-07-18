import { describe, expect, test } from "vitest";

import rawBundle from "../src/data/bundle.json";
import {
  compileSchedule,
  residualToMidi,
  trackDuration,
  workFraction,
} from "../src/timeline";
import type { RegretRadioBundleV1 } from "../src/types";

const bundle = rawBundle as RegretRadioBundleV1;
const overtake = bundle.payload.tracks.find((track) => track.id === "overtake")!;

describe("solver-work timeline", () => {
  test("uses the shared solver-work axis", () => {
    const work = 140_056;
    expect(workFraction(overtake, work)).toBe(work / overtake.baseline.solverPathWork);
    expect(trackDuration(overtake)).toBeCloseTo(15.1);
  });

  test("raises pitch monotonically as residual falls", () => {
    const initial = 10;
    const target = 0.001;
    const notes = [10, 1, 0.1, 0.01, 0.001].map((residual) =>
      residualToMidi(initial, residual, target),
    );
    expect(notes).toEqual([...notes].sort((left, right) => left - right));
    expect(notes.at(-1)).toBe(72);
  });

  test("speed changes timing, not semantic events", () => {
    const normal = compileSchedule(overtake, 1);
    const fast = compileSchedule(overtake, 2);
    expect(fast).toHaveLength(normal.length);
    normal.forEach((event, index) => {
      const spedUp = fast[index]!;
      expect(spedUp.kind).toBe(event.kind);
      expect(spedUp.lane).toBe(event.lane);
      expect(spedUp.actionId).toBe(event.actionId);
      expect(spedUp.frequency).toBe(event.frequency);
      expect(spedUp.entropy).toBe(event.entropy);
      expect(spedUp.time).toBeCloseTo(event.time / 2);
    });
  });

  test("an early terminal event leaves that lane silent", () => {
    const schedule = compileSchedule(overtake);
    const adaptiveTerminal = schedule.find(
      (event) => event.lane === "adaptive" && event.kind === "terminal",
    )!;
    const baselineTerminal = schedule.find(
      (event) => event.lane === "baseline" && event.kind === "terminal",
    )!;
    expect(adaptiveTerminal.time).toBeLessThan(baselineTerminal.time);
    expect(
      schedule.some(
        (event) => event.lane === "adaptive" && event.time > adaptiveTerminal.time,
      ),
    ).toBe(false);
  });

  test("compiles deterministically and preserves voice metadata", () => {
    const first = compileSchedule(overtake);
    expect(compileSchedule(overtake)).toEqual(first);
    const note = first.find((event) => event.kind === "note")!;
    expect(note.actionId).toBeDefined();
    expect(note.frequency).toBeGreaterThan(0);
    expect(note.pan).not.toBe(0);
  });
});
