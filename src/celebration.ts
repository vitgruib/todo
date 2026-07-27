// A short, cheerful "task done" chime synthesized with the Web Audio API — no asset needed.
// Called from a click handler (completing a task), so the AudioContext is allowed to start.

let audioCtx: AudioContext | null = null;

export function playCelebrationSound() {
    try {
        const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') void audioCtx.resume();

        const now = audioCtx.currentTime;
        // Ascending major arpeggio: C5 · E5 · G5 · C6.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
            const t = now + i * 0.075;
            const osc = audioCtx!.createOscillator();
            const gain = audioCtx!.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
            osc.connect(gain).connect(audioCtx!.destination);
            osc.start(t);
            osc.stop(t + 0.4);
        });
    } catch {
        // Audio is a nice-to-have; ignore any failure (autoplay policy, no device, etc.).
    }
}
