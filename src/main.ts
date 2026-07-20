import "@fontsource-variable/anybody";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

import rawBundle from "./data/bundle.json";
import { AudioEngine, renderTrackWav } from "./audio";
import { decisionAtFraction, residualProgress, sharedMaxWork, workFraction } from "./timeline";
import {
  buildTransmissionIndexRows,
  familyLabel,
  startKindLabel,
  type TransmissionIndexRow,
} from "./transmission-index";
import {
  ACTION_META,
  type LaneId,
  type RegretRadioBundleV1,
  type RegretRadioDecisionV1,
  type RegretRadioTrackV1,
} from "./types";
import { validateBundle } from "./validate";

type SelectedDecision = { lane: LaneId; decision: RegretRadioDecisionV1 };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app.");

app.innerHTML = `
  <div class="app-shell">
    <header class="masthead">
      <a class="brand" href="./" aria-label="Regret Radio home">
        <span class="brand-main">REGRET</span>
        <span class="brand-wave" aria-hidden="true"></span>
        <span class="brand-main">RADIO</span>
      </a>
      <div class="head-controls">
        <label class="select-label" for="track-select">Transmission</label>
        <select id="track-select" class="select"></select>
        <button id="explain-button" class="button button-quiet" type="button">How this sound works</button>
      </div>
    </header>

    <main>
      <details id="transmission-index" class="transmission-index" open>
        <summary>
          <span class="index-heading">Transmission index</span>
          <span id="transmission-index-count" class="index-count"></span>
        </summary>
        <div class="index-intro">
          <p>Curated evidence stories from accepted runs. This index shows loaded cases, not a representative sample or statistical population.</p>
          <p>Work means recorded solver-path work, not wall-clock time. Action switches count changes between consecutive recorded action IDs.</p>
        </div>
        <div class="transmission-index-scroll">
          <table class="transmission-table">
            <caption class="sr-only">Loaded curated evidence stories and their recorded evidence dimensions</caption>
            <thead>
              <tr>
                <th scope="col">Story</th>
                <th scope="col">Case</th>
                <th scope="col">Convergence</th>
                <th scope="col">Solver-path work</th>
                <th scope="col">Switches</th>
              </tr>
            </thead>
            <tbody id="transmission-index-body"></tbody>
          </table>
        </div>
      </details>

      <section id="player" class="hero" aria-labelledby="track-title">
        <div class="track-heading">
          <div>
            <p id="track-kicker" class="kicker"></p>
            <h1 id="track-title" tabindex="-1"></h1>
            <p id="track-story" class="story"></p>
          </div>
          <div id="case-stamp" class="case-stamp" aria-label="Scientific case identity"></div>
        </div>

        <div class="instrument" aria-label="Synchronized adaptive selector and closed-loop SBS score">
          <div class="lane-tools">
            <div class="lane-tool">
              <span class="lane-dot adaptive-dot"></span>
              <span>Adaptive selector</span>
              <button id="mute-adaptive" class="mini-button" type="button" aria-pressed="false">Mute</button>
              <button id="solo-adaptive" class="mini-button" type="button" aria-pressed="false">Solo</button>
            </div>
            <div class="lane-tool">
              <span class="lane-dot baseline-dot"></span>
              <span>Closed-loop SBS</span>
              <button id="mute-baseline" class="mini-button" type="button" aria-pressed="false">Mute</button>
              <button id="solo-baseline" class="mini-button" type="button" aria-pressed="false">Solo</button>
            </div>
          </div>
          <svg id="score" class="score" viewBox="0 0 1000 355" role="img" aria-labelledby="score-title score-desc">
            <title id="score-title">Solver decisions across shared solver work</title>
            <desc id="score-desc">Two aligned lanes compare adaptive selector decisions with a closed-loop single-best-solver baseline.</desc>
          </svg>
          <div class="work-scale" aria-hidden="true">
            <span>0</span>
            <span>solver-path work</span>
            <span id="max-work"></span>
          </div>

          <div class="field-scope">
            <div class="scope-head">
              <span>Field state at needle</span>
              <span id="position-readout">0% · work 0</span>
            </div>
            <svg id="field-view" viewBox="0 0 1000 126" role="img" aria-label="Discrete field states at the current solver-work position"></svg>
          </div>

          <div id="inspector" class="inspector" aria-live="polite"></div>
        </div>

        <div class="transport">
          <button id="play-button" class="button button-play" type="button">
            <span class="play-glyph" aria-hidden="true">▶</span>
            <span id="play-label">Listen</span>
          </button>
          <label class="scrubber-label" for="scrubber">
            <span class="sr-only">Playback position</span>
            <input id="scrubber" class="scrubber" type="range" min="0" max="1000" value="0">
          </label>
          <label class="speed-label" for="speed-select">
            <span>Speed</span>
            <select id="speed-select" class="select select-small">
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <button id="share-button" class="button" type="button">Share</button>
          <button id="wav-button" class="button" type="button">Export WAV</button>
        </div>
        <p id="status" class="status" role="status"></p>

        <div class="legend" aria-label="Solver action legend">
          ${Object.entries(ACTION_META)
            .map(
              ([id, meta]) => `
                <span class="legend-item" data-action="${id}">
                  <span class="legend-mark shape-${meta.shape}" style="--action-color:${meta.color}"></span>
                  <span>${meta.short}</span>
                </span>`,
            )
            .join("")}
        </div>

        <details class="lower-panel">
          <summary>Decision transcript</summary>
          <ol id="transcript" class="transcript"></ol>
        </details>
        <details class="lower-panel">
          <summary>Advanced import</summary>
          <div class="import-row">
            <label class="button file-button" for="bundle-file">Choose Regret Radio JSON</label>
            <input id="bundle-file" type="file" accept="application/json,.json">
            <span>Raw thesis CSV and JLD2 files are intentionally not accepted.</span>
          </div>
        </details>
      </section>
    </main>

    <footer class="footer">
      <p>Regret Radio is a metaphor. Evidence uses solver-path work, not wall-clock time.</p>
      <p id="provenance-short"></p>
    </footer>
  </div>

  <dialog id="explain-dialog" class="explain-dialog">
    <form method="dialog" class="dialog-head">
      <div>
        <p class="kicker">Signal map</p>
        <h2>How data becomes sound</h2>
      </div>
      <button class="button button-quiet" value="close">Close</button>
    </form>
    <div class="mapping-grid">
      <section>
        <span class="mapping-code">X / TIME</span>
        <h3>Solver-path work</h3>
        <p>Both lanes share one linear work ruler. A lane that finishes early becomes silent while the other keeps spending work.</p>
      </section>
      <section>
        <span class="mapping-code">Y / PITCH</span>
        <h3>Log residual progress</h3>
        <p>Higher notes mean closer to the stationarity target. Pitch spans three chromatic octaves using one shared formula.</p>
      </section>
      <section>
        <span class="mapping-code">VOICE</span>
        <h3>Solver action</h3>
        <p>GD is a round pulse, L-BFGS a pluck, NCG a paired reed, and Newton-CG a short FM bell.</p>
      </section>
      <section>
        <span class="mapping-code">TEXTURE</span>
        <h3>Selector entropy</h3>
        <p>Uncertain adaptive decisions add up to 18 cents of detune and faint deterministic noise. SBS stays clear.</p>
      </section>
      <section>
        <span class="mapping-code">PERCUSSION</span>
        <h3>Switches and outcomes</h3>
        <p>Action switches click. Convergence resolves as a fifth. Step guards and work budgets end with a damped low strike.</p>
      </section>
      <section>
        <span class="mapping-code">CAVEAT</span>
        <h3>Not literal regret</h3>
        <p>The public duel compares a one-switch-trained selector with closed-loop SBS. It does not claim a true sequence oracle.</p>
      </section>
    </div>
    <div class="provenance-block">
      <h3>Accepted evidence</h3>
      <dl>
        <div><dt>Study</dt><dd id="study-id"></dd></div>
        <div><dt>Benchmark digest</dt><dd id="benchmark-digest"></dd></div>
        <div><dt>Selector run</dt><dd id="selector-run"></dd></div>
        <div><dt>Work metric</dt><dd>solver_path</dd></div>
      </dl>
    </div>
  </dialog>
`;

