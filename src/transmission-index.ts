import type { RegretRadioDecisionV1, RegretRadioTrackV1 } from "./types";

const FAMILY_LABELS: Record<string, string> = {
  allen_cahn: "Allen–Cahn",
  p_laplace: "p-Laplace",
  min_surface: "minimal surface",
  semilinear: "semilinear",
};

export interface TransmissionIndexRow {
  track: RegretRadioTrackV1;
  family: string;
  startKind: string;
  adaptiveSwitches: number;
  baselineSwitches: number;
  maxWork: number;
  loadOrder: number;
}

export function familyLabel(value: string): string {
  return FAMILY_LABELS[value] ?? value.replaceAll("_", " ");
}

export function startKindLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function countActionSwitches(
  decisions: readonly Pick<RegretRadioDecisionV1, "actionId">[],
): number {
  let switches = 0;
  for (let index = 1; index < decisions.length; index += 1) {
    if (decisions[index]!.actionId !== decisions[index - 1]!.actionId) switches += 1;
  }
  return switches;
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase("en-US");
  const normalizedRight = right.toLocaleLowerCase("en-US");
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

export function buildTransmissionIndexRows(
  tracks: readonly RegretRadioTrackV1[],
): TransmissionIndexRow[] {
  return tracks
    .map((track, loadOrder) => ({
      track,
      family: familyLabel(track.family),
      startKind: startKindLabel(track.startKind),
      adaptiveSwitches: countActionSwitches(track.adaptive.decisions),
      baselineSwitches: countActionSwitches(track.baseline.decisions),
      maxWork: Math.max(track.adaptive.solverPathWork, track.baseline.solverPathWork),
      loadOrder,
    }))
    .sort(
      (left, right) =>
        compareText(left.family, right.family) ||
        compareText(left.startKind, right.startKind) ||
        compareText(left.track.title, right.track.title) ||
        left.loadOrder - right.loadOrder,
    );
}
