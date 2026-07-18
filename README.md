# Regret Radio

Regret Radio is a static scientific web toy: two accepted optimization traces
share one solver-work timeline, while a deterministic synthesizer turns each
recorded decision into sound. It compares a one-switch-trained adaptive selector
with closed-loop SBS. The radio metaphor is presentation, not a new metric.

## Run it

```sh
bun install
bun run dev
```

Nothing is fetched at runtime. `bun run build` produces a standalone `dist/`.

## Evidence

The six bundled stories were exported from accepted closed-loop study
`d8216a1028b7ba60bd8a6d3846ac6d74c146ffac18e7e6517da620e9f256a8d4`.
The fixture contains only the public Regret Radio JSON contract: no absolute
source paths and no thesis application code.

Regenerate or byte-verify the bundle:

```sh
bun run fixture:export
bun run fixture:verify
```

The exporter accepts `--study-dir`, `--selection`, and `--output`. Its isolated
Julia project uses only JLD2 and JSON3. Browser imports accept this exported JSON
format only, with digest, schema, numeric, monotonic-work, and size checks.

## Checks

```sh
bun run check
```

This runs TypeScript, unit tests, a production build, browser interaction tests,
and deterministic evidence verification.
