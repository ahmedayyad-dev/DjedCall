/* الصوت: المايك، كشف النشاط (VAD)، النغمات، ضبط البتريت */

import { AUDIO_CONSTRAINTS, MAX_BITRATE, STATS_INTERVAL, VAD } from './config.js';

let audioContext = null;
let micStream = null;
let vadTicker = null;

const sources = new Map();
let onSpeaking = () => {};
let onLevel = () => {};

/* ------------------------- سياق الصوت ------------------------- */

export function ensureAudioContext() {
    if (!audioContext) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
}

export function chime(kind = 'join') {
    const context = ensureAudioContext();
    if (!context) return;
    const start = context.currentTime;
    const notes = kind === 'join' ? [523.25, 659.25] : [659.25, 523.25];

    notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const at = start + index * 0.11;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.11, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.2);
    });
}

/* --------------------------- المايك --------------------------- */

export function currentMic() {
    return micStream;
}

export function isMicLive() {
    return Boolean(micStream?.getAudioTracks().some((track) => track.readyState === 'live'));
}

export async function acquireMic() {
    if (isMicLive()) return micStream;
    if (!navigator.mediaDevices?.getUserMedia) {
        const error = new Error('unsupported');
        error.name = 'NotSupportedError';
        throw error;
    }
    micStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
    });
    attachVAD('local', micStream);
    startVAD();
    return micStream;
}

export function setMicEnabled(enabled) {
    micStream?.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
    });
}

export function releaseMic() {
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    detachVAD('local');
}

/* --------------------------- VAD --------------------------- */

export function setSpeakingHandler(handler) {
    onSpeaking = handler;
}

export function setLevelHandler(handler) {
    onLevel = handler;
}

export function attachVAD(id, stream) {
    if (!stream || sources.has(id)) return;
    const context = ensureAudioContext();
    if (!context) return;
    try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.55;
        source.connect(analyser);
        sources.set(id, {
            source,
            analyser,
            buffer: new Uint8Array(analyser.fftSize),
            speaking: false,
            silentTicks: 0,
        });
    } catch {
        /* مصدر صوتي غير قابل للتحليل */
    }
}

export function detachVAD(id) {
    const entry = sources.get(id);
    if (!entry) return;
    try {
        entry.source.disconnect();
    } catch {
        /* تم فصله مسبقاً */
    }
    sources.delete(id);
}

const measureRms = (analyser, buffer) => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
        const sample = (buffer[i] - 128) / 128;
        sum += sample * sample;
    }
    return Math.sqrt(sum / buffer.length);
};

function vadTick() {
    for (const [id, entry] of sources) {
        let rms = 0;
        try {
            rms = measureRms(entry.analyser, entry.buffer);
        } catch {
            continue;
        }

        if (id === 'local') onLevel(rms);

        const threshold = entry.speaking ? VAD.stop : VAD.start;
        const loud = rms > threshold;

        if (loud && !entry.speaking) {
            entry.speaking = true;
            entry.silentTicks = 0;
            onSpeaking(id, true);
        } else if (!loud && entry.speaking) {
            entry.silentTicks += 1;
            if (entry.silentTicks >= VAD.holdTicks) {
                entry.speaking = false;
                entry.silentTicks = 0;
                onSpeaking(id, false);
            }
        } else if (loud) {
            entry.silentTicks = 0;
        }
    }
}

export function startVAD() {
    if (vadTicker) return;
    vadTicker = setInterval(vadTick, VAD.tickMs);
}

export function stopVAD() {
    clearInterval(vadTicker);
    vadTicker = null;
}

/* ------------------- ضبط البتريت عبر SDP / Sender ------------------- */

const OPUS_PARAMS = ['usedtx=1', 'stereo=0', `maxaveragebitrate=${MAX_BITRATE}`, 'cbr=0'];

export function tuneSdp(sdp) {
    if (typeof sdp !== 'string' || !sdp) return sdp;
    return sdp
        .split('\r\n')
        .map((line) => {
            if (!line.startsWith('a=fmtp:') || !/minptime|useinbandfec|opus/i.test(line)) return line;
            const missing = OPUS_PARAMS.filter((param) => !line.includes(param.split('=')[0]));
            return missing.length ? `${line};${missing.join(';')}` : line;
        })
        .join('\r\n');
}

export async function applyLowBitrate(pc) {
    if (!pc) return;
    try {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'audio');
        if (!sender) return;
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = MAX_BITRATE;
        parameters.encodings[0].networkPriority = 'low';
        await sender.setParameters(parameters);
    } catch {
        /* بعض المتصفحات ترفض تعديل المعاملات */
    }
}

export function waitForPeerConnection(mediaConnection, timeout = 9000) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (mediaConnection?.peerConnection) {
                clearInterval(timer);
                resolve(mediaConnection.peerConnection);
            } else if (Date.now() - startedAt > timeout) {
                clearInterval(timer);
                resolve(null);
            }
        }, 120);
    });
}

/* ------------------------- قياس البتريت ------------------------- */

let statsTimer = null;

export function startBitrateStats(getConnections, onUpdate) {
    stopBitrateStats();
    let lastBytes = 0;
    let lastAt = 0;

    statsTimer = setInterval(async () => {
        let bytes = 0;
        for (const pc of getConnections()) {
            if (!pc) continue;
            try {
                const report = await pc.getStats();
                report.forEach((row) => {
                    if (row.type === 'outbound-rtp' && row.kind === 'audio') bytes += row.bytesSent ?? 0;
                });
            } catch {
                /* تقرير غير متاح */
            }
        }
        const now = performance.now();
        if (lastAt) {
            const seconds = (now - lastAt) / 1000;
            onUpdate(Math.max(0, Math.round(((bytes - lastBytes) * 8) / seconds / 1000)));
        }
        lastBytes = bytes;
        lastAt = now;
    }, STATS_INTERVAL);
}

export function stopBitrateStats() {
    clearInterval(statsTimer);
    statsTimer = null;
}
