// Background music (requested after Day 10). Unit II: sound for immersion.
//
// Plays public/audio/music.mp3 on a loop if it exists. If it does not (or
// cannot be decoded), it silently falls back to a GENERATED score, so the game
// is never silent and never fails: a slow desert drone (two detuned low tones
// breathing through a filter) with sparse, long notes picked from the D
// Phrygian-dominant scale — the "middle-eastern" mode — fed through a feedback
// delay for a sense of open space. That score is composed in code for this
// project, so there is nothing to license.
//
// Level: loudness is matched by measurement, not by guessing gains. An
// AnalyserNode reads the music's RMS level every half second and a trim gain
// steers it to `targetRms` — 40% of the engine's measured RMS at full throttle
// (AudioManager). So a quiet or a loud mp3 both end up at the same 40%, and the
// generated score does too. Everything then goes through the master gain, so
// the volume slider and mute apply to it as well.

/** Where to drop a downloaded track. Must be CC0 / CC-BY (credit it in ASSETS_AND_CREDITS.md). */
export const MUSIC_URL = '/audio/music.mp3';

/** D Phrygian dominant, around D3-D5: D Eb F# G A Bb C. */
const SCALE_HZ = [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 369.99, 392.0, 440.0];

export type MusicSource = 'file' | 'generated' | 'none';

export class MusicPlayer {
  /** Which kind of music is playing (debug readout). */
  source: MusicSource = 'none';

  private readonly bus: GainNode;
  /** Loudness-matching trim before the analyser. */
  private readonly trim: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private levelTimer = 0;
  /** Last measured RMS of the music after trimming (debug readout). */
  measuredRms = 0;
  private element: HTMLAudioElement | null = null;
  private elementNode: MediaElementAudioSourceNode | null = null;
  private generated: { nodes: AudioNode[]; oscillators: OscillatorNode[]; timer: number } | null = null;
  private starting: Promise<void> | null = null;
  private playing = false;

