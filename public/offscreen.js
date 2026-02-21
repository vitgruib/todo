const PLAY_SOUND_MESSAGE_TYPE = 'todo-ai-play-alarm-sound';
let audioContext = null;
const DEFAULT_SOUND = 'alarm';
const ALLOWED_SOUNDS = new Set(['alarm', 'ding', 'happy', 'hard-clock', 'chime']);

async function getAudioContext() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }

    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    return audioContext;
}

function normalizeSound(value) {
    if (typeof value !== 'string') {
        return DEFAULT_SOUND;
    }

    return ALLOWED_SOUNDS.has(value) ? value : DEFAULT_SOUND;
}

function playTone(context, {
    startTime,
    frequency,
    duration,
    type = 'sine',
    volume = 0.22,
}) {
    const endTime = startTime + duration;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(volume, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
}

async function playAlarmTone(sound) {
    const context = await getAudioContext();
    const now = context.currentTime;
    const selectedSound = normalizeSound(sound);

    if (selectedSound === 'ding') {
        playTone(context, { startTime: now, frequency: 1046, duration: 0.28, type: 'triangle', volume: 0.2 });
        return;
    }

    if (selectedSound === 'happy') {
        const notes = [
            { frequency: 523, duration: 0.12, delay: 0 },
            { frequency: 659, duration: 0.12, delay: 0.16 },
            { frequency: 784, duration: 0.14, delay: 0.32 },
            { frequency: 988, duration: 0.22, delay: 0.5 },
        ];
        for (const note of notes) {
            playTone(context, {
                startTime: now + note.delay,
                frequency: note.frequency,
                duration: note.duration,
                type: 'triangle',
                volume: 0.2,
            });
        }
        return;
    }

    if (selectedSound === 'hard-clock') {
        const clicks = [0, 0.14, 0.28, 0.42];
        for (const delay of clicks) {
            playTone(context, {
                startTime: now + delay,
                frequency: 210,
                duration: 0.05,
                type: 'square',
                volume: 0.28,
            });
        }
        return;
    }

    if (selectedSound === 'chime') {
        playTone(context, { startTime: now, frequency: 740, duration: 0.2, type: 'sine', volume: 0.16 });
        playTone(context, { startTime: now + 0.18, frequency: 1110, duration: 0.38, type: 'sine', volume: 0.14 });
        return;
    }

    const notes = [
        { frequency: 820, duration: 0.11, delay: 0 },
        { frequency: 620, duration: 0.11, delay: 0.16 },
        { frequency: 820, duration: 0.11, delay: 0.32 },
        { frequency: 620, duration: 0.16, delay: 0.48 },
    ];
    for (const note of notes) {
        playTone(context, {
            startTime: now + note.delay,
            frequency: note.frequency,
            duration: note.duration,
            type: 'sawtooth',
            volume: 0.2,
        });
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== PLAY_SOUND_MESSAGE_TYPE) {
        return;
    }

    playAlarmTone(message?.sound).catch((error) => {
        console.error('Failed to play offscreen alarm tone:', error);
    });
});
