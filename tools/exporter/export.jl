using JLD2
using JSON3
using Logging
using SHA

const ROOT = normpath(joinpath(@__DIR__, "..", ".."))
const DEFAULT_STUDY = normpath(joinpath(
    ROOT,
    "..",
    "Thesis",
    "ezra-cerpac",
    "code",
    "out",
    "selector_target_study",
    "evidence",
    "closed_loop",
    "v1",
    "d8216a1028b7ba60bd8a6d3846ac6d74c146ffac18e7e6517da620e9f256a8d4",
))
const DEFAULT_SELECTION = joinpath(@__DIR__, "selection.json")
const DEFAULT_OUTPUT = joinpath(ROOT, "src", "data", "bundle.json")

plain(value::AbstractDict) = Dict(String(key) => plain(item) for (key, item) in pairs(value))
plain(value::AbstractVector) = [plain(item) for item in value]
plain(value) = value

function parse_args(args)
    options = Dict(
        "study" => DEFAULT_STUDY,
        "selection" => DEFAULT_SELECTION,
        "output" => DEFAULT_OUTPUT,
        "verify" => false,
    )
    index = 1
    while index <= length(args)
        arg = args[index]
        if arg == "--verify"
            options["verify"] = true
            index += 1
        elseif arg in ("--study-dir", "--selection", "--output")
            index == length(args) && error("$arg requires a value")
            options[replace(arg, "--study-dir" => "study", "--" => "")] = abspath(args[index + 1])
            index += 2
        else
            error("unknown argument $arg")
        end
    end
    return options
end

function canonical_json(value)
    if value isa AbstractFloat && isinteger(value)
        return string(BigInt(value))
    elseif value === nothing || value isa Bool || value isa AbstractString || value isa Number
        return String(JSON3.write(value))
    elseif value isa AbstractVector
        return "[" * join(canonical_json.(value), ",") * "]"
    elseif value isa AbstractDict
        entries = String[]
        for key in sort!(String.(collect(keys(value))))
            push!(entries, String(JSON3.write(key)) * ":" * canonical_json(value[key]))
        end
        return "{" * join(entries, ",") * "}"
    end
    error("cannot serialize $(typeof(value))")
end

function canonical_digest_json(value)
    if value isa Number && !(value isa Bool)
        isfinite(value) || error("canonical digest cannot contain non-finite numbers")
        bits = string(reinterpret(UInt64, Float64(value)); base = 16, pad = 16)
        return String(JSON3.write("#f64:" * bits))
    elseif value === nothing || value isa Bool || value isa AbstractString
        return String(JSON3.write(value))
    elseif value isa AbstractVector
        return "[" * join(canonical_digest_json.(value), ",") * "]"
    elseif value isa AbstractDict
        entries = String[]
        for key in sort!(String.(collect(keys(value))))
            push!(entries, String(JSON3.write(key)) * ":" * canonical_digest_json(value[key]))
        end
        return "{" * join(entries, ",") * "}"
    end
    error("cannot digest $(typeof(value))")
end

sha256_file(path) = bytes2hex(open(SHA.sha256, path))

function find_run(runs, instance_id, seed, fold, method_id)
    matches = [
        run for run in runs if
            String(run["instanceId"]) == instance_id &&
            run["seed"] == seed &&
            run["fold"] == fold &&
            String(run["methodId"]) == method_id
    ]
    length(matches) == 1 || error("expected one $method_id run for $instance_id/$seed/$fold, found $(length(matches))")
    return only(matches)
end

function find_detail(index, instance_id, method_id; seed = nothing, fold = nothing)
    matches = [
        entry for entry in index if
            String(entry["instanceId"]) == instance_id &&
            String(entry["methodId"]) == method_id &&
            entry["seed"] === seed &&
            entry["fold"] === fold
    ]
    length(matches) == 1 || error("expected one $method_id detail for $instance_id/$seed/$fold, found $(length(matches))")
    return only(matches)
end

