import { describe, expect, test } from "vitest";

import { encodeWav } from "../src/wav";

describe("WAV encoder", () => {
  test("writes stereo 48 kHz PCM with non-silent samples", async () => {
    const left = new Float32Array([0, 0.25, -0.5, 1]);
    const right = new Float32Array([0, -0.25, 0.5, -1]);
    const buffer = {
      numberOfChannels: 2,
      length: left.length,
      sampleRate: 48_000,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;
    const bytes = new Uint8Array(await encodeWav(buffer).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const text = (start: number, length: number) =>
      String.fromCharCode(...bytes.slice(start, start + length));

    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.byteLength).toBe(44 + left.length * 2 * 2);
    expect(view.getInt16(48, true)).not.toBe(0);
  });
});
