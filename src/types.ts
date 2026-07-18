export const ACTION_IDS = ["gd_wolfe", "lbfgs_bt", "ncg_fr_bt", "newton_cg_tr"] as const;
export type ActionId = (typeof ACTION_IDS)[number];
export type LaneId = "adaptive" | "baseline";

export interface RegretRadioBundleV1 {
  kind: "regret-radio-bundle";
  schemaVersion: 1;
  contentSha256: string;
  payload: {
    source: {
      studyId: string;
      manifestSha256: string;
      benchmarkEvidenceDigest: string;
      selectorArtifactRunId: string;
      trainingTarget: "one_switch_work";
      workMetric: "solver_path";
    };
    tracks: RegretRadioTrackV1[];
  };
}

export interface RegretRadioTrackV1 {
  id: string;
  title: string;
  story: string;
  instanceId: string;
  family: string;
  startKind: string;
  seed: number;
  fold: number;
  stationarityTarget: number;
  adaptive: RegretRadioTraceV1;
  baseline: RegretRadioTraceV1;
}

export interface RegretRadioTraceV1 {
  methodId: "mlp" | "closed_loop_sbs";
  label: string;
  converged: boolean;
  terminalReason: string;
  solverPathWork: number;
  initialResidual: number;
  decisions: RegretRadioDecisionV1[];
}

export interface RegretRadioDecisionV1 {
  index: number;
  actionId: ActionId;
  cumulativeWork: number;
  segmentWork: number;
  residual: number;
  energy: number;
  entropy: number;
  probabilities: Record<string, number>;
  status: string;
  warmStartKind: string;
  field: number[];
}

export interface ScheduledEvent {
  kind: "note" | "switch" | "terminal";
  lane: LaneId;
  time: number;
  duration: number;
  pan: number;
  actionId?: ActionId;
  frequency?: number;
  entropy?: number;
  converged?: boolean;
}

export const ACTION_META: Record<
  ActionId,
  { label: string; short: string; color: string; shape: "circle" | "diamond" | "square" | "hex" }
> = {
  gd_wolfe: {
    label: "Gradient descent · Wolfe",
    short: "GD",
    color: "#2f6b8a",
    shape: "circle",
  },
  lbfgs_bt: {
    label: "L-BFGS · backtracking",
    short: "L-BFGS",
    color: "#c7862d",
    shape: "diamond",
  },
  ncg_fr_bt: {
    label: "NCG Fletcher–Reeves · backtracking",
    short: "NCG",
    color: "#6d5ca7",
    shape: "square",
  },
  newton_cg_tr: {
    label: "Newton-CG · trust region",
    short: "Newton",
    color: "#c44f48",
    shape: "hex",
  },
};