function element<T extends HTMLElement | SVGElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}.`);
  return result as unknown as T;
}

const trackSelect = element<HTMLSelectElement>("track-select");
const transmissionIndexBody = element<HTMLTableSectionElement>("transmission-index-body");
const transmissionIndexCount = element<HTMLSpanElement>("transmission-index-count");
const player = element<HTMLElement>("player");
const title = element<HTMLHeadingElement>("track-title");
const kicker = element<HTMLParagraphElement>("track-kicker");
const story = element<HTMLParagraphElement>("track-story");
const caseStamp = element<HTMLDivElement>("case-stamp");
const score = element<SVGSVGElement>("score");
const fieldView = element<SVGSVGElement>("field-view");
const inspector = element<HTMLDivElement>("inspector");
const transcript = element<HTMLOListElement>("transcript");
const scrubber = element<HTMLInputElement>("scrubber");
const speedSelect = element<HTMLSelectElement>("speed-select");
const playButton = element<HTMLButtonElement>("play-button");
const playLabel = element<HTMLSpanElement>("play-label");
const explainButton = element<HTMLButtonElement>("explain-button");
const explainDialog = element<HTMLDialogElement>("explain-dialog");
const status = element<HTMLParagraphElement>("status");
const maxWorkLabel = element<HTMLSpanElement>("max-work");
const positionReadout = element<HTMLSpanElement>("position-readout");
const bundleFile = element<HTMLInputElement>("bundle-file");
const shareButton = element<HTMLButtonElement>("share-button");
const wavButton = element<HTMLButtonElement>("wav-button");

const engine = new AudioEngine();
const initialBundle = await validateBundle(rawBundle, { verifyDigest: true });
let tracks = [...initialBundle.payload.tracks];
const sourceByTrack = new Map(tracks.map((track) => [track.id, initialBundle.payload.source]));
const localTrackIds = new Set<string>();
let currentTrack = tracks[0]!;
let speed = 1;
let fraction = 0;
let selectedDecision: SelectedDecision | null = null;
let explicitMuted = new Set<LaneId>();
let solo: LaneId | null = null;
let animationFrame = 0;
let lastFieldKey = "";

function formatWork(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatResidual(value: number): string {
  return value >= 0.001 && value < 10_000 ? Number(value.toPrecision(4)).toString() : value.toExponential(2);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });
}

function effectiveMuted(): Set<LaneId> {
  if (solo) return new Set<LaneId>([solo === "adaptive" ? "baseline" : "adaptive"]);
  return new Set(explicitMuted);
}

function outcomeLabel(track: RegretRadioTrackV1): string {
  if (track.adaptive.converged && track.baseline.converged) {
    const ratio = track.baseline.solverPathWork / track.adaptive.solverPathWork;
    if (Math.abs(ratio - 1) < 1e-9) return "Both lanes used identical solver work.";
    return ratio > 1
      ? `SBS used ${ratio.toFixed(2)}× adaptive solver work.`
      : `Adaptive used ${(1 / ratio).toFixed(1)}× SBS solver work.`;
  }
  if (track.adaptive.converged) return "Adaptive converged; SBS did not converge within the accepted run.";
  if (track.baseline.converged) return "SBS converged; adaptive did not converge within the accepted run.";
  return "Neither lane converged within the accepted run.";
}

function shapeMarkup(
  decision: RegretRadioDecisionV1,
  lane: LaneId,
  x: number,
  y: number,
): string {
  const meta = ACTION_META[decision.actionId];
  const attributes = `
    class="decision-mark"
    data-lane="${lane}"
    data-index="${decision.index}"
    tabindex="0"
    role="button"
    aria-label="${escapeHtml(`${lane}, decision ${decision.index + 1}, ${meta.label}, work ${formatWork(decision.cumulativeWork)}, residual ${formatResidual(decision.residual)}`)}"
    fill="${meta.color}"
  `;
  if (meta.shape === "circle") return `<circle ${attributes} cx="${x}" cy="${y}" r="6.6"></circle>`;
  if (meta.shape === "square") return `<rect ${attributes} x="${x - 6}" y="${y - 6}" width="12" height="12" rx="1.8"></rect>`;
  if (meta.shape === "diamond") {
    return `<path ${attributes} d="M ${x} ${y - 8} L ${x + 8} ${y} L ${x} ${y + 8} L ${x - 8} ${y} Z"></path>`;
  }
  return `<path ${attributes} d="M ${x - 7} ${y} L ${x - 3.5} ${y - 6.2} L ${x + 3.5} ${y - 6.2} L ${x + 7} ${y} L ${x + 3.5} ${y + 6.2} L ${x - 3.5} ${y + 6.2} Z"></path>`;
}

function laneMarkup(track: RegretRadioTrackV1, lane: LaneId, laneY: number): string {
  const trace = track[lane];
  const x0 = 92;
  const width = 858;
  const holes = Array.from({ length: 37 }, (_, index) => {
    const x = x0 + (index / 36) * width;
    return `<circle class="tape-hole" cx="${x}" cy="${laneY + 51}" r="2.7"></circle>`;
  }).join("");
  const points = [
    `${x0},${laneY + 18}`,
    ...trace.decisions.map((decision) => {
      const x = x0 + workFraction(track, decision.cumulativeWork) * width;
      const progress = residualProgress(trace.initialResidual, decision.residual, track.stationarityTarget);
      return `${x},${laneY + 18 - progress * 34}`;
    }),
  ];
  const marks = trace.decisions
    .map((decision) => {
      const x = x0 + workFraction(track, decision.cumulativeWork) * width;
      const progress = residualProgress(trace.initialResidual, decision.residual, track.stationarityTarget);
      return shapeMarkup(decision, lane, x, laneY + 18 - progress * 34);
    })
    .join("");
  const terminalX = x0 + workFraction(track, trace.solverPathWork) * width;
  const terminal = trace.converged
    ? `<g class="terminal-mark terminal-success" transform="translate(${terminalX} ${laneY + 18})"><circle r="12"></circle><path d="m-5 0 3.4 3.6L6-5"></path></g>`
    : `<g class="terminal-mark terminal-stop" transform="translate(${terminalX} ${laneY + 18})"><circle r="12"></circle><path d="M-4-4 4 4M4-4-4 4"></path></g>`;
  return `
    <g class="lane lane-${lane}">
      <text class="lane-name" x="24" y="${laneY + 22}">${lane === "adaptive" ? "ADAPTIVE" : "SBS"}</text>
      <rect class="tape" x="${x0 - 12}" y="${laneY - 30}" width="${width + 24}" height="98" rx="6"></rect>
      ${holes}
      <polyline class="residual-thread residual-${lane}" points="${points.join(" ")}"></polyline>
      ${marks}
      ${terminal}
    </g>
  `;
}

function renderScore(): void {
  const needleX = 92 + fraction * 858;
  score.innerHTML = `
    <defs>
      <filter id="needle-glow" x="-80%" y="-20%" width="260%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="blur"></feGaussianBlur>
        <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
      </filter>
    </defs>
    <text class="axis-note" x="92" y="22">HIGH RESIDUAL</text>
    <text class="axis-note axis-note-right" x="950" y="22">STATIONARITY</text>
    ${laneMarkup(currentTrack, "adaptive", 92)}
    ${laneMarkup(currentTrack, "baseline", 234)}
    <g id="needle" class="needle" transform="translate(${needleX} 0)">
      <line x1="0" y1="34" x2="0" y2="330"></line>
      <path d="M-8 34H8L3 48H-3Z"></path>
    </g>
  `;
  score.querySelectorAll<SVGElement>(".decision-mark").forEach((mark) => {
    const lane = mark.dataset.lane as LaneId;
    const index = Number(mark.dataset.index);
    const decision = currentTrack[lane].decisions[index];
    if (!decision) return;
    const select = () => {
      selectedDecision = { lane, decision };
      renderInspector();
    };
    mark.addEventListener("pointerenter", select);
    mark.addEventListener("focus", select);
    mark.addEventListener("click", () => {
      pause();
      fraction = workFraction(currentTrack, decision.cumulativeWork);
      scrubber.value = String(Math.round(fraction * 1000));
      updatePosition();
      select();
    });
  });
}

function fieldPath(values: number[], x0 = 34, width = 932): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1e-9);
  return values
    .map((value, index) => {
      const x = x0 + (index / Math.max(1, values.length - 1)) * width;
      const y = 103 - ((value - low) / span) * 74;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderField(): void {
  const adaptive = decisionAtFraction(currentTrack, currentTrack.adaptive, fraction) ?? currentTrack.adaptive.decisions[0];
  const baseline = decisionAtFraction(currentTrack, currentTrack.baseline, fraction) ?? currentTrack.baseline.decisions[0];
  if (!adaptive || !baseline) return;
  const key = `${adaptive.index}:${baseline.index}`;
  if (key === lastFieldKey) return;
  lastFieldKey = key;
  fieldView.innerHTML = `
    <line class="scope-zero" x1="34" x2="966" y1="66" y2="66"></line>
    <path class="field-line field-adaptive" d="${fieldPath(adaptive.field)}"></path>
    <path class="field-line field-baseline" d="${fieldPath(baseline.field)}"></path>
    <text class="scope-label" x="36" y="18">adaptive · decision ${adaptive.index + 1}</text>
    <text class="scope-label scope-label-right" x="964" y="18">SBS · decision ${baseline.index + 1}</text>
  `;
}

function probabilityMarkup(decision: RegretRadioDecisionV1): string {
  return Object.entries(decision.probabilities)
    .sort((left, right) => right[1] - left[1])
    .map(([id, probability]) => {
      const action = ACTION_META[id as keyof typeof ACTION_META];
      const label = action?.short ?? id;
      const color = action?.color ?? "#17242d";
      return `
        <div class="probability-row">
          <span>${escapeHtml(label)}</span>
          <span class="probability-bar"><i style="width:${(probability * 100).toFixed(1)}%;--bar-color:${color}"></i></span>
          <span>${(probability * 100).toFixed(1)}%</span>
        </div>`;
    })
    .join("");
}

function renderInspector(): void {
  const chosen =
    selectedDecision ??
    (() => {
      const decision = decisionAtFraction(currentTrack, currentTrack.adaptive, fraction);
      return decision ? { lane: "adaptive" as const, decision } : null;
    })();
  if (!chosen) {
    inspector.innerHTML = `<p>Press Listen or focus a score mark to inspect one recorded decision.</p>`;
    return;
  }
  const meta = ACTION_META[chosen.decision.actionId];
  inspector.innerHTML = `
    <div class="inspector-main">
      <p class="inspector-label">${chosen.lane === "adaptive" ? "Adaptive selector" : "Closed-loop SBS"} · decision ${chosen.decision.index + 1}</p>
      <h2>${escapeHtml(meta.label)}</h2>
      <div class="decision-facts">
        <span><b>${formatWork(chosen.decision.cumulativeWork)}</b> solver work</span>
        <span><b>${formatResidual(chosen.decision.residual)}</b> residual</span>
        <span><b>${Number(chosen.decision.energy.toPrecision(4))}</b> energy</span>
        <span><b>${(chosen.decision.entropy * 100).toFixed(1)}%</b> entropy</span>
      </div>
      <p class="decision-status">${escapeHtml(chosen.decision.status)} · ${escapeHtml(chosen.decision.warmStartKind)}</p>
    </div>
    <div class="probabilities" aria-label="Action probabilities">
      ${probabilityMarkup(chosen.decision)}
    </div>
  `;
}

function renderTranscript(): void {
  const rows = (["adaptive", "baseline"] as const).flatMap((lane) =>
    currentTrack[lane].decisions.map((decision) => ({ lane, decision })),
  );
  rows.sort((left, right) => left.decision.cumulativeWork - right.decision.cumulativeWork);
  transcript.innerHTML = rows
    .map(
      ({ lane, decision }) => `
        <li>
          <span>${lane === "adaptive" ? "Adaptive" : "SBS"}</span>
          <span>${ACTION_META[decision.actionId].short}</span>
          <span>work ${formatWork(decision.cumulativeWork)}</span>
          <span>residual ${formatResidual(decision.residual)}</span>
        </li>`,
    )
    .join("");
}

function renderTrackOptions(): void {
  trackSelect.innerHTML = tracks
    .map(
      (track) =>
        `<option value="${escapeHtml(track.id)}">${localTrackIds.has(track.id) ? "Local · " : ""}${escapeHtml(track.title)}</option>`,
    )
    .join("");
  trackSelect.value = currentTrack.id;
}

function laneConvergenceMarkup(label: string, converged: boolean, terminalReason: string): string {
  const detail = converged ? "Converged" : `Did not converge · ${terminalReason.replaceAll("_", " ")}`;
  return `
    <span class="index-lane-status">
      <b>${label}</b>
      <span class="index-outcome" data-converged="${converged}">${escapeHtml(detail)}</span>
    </span>`;
}

function workLaneMarkup(
  label: string,
  className: string,
  work: number,
  maxWork: number,
): string {
  const share = Math.max(0, Math.min(100, (work / maxWork) * 100));
  return `
    <span class="index-work-lane">
      <b>${label}</b>
      <span class="index-work-value">${formatWork(work)}</span>
      <span class="index-work-rail" aria-hidden="true">
        <i class="${className}" style="--work-share:${share.toFixed(2)}%"></i>
      </span>
    </span>`;
}

function transmissionRowMarkup(row: TransmissionIndexRow): string {
  const { track } = row;
  const local = localTrackIds.has(track.id);
  const source = sourceByTrack.get(track.id) ?? initialBundle.payload.source;
  const current = track.id === currentTrack.id;
  return `
    <tr class="transmission-row${current ? " is-current" : ""}" data-track-id="${escapeHtml(track.id)}">
      <th scope="row">
        <button
          class="index-open"
          type="button"
          data-track-id="${escapeHtml(track.id)}"
          data-local="${local}"
          aria-current="${current ? "true" : "false"}"
          aria-label="${escapeHtml(`Open ${track.title} in player`)}"
        >
          <span>${escapeHtml(track.title)}</span>
          <small class="index-source">${local ? "Local import" : "Bundled"} · study ${escapeHtml(source.studyId.slice(0, 8))}…</small>
        </button>
      </th>
      <td>
        <span class="index-case">${escapeHtml(row.family)}</span>
        <small>${escapeHtml(row.startKind)}</small>
      </td>
      <td class="index-lane-pair">
        ${laneConvergenceMarkup("A", track.adaptive.converged, track.adaptive.terminalReason)}
        ${laneConvergenceMarkup("SBS", track.baseline.converged, track.baseline.terminalReason)}
      </td>
      <td class="index-work-pair">
        ${workLaneMarkup("A", "adaptive-work", track.adaptive.solverPathWork, row.maxWork)}
        ${workLaneMarkup("SBS", "baseline-work", track.baseline.solverPathWork, row.maxWork)}
      </td>
      <td class="index-switches">
        <span><b>A</b> ${row.adaptiveSwitches}</span>
        <span><b>SBS</b> ${row.baselineSwitches}</span>
      </td>
    </tr>`;
}

function renderTransmissionIndex(): void {
  transmissionIndexCount.textContent = `${tracks.length} ${tracks.length === 1 ? "story" : "stories"}`;
  transmissionIndexBody.innerHTML = buildTransmissionIndexRows(tracks)
    .map(transmissionRowMarkup)
    .join("");
  transmissionIndexBody.querySelectorAll<HTMLButtonElement>(".index-open").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = tracks.find((track) => track.id === button.dataset.trackId);
      if (selected) selectTrack(selected, true);
    });
  });
}

function renderMuteControls(): void {
  for (const lane of ["adaptive", "baseline"] as const) {
    const mute = element<HTMLButtonElement>(`mute-${lane}`);
    const soloButton = element<HTMLButtonElement>(`solo-${lane}`);
    mute.setAttribute("aria-pressed", String(explicitMuted.has(lane)));
    soloButton.setAttribute("aria-pressed", String(solo === lane));
  }
}

function renderTrack(): void {
  selectedDecision = null;
  lastFieldKey = "";
  title.textContent = currentTrack.title;
  kicker.textContent = `${familyLabel(currentTrack.family)} · ${startKindLabel(currentTrack.startKind)}`;
  story.textContent = outcomeLabel(currentTrack);
  caseStamp.innerHTML = `
    <span>instance ${escapeHtml(currentTrack.instanceId)}</span>
    <span>seed ${currentTrack.seed}</span>
    <span>fold ${currentTrack.fold}</span>
  `;
  maxWorkLabel.textContent = formatWork(sharedMaxWork(currentTrack));
  renderScore();
  renderField();
  renderInspector();
  renderTranscript();
  renderMuteControls();
  const source = sourceByTrack.get(currentTrack.id) ?? initialBundle.payload.source;
  element<HTMLElement>("provenance-short").textContent = `Study ${source.studyId.slice(0, 10)}… · ${source.trainingTarget.replaceAll("_", " ")}`;
  element<HTMLElement>("study-id").textContent = source.studyId;
  element<HTMLElement>("benchmark-digest").textContent = source.benchmarkEvidenceDigest;
  element<HTMLElement>("selector-run").textContent = source.selectorArtifactRunId;
  shareButton.disabled = localTrackIds.has(currentTrack.id);
  updatePosition();
}

function selectTrack(selected: RegretRadioTrackV1, fromIndex = false): void {
  pause();
  currentTrack = selected;
  fraction = 0;
  renderTrackOptions();
  renderTrack();
  renderTransmissionIndex();
  updateUrl();
  setStatus(fromIndex ? `Opened ${selected.title} in the synchronized player.` : "");
  if (fromIndex) {
    player.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    title.focus({ preventScroll: true });
  }
}

function updatePosition(): void {
  scrubber.value = String(Math.round(fraction * 1000));
  const needle = score.querySelector<SVGGElement>("#needle");
  needle?.setAttribute("transform", `translate(${92 + fraction * 858} 0)`);
  positionReadout.textContent = `${Math.round(fraction * 100)}% · work ${formatWork(fraction * sharedMaxWork(currentTrack))}`;
  score.querySelectorAll<SVGElement>(".decision-mark").forEach((mark) => {
    const lane = mark.dataset.lane as LaneId;
    const decision = currentTrack[lane].decisions[Number(mark.dataset.index)];
    mark.classList.toggle(
      "is-passed",
      Boolean(decision && workFraction(currentTrack, decision.cumulativeWork) <= fraction),
    );
  });
  renderField();
  if (!selectedDecision) renderInspector();
}

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle("status-error", error);
}

function updateUrl(includePosition = true): void {
  if (localTrackIds.has(currentTrack.id)) return;
  const url = new URL(location.href);
  url.searchParams.set("track", currentTrack.id);
  url.searchParams.set("speed", String(speed));
  if (includePosition) url.searchParams.set("at", fraction.toFixed(2));
  url.searchParams.set("explain", explainDialog.open ? "1" : "0");
  history.replaceState({}, "", url);
}

async function play(): Promise<void> {
  if (fraction >= 0.999) fraction = 0;
  await engine.play(currentTrack, speed, fraction, effectiveMuted());
  playLabel.textContent = "Pause";
  playButton.classList.add("is-playing");
  setStatus("Playing solver work as sound.");
  cancelAnimationFrame(animationFrame);
  const tick = () => {
    fraction = engine.position();
    updatePosition();
    if (fraction >= 0.999) {
      pause();
      fraction = 1;
      updatePosition();
      setStatus("Transmission complete.");
      updateUrl();
      return;
    }
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function pause(): void {
  if (engine.isPlaying()) fraction = engine.pause();
  cancelAnimationFrame(animationFrame);
  playLabel.textContent = fraction >= 0.999 ? "Replay" : "Listen";
  playButton.classList.remove("is-playing");
  updatePosition();
}

async function restartIfPlaying(): Promise<void> {
  if (!engine.isPlaying()) return;
  fraction = engine.pause();
  await play();
}

function loadUrlState(): void {
  const params = new URLSearchParams(location.search);
  const requested = tracks.find((track) => track.id === params.get("track"));
  if (requested) currentTrack = requested;
  const requestedSpeed = Number(params.get("speed"));
  if ([0.5, 1, 2].includes(requestedSpeed)) speed = requestedSpeed;
  speedSelect.value = String(speed);
  const requestedPosition = Number(params.get("at"));
  if (Number.isFinite(requestedPosition)) fraction = Math.min(1, Math.max(0, requestedPosition));
  if (params.get("explain") === "1") explainDialog.showModal();
}

playButton.addEventListener("click", async () => {
  if (engine.isPlaying()) {
    pause();
    updateUrl();
  } else {
    await play();
  }
});

scrubber.addEventListener("input", () => {
  const requestedFraction = Number(scrubber.value) / 1000;
  const wasPlaying = engine.isPlaying();
  pause();
  fraction = requestedFraction;
  selectedDecision = null;
  updatePosition();
  if (wasPlaying) void play();
});
scrubber.addEventListener("change", () => updateUrl());

speedSelect.addEventListener("change", async () => {
  const wasPlaying = engine.isPlaying();
  if (wasPlaying) fraction = engine.pause();
  speed = Number(speedSelect.value);
  if (wasPlaying) await play();
  updateUrl();
});

trackSelect.addEventListener("change", () => {
  const selected = tracks.find((track) => track.id === trackSelect.value);
  if (!selected) return;
  selectTrack(selected);
});

for (const lane of ["adaptive", "baseline"] as const) {
  element<HTMLButtonElement>(`mute-${lane}`).addEventListener("click", async () => {
    if (explicitMuted.has(lane)) explicitMuted.delete(lane);
    else explicitMuted.add(lane);
    solo = null;
    renderMuteControls();
    await restartIfPlaying();
  });
  element<HTMLButtonElement>(`solo-${lane}`).addEventListener("click", async () => {
    solo = solo === lane ? null : lane;
    renderMuteControls();
    await restartIfPlaying();
  });
}

explainButton.addEventListener("click", () => {
  explainDialog.showModal();
  updateUrl();
});
explainDialog.addEventListener("close", () => updateUrl());

shareButton.addEventListener("click", async () => {
  updateUrl();
  const canShare = typeof navigator.share === "function";
  const shareData = {
    title: `Regret Radio · ${currentTrack.title}`,
    text: currentTrack.story,
    url: location.href,
  };
  try {
    if (canShare) await navigator.share(shareData);
    else await navigator.clipboard.writeText(location.href);
    setStatus(canShare ? "Share sheet opened." : "Share link copied.");
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") setStatus("Could not share this link.", true);
  }
});

wavButton.addEventListener("click", async () => {
  wavButton.disabled = true;
  setStatus("Rendering deterministic WAV…");
  try {
    const blob = await renderTrackWav(currentTrack, speed, effectiveMuted());
    const source = sourceByTrack.get(currentTrack.id) ?? initialBundle.payload.source;
    const filename = `regret-radio-${currentTrack.id}-${source.studyId.slice(0, 8)}-${speed}x.wav`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus(`Exported ${filename}.`);
  } catch {
    setStatus("WAV rendering failed in this browser.", true);
  } finally {
    wavButton.disabled = false;
  }
});

bundleFile.addEventListener("change", async () => {
  const file = bundleFile.files?.[0];
  if (!file) return;
  try {
    const imported = await validateBundle(JSON.parse(await file.text()), {
      verifyDigest: true,
      sourceBytes: file.size,
    });
    const importedTracks = imported.payload.tracks.map((track, index) => ({
      ...track,
      id: `local-${Date.now()}-${index}-${track.id}`,
    }));
    for (const track of importedTracks) {
      localTrackIds.add(track.id);
      sourceByTrack.set(track.id, imported.payload.source);
    }
    tracks = [...tracks, ...importedTracks];
    currentTrack = importedTracks[0]!;
    fraction = 0;
    pause();
    renderTrackOptions();
    renderTrack();
    renderTransmissionIndex();
    setStatus(`Loaded ${importedTracks.length} local track${importedTracks.length === 1 ? "" : "s"}. Local evidence is not put in the URL.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not read this bundle.", true);
  } finally {
    bundleFile.value = "";
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && engine.isPlaying()) {
    pause();
    setStatus("Paused while this tab is hidden.");
  }
});

loadUrlState();
renderTrackOptions();
renderTransmissionIndex();
renderTrack();