  /**
   * @param targetRms Loudness to hold the music at (linear RMS, before the master gain).
   */
  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    public targetRms: number,
  ) {
    // sources -> bus -> trim -> analyser -> destination
    this.bus = context.createGain();
    this.trim = context.createGain();
    this.trim.gain.value = 0.15; // start on the quiet side; matchLevel() settles it
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.bus.connect(this.trim).connect(this.analyser).connect(destination);
    this.levelTimer = window.setInterval(() => this.matchLevel(), 500);
  }

  /**
   * Loudness matching: RMS = sqrt(mean(x^2)) over the analyser window; nudge
   * the trim towards target / measured, slowly, so quiet passages of a track
   * are not pumped up into noise (the trim is clamped to 0.05..4).
   */
  private matchLevel(): void {
    if (!this.playing) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += sample * sample;
    const rms = Math.sqrt(sum / this.samples.length);
    this.measuredRms = rms;
    if (rms < 1e-4) return; // silence between notes: leave the trim alone
    const ratio = Math.max(0.5, Math.min(2, this.targetRms / rms));
    const next = Math.max(0.05, Math.min(4, this.trim.gain.value * Math.pow(ratio, 0.5)));
    this.trim.gain.setTargetAtTime(next, this.context.currentTime, 0.5);
  }

  /** Start (or keep) playing. Safe to call repeatedly. */
  start(): Promise<void> {
    if (this.playing) return Promise.resolve();
    this.playing = true;
    this.starting ??= this.begin();
    return this.starting;
  }

  /** Fade out and stop. */
  stop(): void {
    this.playing = false;
    this.starting = null;
    const now = this.context.currentTime;
    if (this.element) this.element.pause();
    if (this.generated) {
      const { oscillators, timer, nodes } = this.generated;
      window.clearInterval(timer);
      for (const osc of oscillators) osc.stop(now + 0.1);
      for (const node of nodes) node.disconnect();
      this.generated = null;
    }
    this.source = 'none';
  }

  dispose(): void {
    this.stop();
    window.clearInterval(this.levelTimer);
    this.elementNode?.disconnect();
    this.element?.removeAttribute('src');
    this.element = null;
    this.bus.disconnect();
  }

  // ------------------------------------------------------------------ playback

  private async begin(): Promise<void> {
    if (await this.fileExists()) {
      try {
        this.element ??= this.createElement();
        await this.element.play();
        if (this.playing) {
          this.source = 'file';
          return;
        }
        this.element.pause();
        return;
      } catch {
        /* undecodable or blocked: fall through to the generated score */
      }
    }
    if (this.playing) this.startGenerated();
  }

  /** HEAD first, like AssetLoader: Vite answers a missing file with its HTML page. */
  private async fileExists(): Promise<boolean> {
    try {
      const response = await fetch(MUSIC_URL, { method: 'HEAD' });
      const type = response.headers.get('content-type') ?? '';
      return response.ok && !type.includes('text/html');
    } catch {
      return false;
    }
  }

  private createElement(): HTMLAudioElement {
    const element = new Audio(MUSIC_URL);
    element.loop = true;
    element.preload = 'auto';
    // Route through Web Audio so the music bus level, master volume and mute apply.
    this.elementNode = this.context.createMediaElementSource(element);
    this.elementNode.connect(this.bus);
    return element;
  }

  // ------------------------------------------------------------- generated score

  private startGenerated(): void {
    const context = this.context;
    const now = context.currentTime;
    const nodes: AudioNode[] = [];
    const oscillators: OscillatorNode[] = [];

    // Space: a feedback delay (echoes fading out) shared by everything.
    const delay = context.createDelay(2);
    delay.delayTime.value = 0.62;
    const feedback = context.createGain();
    feedback.gain.value = 0.42;
    const delayTone = context.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 1800;
    delay.connect(delayTone).connect(feedback).connect(delay);
    delayTone.connect(this.bus);
    nodes.push(delay, feedback, delayTone);

    // Drone: D2 and a slightly detuned A2, through a filter that slowly breathes.
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 320;
    droneFilter.Q.value = 2;
    const droneGain = context.createGain();
    droneGain.gain.setValueAtTime(0.0001, now);
    droneGain.gain.exponentialRampToValueAtTime(0.32, now + 6); // fade in
    droneFilter.connect(droneGain).connect(this.bus);
    nodes.push(droneFilter, droneGain);
    for (const [frequency, type, detune] of [
      [73.42, 'sawtooth', -6],
      [73.42, 'sawtooth', 6],
      [110.0, 'triangle', 3],
    ] as const) {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      osc.connect(droneFilter);
      osc.start(now);
      oscillators.push(osc);
    }
    // The breath: a very slow LFO on the drone's filter cutoff.
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 180;
    lfo.connect(lfoDepth).connect(droneFilter.frequency);
    lfo.start(now);
    oscillators.push(lfo);
    nodes.push(lfoDepth);

    // Melody: every few seconds maybe one long, soft note from the scale.
    let previous = 4;
    const playNote = (): void => {
      if (Math.random() < 0.35) return; // silence is part of it
      // Mostly small steps, sometimes a leap: sounds sung rather than random.
      previous = Math.max(0, Math.min(SCALE_HZ.length - 1, previous + Math.round((Math.random() - 0.5) * 4)));
      this.note(SCALE_HZ[previous]!, 2.8 + Math.random() * 2.5, delay);
    };
    const timer = window.setInterval(playNote, 2600);
    window.setTimeout(playNote, 3000);

    this.generated = { nodes, oscillators, timer };
    this.source = 'generated';
  }

  /** One breathy, flute-like note: a triangle and a faint octave sine with slow attack. */
  private note(frequency: number, seconds: number, send: AudioNode): void {
    const context = this.context;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1400;
    gain.connect(tone);
    tone.connect(this.bus);
    tone.connect(send);

    const body = context.createOscillator();
    body.type = 'triangle';
    body.frequency.value = frequency;
    // A little slow vibrato once the note has bloomed.
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5;
    const vibratoDepth = context.createGain();
    vibratoDepth.gain.setValueAtTime(0, now);
    vibratoDepth.gain.linearRampToValueAtTime(frequency * 0.006, now + 1.5);
    vibrato.connect(vibratoDepth).connect(body.frequency);
    const air = context.createOscillator();
    air.type = 'sine';
    air.frequency.value = frequency * 2;
    const airGain = context.createGain();
    airGain.gain.value = 0.15;
    air.connect(airGain).connect(gain);
    body.connect(gain);

    for (const osc of [body, vibrato, air]) {
      osc.start(now);
      osc.stop(now + seconds + 0.1);
    }
  }
}
