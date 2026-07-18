import { describe, expect, test } from "vitest";

import rawBundle from "../src/data/bundle.json";
import { sha256Hex, stableStringify } from "../src/canonical";
import type { RegretRadioBundleV1 } from "../src/types";
import { validateBundle } from "../src/validate";

function cloneBundle(): RegretRadioBundleV1 {
  return structuredClone(rawBundle) as RegretRadioBundleV1;
}

async function reseal(bundle: RegretRadioBundleV1): Promise<RegretRadioBundleV1> {
  bundle.contentSha256 = await sha256Hex(stableStringify(bundle.payload));
  return bundle;
}

describe("public bundle validation", () => {
  test("accepts the generated evidence bundle", async () => {
    const bundle = await validateBundle(rawBundle);
    expect(bundle.payload.tracks.map((track) => track.id)).toEqual([
      "overtake",
      "wrong-turn",
      "switchboard",
      "uncertain-unison",
      "escape",
      "stall",
    ]);
  });

  test("rejects a digest mismatch", async () => {
    const bundle = cloneBundle();
    bundle.payload.tracks[0]!.title = "Tampered";
    await expect(validateBundle(bundle)).rejects.toThrow(
      "bundle.contentSha256: digest does not match payload",
    );
  });

  test("rejects malformed probabilities with an exact field", async () => {
    const bundle = cloneBundle();
    bundle.payload.tracks[0]!.adaptive.decisions[0]!.probabilities.gd_wolfe = 1.2;
    await expect(validateBundle(await reseal(bundle))).rejects.toThrow(
      "bundle.payload.tracks[0].adaptive.decisions[0].probabilities.gd_wolfe",
    );
  });

  test("rejects invalid residuals and nonmonotonic work", async () => {
    const invalidResidual = cloneBundle();
    invalidResidual.payload.tracks[0]!.adaptive.decisions[0]!.residual = 0;
    await expect(validateBundle(await reseal(invalidResidual))).rejects.toThrow(
      "bundle.payload.tracks[0].adaptive.decisions[0].residual",
    );

    const invalidWork = cloneBundle();
    invalidWork.payload.tracks[0]!.adaptive.decisions[1]!.cumulativeWork = -1;
    await expect(validateBundle(await reseal(invalidWork))).rejects.toThrow(
      "bundle.payload.tracks[0].adaptive.decisions[1].cumulativeWork",
    );
  });

  test("rejects unsupported schemas and oversized files", async () => {
    const schema = cloneBundle() as unknown as { schemaVersion: number };
    schema.schemaVersion = 2;
    await expect(validateBundle(schema)).rejects.toThrow(
      "bundle.schemaVersion: only schema version 1 is supported",
    );
    await expect(
      validateBundle(rawBundle, { sourceBytes: 10 * 1024 * 1024 + 1 }),
    ).rejects.toThrow("file: maximum size is 10MB");
  });
});