function load_detail(study_dir, entry)
    relative = String(entry["path"])
    isabspath(relative) && error("detail path must be relative")
    ".." in splitpath(relative) && error("detail path escapes study")
    path = joinpath(study_dir, relative)
    isfile(path) || error("missing detail $relative")
    detail = with_logger(NullLogger()) do
        JLD2.load(path, "value")
    end
    return detail, path
end

function probability_map(value)
    value isa AbstractDict || error("probabilities must be a dictionary")
    return Dict(String(key) => Float64(item) for (key, item) in pairs(value))
end

function decision_json(decision, index)
    action = String(decision["action"])
    action in ("gd_wolfe", "lbfgs_bt", "ncg_fr_bt", "newton_cg_tr") ||
        error("unsupported action $action")
    residual = Float64(decision["residual"])
    isfinite(residual) && residual > 0 || error("decision residual must be positive and finite")
    field = Float64.(decision["u"])
    all(isfinite, field) || error("decision field contains non-finite values")
    return Dict{String, Any}(
        "index" => index - 1,
        "actionId" => action,
        "cumulativeWork" => Float64(decision["cumulativeWork"]),
        "segmentWork" => Float64(decision["segmentWork"]),
        "residual" => residual,
        "energy" => Float64(decision["energy"]),
        "entropy" => Float64(decision["entropy"]),
        "probabilities" => probability_map(decision["probabilities"]),
        "status" => String(decision["status"]),
        "warmStartKind" => String(decision["warmStartKind"]),
        "field" => field,
    )
end

function trace_json(detail, method_id, label)
    result = detail["result"]
    decisions = [decision_json(decision, index) for (index, decision) in enumerate(result["decisions"])]
    isempty(decisions) && error("$method_id trace has no decisions")
    work = Float64(result["solverPathWork"])
    previous = -Inf
    for decision in decisions
        current = Float64(decision["cumulativeWork"])
        current >= previous || error("$method_id work is not monotonic")
        previous = current
    end
    isapprox(previous, work; atol = max(1.0, work * 1e-9), rtol = 0.0) ||
        error("$method_id final decision work $previous does not match result $work")
    terminal_reason = String(get(result, "terminalReason", result["status"]))
    isempty(terminal_reason) && (terminal_reason = String(result["status"]))
    return Dict{String, Any}(
        "methodId" => method_id,
        "label" => label,
        "converged" => Bool(result["converged"]),
        "terminalReason" => terminal_reason,
        "solverPathWork" => work,
        "initialResidual" => Float64(result["initialResidual"]),
        "decisions" => decisions,
    )
end

function verify_expected(track, selection)
    expected = selection["expected"]
    for lane in ("adaptive", "baseline")
        trace = track[lane]
        wanted = expected[lane]
        trace["converged"] == wanted["converged"] || error("$(selection["id"]) $lane convergence changed")
        trace["terminalReason"] == wanted["terminalReason"] || error("$(selection["id"]) $lane terminal reason changed")
        trace["solverPathWork"] == wanted["solverPathWork"] || error("$(selection["id"]) $lane terminal work changed")
        length(trace["decisions"]) == wanted["decisionCount"] || error("$(selection["id"]) $lane decision count changed")
        switches = count(
            index -> trace["decisions"][index]["actionId"] != trace["decisions"][index - 1]["actionId"],
            2:length(trace["decisions"]),
        )
        switches == wanted["switchCount"] || error("$(selection["id"]) $lane switch count changed")
    end
end

