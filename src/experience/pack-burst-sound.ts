/**
 * Sound for the burst opening, synthesised on the spot so the experience
 * ships no audio files and the embed stays one script.
 *
 * Foil is shaped noise; everything tonal sits on one pentatonic scale, so
 * voices that overlap — five cards landing, a hover during the swirl — still
 * agree with each other. The tear is a loop that never stops and is simply
 * held at silence until the hand moves, which is what lets its loudness
 * follow the speed of the drag with no retrigger clicks.
 *
 * Audio is a nicety: every entry point swallows its own failures, and a host
 * that cannot start a context just gets a silent opening.
 */

export interface PackSound {
  /** Call from a user gesture; browsers keep a context suspended until one. */
  resume(): void;
  setMuted(muted: boolean): void;
  /** Fingers closing on the wrapper. */
  grab(): void;
  /** Continuous tear loudness, 0 (still) to 1 (a hard rip). */
  rip(level: number): void;
  /** Let go of a half-torn pack. */
  settle(): void;
  /** The strip coming away; `flies` adds the rush of the cards leaving. */
  pop(flies: boolean): void;
  /** The ring of cards sweeping round, lasting `seconds`. */
  swirl(seconds: number): void;
  /** One card touching down. `pan` is -1 … 1; `best` earns a small chime. */
  land(pan: number, best: boolean): void;
  /** A card rising under the pointer. */
  lift(pan: number): void;
  tick(): void;
  dispose(): void;
}

const LEVEL = 0.8;
/** C major pentatonic from C5; `step` 5 is the octave. */
const SCALE = [0, 2, 4, 7, 9];
const pitch = (step: number): number =>
  523.25 * 2 ** ((12 * Math.floor(step / 5) + SCALE[((step % 5) + 5) % 5]) / 12);

interface PuffOptions {
  at?: number;
  crackle?: boolean;
  lowpass?: boolean;
  from: number;
  to: number;
  q?: number;
  gain: number;
  attack?: number;
  seconds: number;
  wet?: number;
  pan?: number | Float32Array;
}

interface ChirpOptions {
  at?: number;
  gain?: number;
  attack?: number;
  wet?: number;
  pan?: number;
  sine?: boolean;
}

