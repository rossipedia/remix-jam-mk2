import { createEventType } from "@remix-run/events";

let [kick, createKick] = createEventType("drum:kick");
let [snare, createSnare] = createEventType("drum:snare");
let [hat, createHat] = createEventType("drum:hat");
let [play, createPlay] = createEventType("drum:play");
let [stop, createStop] = createEventType("drum:stop");
let [tempoChange, createTempoChange] =
  createEventType<number>("drum:tempo-change");
let [change, createChange] = createEventType("drum:change");

export type Instrument = "kicks" | "hihat" | "snare";

/**
 * 0 - off
 * 1 - normal
 * 2 - accent
 */
export type NoteState = 0|1|2;
export type ActiveNoteState = 1|2;

export class Drummer extends EventTarget {
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Uint8Array<ArrayBuffer> | null = null;

  private _isPlaying = false;
  private tempoBpm = 90;
  private current16th = 0;
  private nextNoteTime = 0;
  private intervalId: number | null = null;
  private patterns: Record<Instrument, NoteState[]>;

  // Tempo settings
  private readonly minBpm = 30;
  private readonly maxBpm = 300;

  // Scheduler settings
  private readonly lookaheadMs = 25; // how frequently to check (ms)
  private readonly scheduleAheadS = 0.1; // how far ahead to schedule (s)

  // Event binders
  static kick = kick;
  static snare = snare;
  static hat = hat;
  static play = play;
  static stop = stop;
  static tempoChange = tempoChange;
  static change = change;

  constructor(
    tempoBpm: number = 90,
    patterns: Record<Instrument, NoteState[]> = {
      hihat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      kicks: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    },
  ) {
    super();
    this.tempoBpm = Math.max(
      this.minBpm,
      Math.min(this.maxBpm, Math.floor(tempoBpm)),
    );
    this.patterns = patterns;
  }

  get isPlaying() {
    return this._isPlaying;
  }

  get bpm() {
    return this.tempoBpm;
  }

  async toggle() {
    if (this.isPlaying) {
      await this.stop();
    } else {
      await this.play();
    }
  }

  setTempo(bpm: number) {
    this.tempoBpm = Math.max(
      this.minBpm,
      Math.min(this.maxBpm, Math.floor(bpm || this.tempoBpm)),
    );
    this.dispatchEvent(createTempoChange({ detail: this.tempoBpm }));
    this.dispatchEvent(createChange());
  }

  async play(bpm?: number) {
    this.ensureContext();
    if (!this.audioCtx) return;
    if (bpm) {
      this.setTempo(bpm);
    }
    await this.audioCtx.resume();
    if (this._isPlaying) return;
    this._isPlaying = true;
    this.nextNoteTime = this.audioCtx.currentTime;
    // don't reset current16th so setTempo can adjust mid-groove if restarted
    if (this.intervalId != null) window.clearInterval(this.intervalId);
    this.intervalId = window.setInterval(this.scheduler, this.lookaheadMs);
    this.dispatchEvent(createPlay());
    this.dispatchEvent(createChange());
  }

  async stop() {
    if (!this.audioCtx) return;
    if (this.intervalId != null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._isPlaying = false;
    this.current16th = 0;
    this.nextNoteTime = this.audioCtx.currentTime;
    this.dispatchEvent(createStop());
    this.dispatchEvent(createChange());
  }

  private ensureContext() {
    if (!this.audioCtx) {
      const Ctx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = this.audioCtx ?? new Ctx();
      this.audioCtx = ctx;
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0.8;
      this.masterGain.connect(ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(ctx);

      this.createAnalyser();
    }
  }

  private createAnalyser() {
    this.ensureContext();
    if (!this.audioCtx) return;

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    this.analyser.fftSize = 256;
    this.analyserBuffer = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.smoothingTimeConstant = 0.8;

    this.masterGain?.connect(this.analyser);
  }

  analyze() {
    if (!this.analyser || !this.analyserBuffer) return;
    this.analyser.getByteFrequencyData(this.analyserBuffer);
    return this.analyserBuffer;
  }

  private secondsPer16th(): number {
    return 60 / Math.max(1, this.tempoBpm) / 4;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate; // 1 second
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private playKick(time: number, note:ActiveNoteState) {
    if (!this.audioCtx || !this.masterGain) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.1);
    gain.gain.setValueAtTime(note == 2 ? 1 : 0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc.connect(gain).connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.2);
    this.dispatchEvent(createKick());
    this.dispatchEvent(createChange());
  }

  private playSnare(time: number, note:ActiveNoteState) {
    if (!this.audioCtx || !this.masterGain || !this.noiseBuffer) return;

    const gainMult = note == 2 ? 1 : 0.5;

    // Noise component
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const band = this.audioCtx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    const noiseGain = this.audioCtx.createGain();
    noiseGain.gain.setValueAtTime(gainMult, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
    noise.connect(band).connect(noiseGain).connect(this.masterGain);
    noise.start(time);
    noise.stop(time + 0.2);

    // Body/tonal component
    const osc = this.audioCtx.createOscillator();
    const oscGain = this.audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(200, time);
    oscGain.gain.setValueAtTime(0.6 * gainMult, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);
    osc.connect(oscGain).connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.15);
    this.dispatchEvent(createSnare());
    this.dispatchEvent(createChange());
  }

  private playHiHat(time: number, note:ActiveNoteState) {
    if (!this.audioCtx || !this.masterGain || !this.noiseBuffer) return;
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const hp = this.audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.5 * (note == 2 ? 1 : 0.5), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    noise.connect(hp).connect(gain).connect(this.masterGain);
    noise.start(time);
    noise.stop(time + 0.05);
    this.dispatchEvent(createHat());
    this.dispatchEvent(createChange());
  }

  getTrack(drum: Instrument): NoteState[] {
    return this.patterns[drum];
  }

  toggleNote(drum: Instrument, note: number, state: NoteState) {
    this.patterns[drum][note] = state;
    this.dispatchEvent(createChange());
  }

  private getNote(track: Instrument, step: number): NoteState {
    return this.patterns[track][step];
  }

  private scheduleStep(step: number, time: number) {
    const h = this.getNote("hihat",step);
    const s = this.getNote("snare",step);
    const k = this.getNote("kicks",step);

    if (h > 0) this.playHiHat(time,h as ActiveNoteState);
    if (s > 0) this.playSnare(time,s as ActiveNoteState);
    if (k > 0) this.playKick(time,k as ActiveNoteState);
  }

  private advanceNote() {
    this.nextNoteTime += this.secondsPer16th();
    this.current16th = (this.current16th + 1) % 16;
  }

  private scheduler = () => {
    if (!this.audioCtx) return;
    while (
      this.nextNoteTime <
      this.audioCtx.currentTime + this.scheduleAheadS
    ) {
      this.scheduleStep(this.current16th, this.nextNoteTime);
      this.advanceNote();
    }
  };
}
