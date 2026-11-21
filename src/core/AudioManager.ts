// Day 10. Unit II: sound as a VR output device (immersion).
//
// All sound is SYNTHESISED with the Web Audio API — oscillators, filtered
// noise and gain envelopes — so there are no audio files to license or load and
// no new dependency (CLAUDE.md). It reacts only to EventBus messages:
//
//   ship:telemetry   engine hum: pitch and loudness follow throttle and speed
//   ship:collision   a low thump plus a noise crack, louder for harder hits
//   state:changed    Warp: a rising whoosh; Surface: wind, by biome
//   mentat:toggle    a soft two-note chime
//   any state        background music (MusicPlayer): public/audio/music.mp3 if
//                    present, otherwise a score generated in code, at ~40% of
//                    the ship's loudness
//
// Browsers only allow audio after a user gesture, so the AudioContext is
// created (or resumed) on the first pointer press or game input.

import type { EventBus } from './EventBus';
import { MusicPlayer, type MusicSource } from './MusicPlayer';

/**
 * RMS of the engine sound at full throttle (300 u/s, no boost), measured by
 * rendering the engine chain below in an OfflineAudioContext: 0.099. The music
 * is held at MUSIC_SHARE of it. Re-measure if startEngine()/setEngine() change.
 */
const ENGINE_FULL_THROTTLE_RMS = 0.099;
/** Music loudness relative to the ship at full throttle (Jeff: about 40%). */
export const MUSIC_SHARE = 0.4;

/** How windy each biome sounds, 0..1. */
const WIND_BY_BIOME: Record<string, number> = {
  desert: 0.8,
  ocean: 0.5,
  industrial: 0.35,
  temperate: 0.3,
  wasteland: 0.7,
  ice: 0.65,
};

export class AudioManager {
  /** Master volume 0..1 (lil-gui can change it). */
  volume = 0.6;
  muted = false;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private state = '';
  private music: MusicPlayer | null = null;
  /** Music level relative to the ship, 0..1 (lil-gui). Default 40%. */
  musicShare = MUSIC_SHARE;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly unlock = (): void => {
    this.ensureContext();
  };

  constructor(bus: EventBus) {
    window.addEventListener('pointerdown', this.unlock);
    this.unsubscribers.push(
      bus.on('input:trigger', this.unlock),
      bus.on('ship:telemetry', ({ speed, throttle, boosting }) => this.setEngine(speed, throttle, boosting)),
      bus.on('ship:collision', ({ impactSpeed }) => this.impact(impactSpeed)),
      bus.on('state:changed', ({ to }) => this.onState(to)),
      bus.on('surface:entered', ({ biome }) => this.setWind(WIND_BY_BIOME[biome] ?? 0.4)),
      bus.on('mentat:toggle', ({ open }) => {
        if (open) this.chime();
      }),
    );
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  setMusicShare(share: number): void {
    this.musicShare = Math.max(0, Math.min(1, share));
    if (this.music) this.music.targetRms = ENGINE_FULL_THROTTLE_RMS * this.musicShare;
  }

  /** 'file' (music.mp3), 'generated', or 'none' — for the debug panel. */
  get musicSource(): MusicSource {
    return this.music?.source ?? 'none';
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyVolume();
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlock);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.music?.dispose();
    this.music = null;
    void this.context?.close();
    this.context = null;
  }

  // ------------------------------------------------------------------ plumbing

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return null; // no audio device: the game simply stays silent
      }
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.applyVolume();
      // Two seconds of white noise, reused by every noisy sound.
      const length = this.context.sampleRate * 2;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.music = new MusicPlayer(this.context, this.master, ENGINE_FULL_THROTTLE_RMS * this.musicShare);
      this.onState(this.state);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  private applyVolume(): void {
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.context.currentTime, 0.05);
    }
  }

  private onState(state: string): void {
    this.state = state;
    if (!this.context) return;
    if (state === 'Space') this.startEngine();
    else this.stopEngine();
    if (state !== 'Surface') this.setWind(0);
    if (state === 'Warp') this.whoosh();
    // Music runs everywhere once audio is unlocked, from the title screen on.
    if (state === 'Menu' || state === 'Space' || state === 'Warp' || state === 'Surface') void this.music?.start();
  }

  // ------------------------------------------------------------------ sounds

  /** Engine: a sawtooth and a sub-octave through a low-pass filter. */
  private startEngine(): void {
    const context = this.context;
    if (!context || !this.master || this.engine) return;
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 48;
    const sub = context.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 24;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    const gain = context.createGain();
    gain.gain.value = 0.02;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain };
  }

  private stopEngine(): void {
    if (!this.engine || !this.context) return;
    const { osc, sub, gain } = this.engine;
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
    osc.stop(this.context.currentTime + 0.5);
    sub.stop(this.context.currentTime + 0.5);
    this.engine = null;
  }

  private setEngine(speed: number, throttle: number, boosting: boolean): void {
    if (!this.engine || !this.context) return;
    const now = this.context.currentTime;
    const drive = Math.min(1, throttle * (boosting ? 1.5 : 1));
    const pitch = 42 + Math.min(speed, 600) * 0.08 + drive * 18;
    this.engine.osc.frequency.setTargetAtTime(pitch, now, 0.15);
    this.engine.sub.frequency.setTargetAtTime(pitch / 2, now, 0.15);
    this.engine.filter.frequency.setTargetAtTime(160 + drive * 900, now, 0.12);
    this.engine.gain.gain.setTargetAtTime(0.025 + drive * 0.09, now, 0.12);
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.context || !this.noise) return null;
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    return source;
  }

  /** Impact: a falling sine thump and a short band-passed crack. */
  private impact(speed: number): void {
    const context = this.ensureContext();
    if (!context || !this.master) return;
    const now = context.currentTime;
    const strength = Math.min(1, speed / 120);

    const thump = context.createOscillator();
    thump.frequency.setValueAtTime(110, now);
    thump.frequency.exponentialRampToValueAtTime(35, now + 0.35);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.5 * strength + 0.1, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.5);

    const crack = this.noiseSource();
    if (crack) {
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 900;
      const crackGain = context.createGain();
      crackGain.gain.setValueAtTime(0.35 * strength + 0.05, now);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      crack.connect(band).connect(crackGain).connect(this.master);
      crack.start(now);
      crack.stop(now + 0.3);
    }
  }

  /** Warp: noise swept up through a resonant filter over the 1.5 s jump. */
  private whoosh(): void {
    const context = this.context;
    const source = this.noiseSource();
    if (!context || !source || !this.master) return;
    const now = context.currentTime;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(200, now);
    filter.frequency.exponentialRampToValueAtTime(3500, now + 1.4);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 1.7);
  }

  /** Surface wind: looping low-passed noise; 0 stops it. */
  private setWind(level: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    if (level <= 0) {
      if (this.wind) {
        this.wind.gain.gain.setTargetAtTime(0, context.currentTime, 0.3);
        this.wind.source.stop(context.currentTime + 1.5);
        this.wind = null;
      }
      return;
    }
    if (!this.wind) {
      const source = this.noiseSource();
      if (!source) return;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.wind = { source, filter, gain };
    }
    this.wind.gain.gain.setTargetAtTime(0.12 * level, context.currentTime, 0.8);
  }

  /** Mentat chime: two soft sine notes. */
  private chime(): void {
    const context = this.ensureContext();
    if (!context || !this.master) return;
    const now = context.currentTime;
    [660, 990].forEach((frequency, i) => {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = context.createGain();
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(gain).connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }
}