function build(context: AudioContext): PackSound {
  const rate = context.sampleRate;
  const now = () => context.currentTime;

  const master = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  master.gain.value = LEVEL;
  master.connect(limiter).connect(context.destination);

  const fill = (
    channels: number,
    seconds: number,
    write: (data: Float32Array) => void,
  ): AudioBuffer => {
    const buffer = context.createBuffer(
      channels,
      Math.max(1, Math.floor(seconds * rate)),
      rate,
    );
    for (let c = 0; c < channels; c += 1) write(buffer.getChannelData(c));
    return buffer;
  };

  const hiss = fill(1, 2, (data) => {
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  });
  // Foil does not hiss, it crackles: hundreds of separate folds giving way,
  // a few loud and most faint. Played quietly only the loud ones carry, so a
  // slow tear is single ticks and a fast one fuses into a rip.
  const crackle = fill(1, 2, (data) => {
    for (let fold = 0; fold < 850; fold += 1) {
      const length = 40 + Math.floor(Math.random() * 240);
      const start = Math.floor(Math.random() * (data.length - length - 1));
      const loudness = Math.random() ** 3 * (Math.random() < 0.5 ? -1 : 1);
      for (let i = 0; i < length; i += 1) {
        data[start + i] +=
          loudness * (Math.random() * 2 - 1) * Math.exp((-4.5 * i) / length);
      }
    }
  });

  // One small bright room shared by every voice.
  const room = context.createConvolver();
  room.buffer = fill(2, 0.8, (data) => {
    let smooth = 0;
    for (let i = 0; i < data.length; i += 1) {
      const k = i / data.length;
      smooth += (Math.random() * 2 - 1 - smooth) * (0.55 - 0.45 * k);
      data[i] = smooth * (1 - k) ** 3;
    }
  });
  const roomLevel = context.createGain();
  roomLevel.gain.value = 0.28;
  room.connect(roomLevel).connect(master);

  const route = (node: AudioNode, wet: number) => {
    node.connect(master);
    if (wet > 0) {
      const send = context.createGain();
      send.gain.value = wet;
      node.connect(send).connect(room);
    }
  };
  const swell = (
    param: AudioParam,
    at: number,
    peak: number,
    attack: number,
    seconds: number,
  ) => {
    param.setValueAtTime(0.0001, at);
    param.exponentialRampToValueAtTime(peak, at + attack);
    param.exponentialRampToValueAtTime(0.0001, at + seconds);
  };

  /** A filtered breath of noise whose colour sweeps as it fades. */
  const puff = ({
    at = now(),
    crackle: useCrackle = false,
    lowpass = false,
    from,
    to,
    q = 1,
    gain,
    attack = 0.004,
    seconds,
    wet = 0,
    pan = 0,
  }: PuffOptions) => {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const level = context.createGain();
    const panner = context.createStereoPanner();
    source.buffer = useCrackle ? crackle : hiss;
    source.loop = true;
    filter.type = lowpass ? "lowpass" : "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + seconds);
    swell(level.gain, at, gain, attack, seconds);
    if (typeof pan === "number") panner.pan.value = pan;
    else panner.pan.setValueCurveAtTime(pan, at, seconds);
    source.connect(filter).connect(level).connect(panner);
    route(panner, wet);
    source.start(at, Math.random() * 1.7);
    source.stop(at + seconds + 0.03);
  };

  /** A struck bar: the note plus two inharmonic overtones that die sooner. */
  const bar = (
    frequency: number,
    at: number,
    gain: number,
    seconds: number,
    pan: number,
  ) => {
    const level = context.createGain();
    const panner = context.createStereoPanner();
    level.gain.value = gain;
    panner.pan.value = pan;
    level.connect(panner);
    route(panner, 0.6);
    for (const [ratio, amount, life] of [
      [1, 1, 1],
      [3.93, 0.16, 0.25],
      [9.1, 0.045, 0.09],
    ]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const length = Math.max(0.03, seconds * life);
      oscillator.frequency.value = frequency * ratio;
      swell(envelope.gain, at, amount, 0.002, length);
      oscillator.connect(envelope).connect(level);
      oscillator.start(at);
      oscillator.stop(at + length + 0.03);
    }
  };

  /** A round tone gliding through `[seconds, ratio]` points. */
  const chirp = (
    frequency: number,
    contour: Array<[number, number]>,
    {
      at = now(),
      gain = 0.05,
      attack = 0.008,
      wet = 0.2,
      pan = 0,
      sine = false,
    }: ChirpOptions = {},
  ) => {
    const oscillator = context.createOscillator();
    const level = context.createGain();
    const panner = context.createStereoPanner();
    const seconds = contour[contour.length - 1][0] + 0.05;
    oscillator.type = sine ? "sine" : "triangle";
    panner.pan.value = pan;
    for (const [time, ratio] of contour) {
      if (time === 0) oscillator.frequency.setValueAtTime(frequency * ratio, at);
      else {
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * ratio,
          at + time,
        );
      }
    }
    swell(level.gain, at, gain, attack, seconds);
    oscillator.connect(level).connect(panner);
    route(panner, wet);
    oscillator.start(at);
    oscillator.stop(at + seconds + 0.03);
  };

  const ripSource = context.createBufferSource();
  const ripBand = context.createBiquadFilter();
  const ripTop = context.createBiquadFilter();
  const ripLevel = context.createGain();
  ripSource.buffer = crackle;
  ripSource.loop = true;
  ripBand.type = "bandpass";
  ripBand.Q.value = 0.6;
  ripTop.type = "lowpass";
  ripTop.frequency.value = 6200;
  ripLevel.gain.value = 0;
  ripSource.connect(ripBand).connect(ripTop).connect(ripLevel);
  route(ripLevel, 0.1);
  ripSource.start();
  let ripping = 0;

  return {
    resume() {
      if (context.state === "suspended") void context.resume();
    },
    setMuted(muted) {
      master.gain.setTargetAtTime(muted ? 0 : LEVEL, now(), 0.015);
    },
    grab() {
      puff({
        crackle: true,
        from: 3100,
        to: 2100,
        q: 0.7,
        gain: 0.28,
        attack: 0.003,
        seconds: 0.09,
      });
    },
    rip(level) {
      const next = Math.min(1, Math.max(0, level));
      if (Math.abs(next - ripping) < 0.01 && (next > 0 || ripping === 0)) return;
      const rising = next > ripping;
      ripping = next;
      // Fast up, slower down: a tear starts at once and trails off.
      ripLevel.gain.setTargetAtTime(next ** 0.8 * 0.16, now(), rising ? 0.008 : 0.05);
      ripBand.frequency.setTargetAtTime(1700 + 2100 * next, now(), 0.02);
      ripSource.playbackRate.setTargetAtTime(0.7 + 0.8 * next, now(), 0.02);
    },
    settle() {
      puff({ from: 1400, to: 650, q: 0.6, gain: 0.035, attack: 0.02, seconds: 0.25 });
      puff({
        crackle: true,
        from: 2600,
        to: 1800,
        q: 0.7,
        gain: 0.12,
        attack: 0.004,
        seconds: 0.07,
      });
    },
    pop(flies) {
      const at = now();
      puff({ at, from: 5200, to: 1700, q: 0.9, gain: 0.15, attack: 0.002, seconds: 0.1 });
      chirp(280, [[0, 0.8], [0.05, 3.2]], { at, gain: 0.26, wet: 0.15 });
      if (!flies) return;
      puff({
        at: at + 0.01,
        from: 480,
        to: 3300,
        q: 0.8,
        gain: 0.09,
        attack: 0.2,
        seconds: 0.7,
        wet: 0.6,
      });
      for (let i = 0; i < 3; i += 1) {
        bar(
          pitch(8 + Math.floor(Math.random() * 5)),
          at + 0.12 + Math.random() ** 1.4 * 0.5,
          0.012 + Math.random() * 0.014,
          0.35,
          Math.random() * 1.4 - 0.7,
        );
      }
    },
    swirl(seconds) {
      // The air goes round with the cards: the pan follows the same eased
      // turn the ring does, and narrows as the ring closes into a row.
      const sweep = Float32Array.from({ length: 64 }, (_, i) => {
        const u = i / 63;
        return Math.cos((1 - (1 - u) ** 2) * Math.PI * 2.5) * (1 - u) * 0.8;
      });
      puff({
        from: 680,
        to: 1850,
        q: 0.9,
        gain: 0.12,
        attack: seconds * 0.4,
        seconds,
        wet: 0.4,
        pan: sweep,
      });
    },
    land(pan, best) {
      const at = now();
      puff({ at, from: 2500, to: 1250, q: 0.6, gain: 0.07, attack: 0.002, seconds: 0.05, pan });
      // Only the best card says anything, so a row lands quietly with one payoff.
      if (best) {
        bar(pitch(4), at + 0.05, 0.05, 0.6, pan);
        bar(pitch(7), at + 0.14, 0.04, 0.7, pan);
      }
    },
    lift(pan) {
      puff({
        lowpass: true,
        from: 780,
        to: 470,
        q: 0.3,
        gain: 0.05,
        attack: 0.09,
        seconds: 0.22,
        pan,
      });
    },
    tick() {
      chirp(880, [[0, 0.9], [0.05, 1.12]], { gain: 0.04, wet: 0 });
    },
    dispose() {
      try {
        ripSource.stop();
      } catch {
        // Already stopped.
      }
      void context.close();
    },
  };
}

/**
 * Starts the synthesiser, or returns null where audio is unavailable. Each
 * voice is wrapped so a failing node can never interrupt the animation.
 */
export function createPackSound(): PackSound | null {
  try {
    const AudioContextClass =
      globalThis.AudioContext ??
      (
        globalThis as typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextClass) return null;
    const sound = build(new AudioContextClass({ latencyHint: "interactive" }));
    const guarded = {} as Record<string, (...args: never[]) => void>;
    for (const [name, voice] of Object.entries(sound)) {
      guarded[name] = (...args: never[]) => {
        try {
          (voice as (...inner: never[]) => void)(...args);
        } catch {
          // Sound is an enhancement only.
        }
      };
    }
    return guarded as unknown as PackSound;
  } catch {
    return null;
  }
}
