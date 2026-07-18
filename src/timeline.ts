import type {
  LaneId,
  RegretRadioDecisionV1,
  RegretRadioTrackV1,
  RegretRadioTraceV1,
  ScheduledEvent,
} from "./types";

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function trackDuration(track: RegretRadioTrackV1): number {
  const count = Math.max(track.adaptive.decisions.length, track.baseline.decisions.length);
  return clamp(10 + 0.3 * count, 12, 30);
}

export function sharedMaxWork(track: RegretRadioTrackV1): number {
  return Math.max(track.adaptive.solverPathWork, track.baseline.solverPathWork);
}

export function workFraction(track: RegretRadioTrackV1, work: number): number {
  return clamp(work / sharedMaxWork(track), 0, 1);
}

export function residualProgress(initialResidual: number, residual: number, target: number): number {
  const denominator = Math.log10(initialResidual) - Math.log10(target);
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return clamp(
    (Math.log10(initialResidual) - Math.log10(Math.max(residual, Number.MIN_VALUE))) / denominator,
    0,
    1,
  );
}

export function residualToMidi(initialResidual: number, residual: number, target: number): number {
  return 36 + Math.round(36 * residualProgress(initialResidual, residual, target));
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function noteDuration(
  track: RegretRadioTrackV1,
  decision: RegretRadioDecisionV1,
  speed: number,
): number {
  const seconds = (decision.segmentWork / sharedMaxWork(track)) * trackDuration(track) / speed;
  return clamp(seconds * 0.72, 0.08, 0.7);
}

function traceEvents(
  track: RegretRadioTrackV1,
  trace: RegretRadioTraceV1,
  lane: LaneId,
  speed: number,
): ScheduledEvent[] {
  const duration = trackDuration(track) / speed;
  const pan = lane === "adaptive" ? -0.28 : 0.28;
  const events: ScheduledEvent[] = [];
  let previousAction: RegretRadioDecisionV1["actionId"] | undefined;
  for (const decision of trace.decisions) {
    const time = workFraction(track, decision.cumulativeWork) * duration;
    if (previousAction && previousAction !== decision.actionId) {
      events.push({
        kind: "switch",
        lane,
        time: Math.max(0, time - 0.018 / speed),
        duration: 0.045 / speed,
        pan,
      });
    }
    events.push({
      kind: "note",
      lane,
      time,
      duration: noteDuration(track, decision, speed),
      pan,
      actionId: decision.actionId,
      frequency: midiToFrequency(
        residualToMidi(trace.initialResidual, decision.residual, track.stationarityTarget),
      ),
      entropy: lane === "adaptive" ? clamp(decision.entropy, 0, 1) : 0,
    });
    previousAction = decision.actionId;
  }
  const terminalTime = workFraction(track, trace.solverPathWork) * duration;
  events.push({
    kind: "terminal",
    lane,
    time: terminalTime,
    duration: trace.converged ? 0.9 : 0.55,
    pan,
    converged: trace.converged,
  });
  return events;
}

export function compileSchedule(
  track: RegretRadioTrackV1,
  speed = 1,
  muted: ReadonlySet<LaneId> = new Set(),
): ScheduledEvent[] {
  const events = [
    ...traceEvents(track, track.adaptive, "adaptive", speed),
    ...traceEvents(track, track.baseline, "baseline", speed),
  ];
  return events
    .filter((event) => !muted.has(event.lane))
    .sort((left, right) => left.time - right.time || left.lane.localeCompare(right.lane));
}

export function decisionAtFraction(
  track: RegretRadioTrackV1,
  trace: RegretRadioTraceV1,
  fraction: number,
): RegretRadioDecisionV1 | undefined {
  const work = fraction * sharedMaxWork(track);
  return [...trace.decisions].reverse().find((decision) => decision.cumulativeWork <= work);
}
