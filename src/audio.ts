import { compileSchedule, clamp, trackDuration } from "./timeline";
import type { ActionId, LaneId, RegretRadioTrackV1, ScheduledEvent } from "./types";
import { encodeWav } from "./wav";

type SchedulableContext = AudioContext | OfflineAudioContext;

function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

function envelope(gain: AudioParam, time: number, duration: number, peak: number): void {
  const attack = Math.min(0.018, duration * 0.2);
  gain.setValueAtTime(0.0001, time);
  gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  gain.exponentialRampToValueAtTime(0.0001, time + duration);
}

function connectLane(
  context: SchedulableContext,
  destination: AudioNode,
  pan: number,
): StereoPannerNode {
  const panner = context.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(destination);
  return panner;
}

function scheduleNoise(
  context: SchedulableContext,
  destination: AudioNode,
  time: number,
  duration: number,
  gainAmount: number,
  seed: number,
  active: Set<AudioScheduledSourceNode>,
): void {
  const frames = Math.max(2, Math.ceil(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const values = buffer.getChannelData(0);
  const random = seededRandom(seed);
  for (let index = 0; index < values.length; index += 1) values[index] = random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1850;
  filter.Q.value = 1.2;
  envelope(gain.gain, time, duration, Math.max(0.0002, gainAmount));
  source.connect(filter).connect(gain).connect(destination);
  source.start(time);
  source.stop(time + duration + 0.01);
  active.add(source);
}

function scheduleOscillator(
  context: SchedulableContext,
  destination: AudioNode,
  options: {
    time: number;
    duration: number;
    frequency: number;
    type: OscillatorType;
    gain: number;
    detune?: number;
    filterFrequency?: number;
  },
  active: Set<AudioScheduledSourceNode>,
): OscillatorNode {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = options.type;
  oscillator.frequency.value = options.frequency;
  oscillator.detune.value = options.detune ?? 0;
  envelope(gain.gain, options.time, options.duration, options.gain);
  if (options.filterFrequency) {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(options.filterFrequency, options.time);
    filter.frequency.exponentialRampToValueAtTime(480, options.time + options.duration);
    oscillator.connect(filter).connect(gain).connect(destination);
  } else {
    oscillator.connect(gain).connect(destination);
  }
  oscillator.start(options.time);
  oscillator.stop(options.time + options.duration + 0.02);
  active.add(oscillator);
  return oscillator;
}

function scheduleActionVoice(
  context: SchedulableContext,
  destination: AudioNode,
  event: ScheduledEvent,
  seed: number,
  active: Set<AudioScheduledSourceNode>,
): void {
  const frequency = event.frequency ?? 220;
  const action = event.actionId as ActionId;
  const entropy = event.entropy ?? 0;
  const detune = entropy * 18;
  if (action === "gd_wolfe") {
    scheduleOscillator(
      context,
      destination,
      { time: event.time, duration: event.duration, frequency, type: "sine", gain: 0.24 },
      active,
    );
  } else if (action === "lbfgs_bt") {
    scheduleOscillator(
      context,
      destination,
      {
        time: event.time,
        duration: event.duration,
        frequency,
        type: "triangle",
        gain: 0.19,
        filterFrequency: 2200,
      },
      active,
    );
  } else if (action === "ncg_fr_bt") {
    scheduleOscillator(
      context,
      destination,
      { time: event.time, duration: event.duration, frequency, type: "triangle", gain: 0.12, detune: -5 - detune },
      active,
    );
    scheduleOscillator(
      context,
      destination,
      { time: event.time, duration: event.duration, frequency, type: "triangle", gain: 0.12, detune: 5 + detune },
      active,
    );
  } else {
    const carrier = scheduleOscillator(
      context,
      destination,
      { time: event.time, duration: event.duration, frequency, type: "sine", gain: 0.18 },
      active,
    );
    const modulator = context.createOscillator();
    const modulation = context.createGain();
    modulator.frequency.value = frequency * 2.5;
    modulation.gain.setValueAtTime(frequency * 0.7, event.time);
    modulation.gain.exponentialRampToValueAtTime(0.01, event.time + event.duration);
    modulator.connect(modulation).connect(carrier.frequency);
    modulator.start(event.time);
    modulator.stop(event.time + event.duration + 0.02);
    active.add(modulator);
  }
  if (entropy > 0.01) {
    scheduleNoise(
      context,
      destination,
      event.time,
      Math.min(0.12, event.duration),
      0.018 * entropy,
      seed,
      active,
    );
  }
}

function scheduleTerminal(
  context: SchedulableContext,
  destination: AudioNode,
  event: ScheduledEvent,
  active: Set<AudioScheduledSourceNode>,
): void {
  if (event.converged) {
    for (const frequency of [261.63, 392]) {
      scheduleOscillator(
        context,
        destination,
        { time: event.time, duration: event.duration, frequency, type: "sine", gain: 0.15 },
        active,
      );
    }
  } else {
    scheduleOscillator(
      context,
      destination,
      { time: event.time, duration: event.duration, frequency: 73.42, type: "triangle", gain: 0.2, filterFrequency: 420 },
      active,
    );
  }
}

function scheduleEvents(
  context: SchedulableContext,
  destination: AudioNode,
  events: ScheduledEvent[],
  options: { startAt: number; offset: number; trackId: string },
): Set<AudioScheduledSourceNode> {
  const active = new Set<AudioScheduledSourceNode>();
  events.forEach((event, index) => {
    if (event.time + event.duration < options.offset) return;
    const shifted = { ...event, time: options.startAt + Math.max(0, event.time - options.offset) };
    const panner = connectLane(context, destination, shifted.pan);
    if (shifted.kind === "note") {
      scheduleActionVoice(
        context,
        panner,
        shifted,
        seedFromString(`${options.trackId}:${event.lane}:${index}`),
        active,
      );
    } else if (shifted.kind === "switch") {
      scheduleNoise(
        context,
        panner,
        shifted.time,
        shifted.duration,
        0.08,
        seedFromString(`${options.trackId}:switch:${index}`),
        active,
      );
    } else {
      scheduleTerminal(context, panner, shifted, active);
    }
  });
  return active;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private active = new Set<AudioScheduledSourceNode>();
  private timelineZero = 0;
  private duration = 0;
  private playing = false;

  async play(
    track: RegretRadioTrackV1,
    speed: number,
    fraction: number,
    muted: ReadonlySet<LaneId>,
  ): Promise<void> {
    this.stopSources();
    this.context ??= new AudioContext({ sampleRate: 48_000 });
    await this.context.resume();
    const events = compileSchedule(track, speed, muted);
    this.duration = trackDuration(track) / speed;
    const offset = clamp(fraction, 0, 1) * this.duration;
    const startAt = this.context.currentTime + 0.04;
    const master = this.context.createGain();
    master.gain.value = 0.72;
    master.connect(this.context.destination);
    this.active = scheduleEvents(this.context, master, events, {
      startAt,
      offset,
      trackId: track.id,
    });
    this.timelineZero = startAt - offset;
    this.playing = true;
  }

  pause(): number {
    const fraction = this.position();
    this.stopSources();
    this.playing = false;
    return fraction;
  }

  position(): number {
    if (!this.context || !this.playing || this.duration <= 0) return 0;
    return clamp((this.context.currentTime - this.timelineZero) / this.duration, 0, 1);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private stopSources(): void {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        // Source already stopped.
      }
    }
    this.active.clear();
  }
}

export async function renderTrackWav(
  track: RegretRadioTrackV1,
  speed: number,
  muted: ReadonlySet<LaneId> = new Set(),
): Promise<Blob> {
  const duration = trackDuration(track) / speed + 1.1;
  const sampleRate = 48_000;
  const context = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const master = context.createGain();
  master.gain.value = 0.72;
  master.connect(context.destination);
  scheduleEvents(context, master, compileSchedule(track, speed, muted), {
    startAt: 0.03,
    offset: 0,
    trackId: track.id,
  });
  return encodeWav(await context.startRendering());
}

