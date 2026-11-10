type SoundName = "tap" | "send" | "receive" | "delivered" | "dice" | "tick" | "move" | "ladder" | "snake" | "win" | "capture" | "drop" | "correct" | "wrong" | "game";

let audioContext: AudioContext | null = null;
let soundEnabled = true;

export const setSoundsEnabled = (enabled: boolean) => { soundEnabled = enabled; };

const getContext = () => {
  if (typeof window === "undefined") return null;
  const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtor) return null;
  audioContext ??= new AudioCtor();
  if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
  return audioContext;
};

const tone = (ctx: AudioContext, frequency: number, duration: number, start: number, type: OscillatorType = "sine", volume = 0.045, endFrequency?: number) => {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain); gain.connect(ctx.destination);
  oscillator.start(start); oscillator.stop(start + duration + 0.02);
};

export const playSound = (name: SoundName) => {
  if (!soundEnabled) return;
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.005;
  const notes: Record<SoundName, [number, number, OscillatorType, number][]> = {
    tap: [[620,.055,"sine",.018]],
    send: [[520,.07,"sine",.025],[780,.11,"sine",.025]],
    receive: [[660,.09,"sine",.035],[880,.16,"sine",.03]],
    delivered: [[880,.05,"sine",.018],[1040,.07,"sine",.016]],
    dice: [[260,.18,"triangle",.05],[420,.12,"triangle",.035]],
    tick: [[900,.045,"sine",.018]],
    move: [[420,.07,"triangle",.025]],
    ladder: [[520,.12,"sine",.035],[660,.12,"sine",.035],[880,.2,"sine",.03]],
    snake: [[420,.12,"sawtooth",.025],[250,.24,"triangle",.04]],
    win: [[523,.12,"sine",.035],[659,.12,"sine",.035],[784,.18,"sine",.04],[1046,.28,"sine",.035]],
    capture: [[180,.12,"triangle",.05],[120,.16,"triangle",.035]],
    drop: [[390,.1,"sine",.04],[250,.08,"triangle",.025]],
    correct: [[660,.09,"sine",.035],[880,.16,"sine",.035]],
    wrong: [[260,.2,"triangle",.035],[190,.2,"triangle",.025]],
    game: [[440,.08,"sine",.025],[660,.12,"sine",.025]],
  };
  notes[name].forEach(([frequency, duration, type, volume], index) => tone(ctx, frequency, duration, now + index * 0.105, type, volume));
};

export const unlockSounds = () => { void getContext(); };