function track_json(study_dir, detail_index, runs, selection)
    instance_id = String(selection["instanceId"])
    seed = Int(selection["seed"])
    fold = Int(selection["fold"])
    adaptive_run = find_run(runs, instance_id, seed, fold, "mlp")
    sbs_run = find_run(runs, instance_id, seed, fold, "closed_loop_sbs")
    sbs_action = String(sbs_run["baseAction"])
    adaptive_entry = find_detail(detail_index, instance_id, "mlp"; seed, fold)
    baseline_entry = find_detail(detail_index, instance_id, sbs_action)
    adaptive_detail, adaptive_path = load_detail(study_dir, adaptive_entry)
    baseline_detail, baseline_path = load_detail(study_dir, baseline_entry)
    adaptive_case = adaptive_detail["case"]
    baseline_case = baseline_detail["case"]
    adaptive_initial = Float64.(getproperty(adaptive_case, :initial_u))
    baseline_initial = Float64.(getproperty(baseline_case, :initial_u))
    adaptive_initial == baseline_initial || error("paired traces do not share the same initial state")
    String(getproperty(adaptive_case, :instance_id)) == instance_id || error("detail case identity mismatch")
    track = Dict{String, Any}(
        "id" => String(selection["id"]),
        "title" => String(selection["title"]),
        "story" => String(selection["story"]),
        "instanceId" => instance_id,
        "family" => String(adaptive_run["family"]),
        "startKind" => String(adaptive_run["startKind"]),
        "seed" => seed,
        "fold" => fold,
        "stationarityTarget" => Float64(getproperty(adaptive_case, :stationarity_target)),
        "adaptive" => trace_json(adaptive_detail, "mlp", "Adaptive selector"),
        "baseline" => trace_json(baseline_detail, "closed_loop_sbs", "Closed-loop SBS · Newton-CG TR"),
    )
    verify_expected(track, selection)
    return track, (adaptive_path, baseline_path)
end

function build_bundle(study_dir, selection_path)
    isdir(study_dir) || error("study directory does not exist: $study_dir")
    manifest_path = joinpath(study_dir, "manifest.json")
    runs_path = joinpath(study_dir, "runs.json")
    manifest = plain(JSON3.read(read(manifest_path, String)))
    runs = plain(JSON3.read(read(runs_path, String)))
    selection = plain(JSON3.read(read(selection_path, String)))
    manifest["status"] == "complete" || error("only complete evidence can be exported")
    study_id = String(manifest["studyId"])
    study_id == String(selection["studyId"]) || error("selection targets a different study")
    detail_index = manifest["detailIndex"]
    tracks = Dict{String, Any}[]
    source_paths = String[manifest_path, runs_path]
    for item in selection["tracks"]
        track, detail_paths = track_json(study_dir, detail_index, runs, item)
        push!(tracks, track)
        append!(source_paths, detail_paths)
    end
    scientific = manifest["scientificIdentity"]
    source = Dict{String, Any}(
        "studyId" => study_id,
        "manifestSha256" => sha256_file(manifest_path),
        "benchmarkEvidenceDigest" => String(scientific["benchmarkEvidence"]["contentDigest"]),
        "selectorArtifactRunId" => String(scientific["deployment"]["artifactRunId"]),
        "trainingTarget" => "one_switch_work",
        "workMetric" => "solver_path",
    )
    payload = Dict{String, Any}("source" => source, "tracks" => tracks)
    bundle = Dict{String, Any}(
        "kind" => "regret-radio-bundle",
        "schemaVersion" => 1,
        "contentSha256" => bytes2hex(SHA.sha256(canonical_digest_json(payload))),
        "payload" => payload,
    )
    unique_sources = unique(source_paths)
    input_digest = bytes2hex(SHA.sha256(join(sha256_file.(sort(unique_sources)))))
    return canonical_json(bundle) * "\n", unique_sources, input_digest
end

function main(args)
    options = parse_args(args)
    text, sources, input_digest = build_bundle(options["study"], options["selection"])
    output = options["output"]
    if options["verify"]
        isfile(output) || error("fixture does not exist: $output")
        existing = read(output, String)
        existing == text || error("fixture differs from deterministic exporter output")
        println("Verified $(length(sources)) source files ($(input_digest[1:12])…) and deterministic fixture $(basename(output)).")
        return
    end
    mkpath(dirname(output))
    write(output, text)
    println("Exported $(length(sources)) source files ($(input_digest[1:12])…) into $(basename(output)).")
end

main(ARGS)
