import { stableStringify, sha256Hex } from "./canonical";
import { ACTION_IDS, type RegretRadioBundleV1, type RegretRadioDecisionV1 } from "./types";

export const MAX_BUNDLE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FIELD_VALUES = 4_096;
const MAX_TRACKS = 50;
const MAX_DECISIONS = 5_000;

function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "expected a non-empty string");
  return value;
}

function number(value: unknown, path: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  if (positive && value <= 0) fail(path, "expected a positive number");
  return value;
}

function integer(value: unknown, path: string): number {
  const result = number(value, path);
  if (!Number.isInteger(result)) fail(path, "expected an integer");
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function validateDecision(value: unknown, path: string): RegretRadioDecisionV1 {
  const item = record(value, path);
  const actionId = string(item.actionId, `${path}.actionId`);
  if (!(ACTION_IDS as readonly string[]).includes(actionId)) fail(`${path}.actionId`, `unsupported action ${actionId}`);
  const probabilities = record(item.probabilities, `${path}.probabilities`);
  const validatedProbabilities: Record<string, number> = {};
  for (const [key, raw] of Object.entries(probabilities)) {
    const probability = number(raw, `${path}.probabilities.${key}`);
    if (probability < 0 || probability > 1) fail(`${path}.probabilities.${key}`, "expected a value from 0 to 1");
    validatedProbabilities[key] = probability;
  }
  if (!Array.isArray(item.field) || item.field.length < 2) fail(`${path}.field`, "expected at least two values");
  if (item.field.length > MAX_FIELD_VALUES) {
    fail(`${path}.field`, `maximum is ${MAX_FIELD_VALUES.toLocaleString("en-US")} values`);
  }
  const field = item.field.map((entry, index) => number(entry, `${path}.field[${index}]`));
  return {
    index: integer(item.index, `${path}.index`),
    actionId: actionId as RegretRadioDecisionV1["actionId"],
    cumulativeWork: number(item.cumulativeWork, `${path}.cumulativeWork`),
    segmentWork: number(item.segmentWork, `${path}.segmentWork`),
    residual: number(item.residual, `${path}.residual`, true),
    energy: number(item.energy, `${path}.energy`),
    entropy: number(item.entropy, `${path}.entropy`),
    probabilities: validatedProbabilities,
    status: string(item.status, `${path}.status`),
    warmStartKind: string(item.warmStartKind, `${path}.warmStartKind`),
    field,
  };
}

function validateTrace(value: unknown, path: string, expectedMethod: "mlp" | "closed_loop_sbs") {
  const item = record(value, path);
  if (item.methodId !== expectedMethod) fail(`${path}.methodId`, `expected ${expectedMethod}`);
  if (!Array.isArray(item.decisions) || item.decisions.length === 0) fail(`${path}.decisions`, "expected at least one decision");
  const decisions = item.decisions.map((decision, index) => validateDecision(decision, `${path}.decisions[${index}]`));
  let previousWork = -Infinity;
  decisions.forEach((decision, index) => {
    if (decision.index !== index) fail(`${path}.decisions[${index}].index`, `expected ${index}`);
    if (decision.cumulativeWork < previousWork) fail(`${path}.decisions[${index}].cumulativeWork`, "must be nondecreasing");
    previousWork = decision.cumulativeWork;
  });
  const solverPathWork = number(item.solverPathWork, `${path}.solverPathWork`, true);
  if (Math.abs(decisions.at(-1)!.cumulativeWork - solverPathWork) > Math.max(1, solverPathWork * 1e-9)) {
    fail(`${path}.solverPathWork`, "must match final cumulative work");
  }
  return {
    methodId: expectedMethod,
    label: string(item.label, `${path}.label`),
    converged: boolean(item.converged, `${path}.converged`),
    terminalReason: string(item.terminalReason, `${path}.terminalReason`),
    solverPathWork,
    initialResidual: number(item.initialResidual, `${path}.initialResidual`, true),
    decisions,
  };
}

export async function validateBundle(
  raw: unknown,
  options: { verifyDigest?: boolean; sourceBytes?: number } = {},
): Promise<RegretRadioBundleV1> {
  if ((options.sourceBytes ?? 0) > MAX_BUNDLE_FILE_BYTES) fail("file", "maximum size is 10MB");
  const root = record(raw, "bundle");
  if (root.kind !== "regret-radio-bundle") fail("bundle.kind", "expected regret-radio-bundle");
  if (root.schemaVersion !== 1) fail("bundle.schemaVersion", "only schema version 1 is supported");
  const payload = record(root.payload, "bundle.payload");
  const source = record(payload.source, "bundle.payload.source");
  if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) fail("bundle.payload.tracks", "expected at least one track");
  if (payload.tracks.length > MAX_TRACKS) fail("bundle.payload.tracks", "maximum is 50 tracks");
  let decisionCount = 0;
  const tracks = payload.tracks.map((rawTrack, trackIndex) => {
    const path = `bundle.payload.tracks[${trackIndex}]`;
    const track = record(rawTrack, path);
    const adaptive = validateTrace(track.adaptive, `${path}.adaptive`, "mlp");
    const baseline = validateTrace(track.baseline, `${path}.baseline`, "closed_loop_sbs");
    decisionCount += adaptive.decisions.length + baseline.decisions.length;
    return {
      id: string(track.id, `${path}.id`),
      title: string(track.title, `${path}.title`),
      story: string(track.story, `${path}.story`),
      instanceId: string(track.instanceId, `${path}.instanceId`),
      family: string(track.family, `${path}.family`),
      startKind: string(track.startKind, `${path}.startKind`),
      seed: integer(track.seed, `${path}.seed`),
      fold: integer(track.fold, `${path}.fold`),
      stationarityTarget: number(track.stationarityTarget, `${path}.stationarityTarget`, true),
      adaptive,
      baseline,
    };
  });
  if (decisionCount > MAX_DECISIONS) fail("bundle.payload.tracks", "maximum is 5,000 total decisions");
  const result: RegretRadioBundleV1 = {
    kind: "regret-radio-bundle",
    schemaVersion: 1,
    contentSha256: string(root.contentSha256, "bundle.contentSha256"),
    payload: {
      source: {
        studyId: string(source.studyId, "bundle.payload.source.studyId"),
        manifestSha256: string(source.manifestSha256, "bundle.payload.source.manifestSha256"),
        benchmarkEvidenceDigest: string(
          source.benchmarkEvidenceDigest,
          "bundle.payload.source.benchmarkEvidenceDigest",
        ),
        selectorArtifactRunId: string(source.selectorArtifactRunId, "bundle.payload.source.selectorArtifactRunId"),
        trainingTarget:
          source.trainingTarget === "one_switch_work"
            ? "one_switch_work"
            : fail("bundle.payload.source.trainingTarget", "expected one_switch_work"),
        workMetric:
          source.workMetric === "solver_path"
            ? "solver_path"
            : fail("bundle.payload.source.workMetric", "expected solver_path"),
      },
      tracks,
    },
  };
  if (options.verifyDigest !== false) {
    const digest = await sha256Hex(stableStringify(result.payload));
    if (digest !== result.contentSha256) fail("bundle.contentSha256", "digest does not match payload");
  }
  return result;
}
