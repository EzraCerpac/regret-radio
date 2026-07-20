import { describe, expect, test } from "vitest";

import rawBundle from "../src/data/bundle.json";
import {
  buildTransmissionIndexRows,
  countActionSwitches,
  familyLabel,
  startKindLabel,
} from "../src/transmission-index";
import type { RegretRadioBundleV1 } from "../src/types";

const bundle = rawBundle as RegretRadioBundleV1;

describe("transmission index", () => {
  test("orders curated stories by case identity, not outcome", () => {
    const rows = buildTransmissionIndexRows(bundle.payload.tracks);
    expect(rows.map((row) => row.track.id)).toEqual([
      "switchboard",
      "stall",
      "wrong-turn",
      "escape",
      "overtake",
      "uncertain-unison",
    ]);

    const changedWork = structuredClone(bundle.payload.tracks);
    changedWork[0]!.adaptive.solverPathWork = 1;
    changedWork[0]!.baseline.solverPathWork = 1;
    expect(buildTransmissionIndexRows(changedWork).map((row) => row.track.id)).toEqual(
      rows.map((row) => row.track.id),
    );
  });

  test("derives switches from consecutive recorded actions", () => {
    const switches = Object.fromEntries(
      bundle.payload.tracks.map((track) => [
        track.id,
        countActionSwitches(track.adaptive.decisions),
      ]),
    );
    expect(switches).toEqual({
      overtake: 1,
      "wrong-turn": 11,
      switchboard: 27,
      "uncertain-unison": 0,
      escape: 5,
      stall: 16,
    });
    expect(
      bundle.payload.tracks.map((track) => countActionSwitches(track.baseline.decisions)),
    ).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("uses the public labels and paired work ceiling", () => {
    const row = buildTransmissionIndexRows(bundle.payload.tracks).find(
      (candidate) => candidate.track.id === "overtake",
    )!;
    expect(row.family).toBe("p-Laplace");
    expect(row.startKind).toBe("interface perturbed");
    expect(row.maxWork).toBe(row.track.baseline.solverPathWork);
    expect(familyLabel("new_family")).toBe("new family");
    expect(startKindLabel("custom_start")).toBe("custom start");
  });
});
