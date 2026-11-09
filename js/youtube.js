/* إدارة يوتيوب: المشاهدة والاستماع المتزامن، البحث، والتعافي اللحظي */

import {
    INVIDIOUS_INSTANCES,
    PIPED_INSTANCES,
    YT_DRIFT_INTERVAL,
    YT_DRIFT_THRESHOLD,
    YT_VIDEO_ID_PATTERN,
} from './config.js';
import { cleanSearchQuery, extractYouTubeId } from './guard.js';
import { STR } from './strings.js';
import { $, escapeHtml, formatTime, safeTimestamp } from './utils.js';

let rtcModule = null;
let uiModule = null;

export function registerDependencies(rtc, ui) {
    rtcModule = rtc;
    uiModule = ui;
}

export const state = {
    player: null,
    apiReady: false,
    playerReady: false,
    initPromise: null,

    audioEl: null,
    audioLoading: false,
    audioUsingFallback: false,

    current: null,
    // current: {
    //   videoId, title, ownerId, ownerName,
    //   globalMode: 'video' | 'audio',
    //   personalMode: null | 'video' | 'audio',
    //   isPlaying: false,
    //   duration: 0,
    //   currentTime: 0
    // }

    isRemoteAction: false,
    driftTimer: null,
    typingTimer: null,
    remoteSearchingTimer: null,
    timelineTimer: null,
    selectedMode: 'video',
};

function getAudioElement() {
    if (!state.audioEl) {
        state.audioEl = $('yt-audio-player');
        if (state.audioEl) {
            state.audioEl.addEventListener('play', () => {
                if (!state.current) return;
                state.current.isPlaying = true;
                updatePlayButtons(true);
            });
            state.audioEl.addEventListener('pause', () => {
                if (!state.current) return;
                state.current.isPlaying = false;
                updatePlayButtons(false);
            });
            state.audioEl.addEventListener('ended', () => {
                stopMedia({ broadcast: isOwner() });
            });
            state.audioEl.addEventListener('error', () => {
                // في حال تعذر خادم الصوت الخارجي، الرجوع الاحتياطي للمشغل بدون توقف الصوت
                if (effectiveMode() === 'audio' && !state.audioUsingFallback) {
                    state.audioUsingFallback = true;
                    fallbackToIframeAudio();
                }
            });
        }
    }
    return state.audioEl;
}

/* --------------------------- تحميل واجهة YouTube API --------------------------- */

export function ensureYouTubeAPI() {
    if (state.apiReady && window.YT?.Player) {
        return Promise.resolve();
    }
    if (state.initPromise) {
        return state.initPromise;
    }

    state.initPromise = new Promise((resolve, reject) => {
        if (window.YT?.Player) {
            state.apiReady = true;
            resolve();
            return;
        }

        const prevReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            state.apiReady = true;
            if (typeof prevReady === 'function') prevReady();
            resolve();
        };

        const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
        if (!existingScript) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = () => reject(new Error('Failed to load YouTube Iframe API'));
            document.head.append(tag);
        }
    });

    return state.initPromise;
}

export async function initPlayer() {
    if (state.playerReady && state.player) return state.player;

    await ensureYouTubeAPI();

    return new Promise((resolve) => {
        const container = $('youtube-player');
        if (!container) {
            resolve(null);
            return;
        }

        state.player = new window.YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            playerVars: {
                autoplay: 1,
                controls: 1,
                rel: 0,
                modestbranding: 1,
                playsinline: 1,
                enablejsapi: 1,
                origin: window.location.origin,
            },
            events: {
                onReady: () => {
                    state.playerReady = true;
                    startTimelineWatcher();
                    resolve(state.player);
                },
                onStateChange: onPlayerStateChange,
                onError: () => {
                    uiModule?.toast(STR.ytSearchFail, 'error');
                },
            },
        });
    });
}

function onPlayerStateChange(event) {
    if (!state.current) return;
    if (effectiveMode() === 'audio' && !state.audioUsingFallback) return;

    const code = event.data;
    const isPlaying = code === window.YT.PlayerState.PLAYING;
    const isBuffering = code === window.YT.PlayerState.BUFFERING;
    const isPaused = code === window.YT.PlayerState.PAUSED;
    const isEnded = code === window.YT.PlayerState.ENDED;

    if (isEnded) {
        stopMedia({ broadcast: isOwner() });
        return;
    }

    if (state.isRemoteAction) {
        if (isPlaying) {
            state.current.isPlaying = true;
            updatePlayButtons(true);
        } else if (isPaused) {
            state.current.isPlaying = false;
            updatePlayButtons(false);
        }
        return;
    }

    if (isPlaying) {
        state.current.isPlaying = true;
        updatePlayButtons(true);

        const currentSec = state.player.getCurrentTime();
        if (isOwner()) {
            startDriftChecker();
            broadcastSync('play', currentSec);
        } else if (state.current.lastHostTime) {
            const elapsed = (Date.now() - (state.current.lastHostTimeAt || Date.now())) / 1000;
            const target = state.current.lastHostTime + (state.current.isPlaying ? elapsed : 0);
            if (Math.abs(target - currentSec) > YT_DRIFT_THRESHOLD) {
                state.isRemoteAction = true;
                state.player.seekTo(target, true);
                setTimeout(() => {
                    state.isRemoteAction = false;
                }, 300);
            }
        }
    } else if (isPaused) {
        state.current.isPlaying = false;
        updatePlayButtons(false);
        if (isOwner()) {
            broadcastSync('pause', state.player.getCurrentTime());
        }
    } else if (isBuffering) {
        // لا نرسل أمر إيقاف للآخرين أثناء التحميل المؤقت
    }
}

/* --------------------------- دورة حياة الميديا --------------------------- */

export function isOwner() {
    return Boolean(state.current && rtcModule?.state?.myId && state.current.ownerId === rtcModule.state.myId);
}

export function effectiveMode() {
    if (!state.current) return 'video';
    return state.current.personalMode || state.current.globalMode || 'video';
}

export async function loadMedia({
    videoId,
    title,
    ownerId,
    ownerName,
    globalMode = 'video',
    personalMode = null,
    startTime = 0,
    isPlaying = true,
}) {
    if (!videoId || !YT_VIDEO_ID_PATTERN.test(videoId)) return;

    await initPlayer();

    state.current = {
        videoId,
        title: title || STR.defaultName,
        ownerId,
        ownerName: ownerName || STR.defaultName,
        globalMode: globalMode === 'audio' ? 'audio' : 'video',
        personalMode,
        isPlaying: Boolean(isPlaying),
        duration: 0,
        currentTime: startTime,
        lastHostTime: startTime,
        lastHostTimeAt: Date.now(),
    };

    state.audioUsingFallback = false;

    if (effectiveMode() === 'audio') {
        applyAudioMode(videoId, startTime, isPlaying);
    } else {
        applyVideoMode(videoId, startTime, isPlaying);
    }

    renderMediaUI();

    if (isOwner()) {
        startDriftChecker();
    } else {
        stopDriftChecker();
    }
}

async function applyAudioMode(videoId, startTime = 0, isPlaying = true) {
    // 1. إيقاف مشغل الفيديو كلياً لمنع استهلاك الباقة ومعالجة الفيديو
    if (state.player && state.playerReady) {
        try {
            state.player.pauseVideo();
        } catch {}
    }

    const audioEl = getAudioElement();
    if (!audioEl) return;

    state.audioLoading = true;
    state.audioUsingFallback = false;

    try {
        const streamUrl = await resolveAudioStreamUrl(videoId);
        if (streamUrl && effectiveMode() === 'audio') {
            audioEl.src = streamUrl;
            audioEl.currentTime = startTime;
            if (isPlaying) {
                audioEl.play().catch(() => {
                    // إذا منع المتصفح التشغيل التلقائي للصوت
                });
            }
            state.audioLoading = false;
            return;
        }
    } catch {
        /* فشل جلب الرابط المباشر من الـ CDN */
    }

    state.audioLoading = false;
    // احتياطي: تشغيل المشغل بدون إطار الفيديو لضمان استمرار الصوت
    fallbackToIframeAudio();
}

function fallbackToIframeAudio() {
    if (!state.player || !state.playerReady || !state.current) return;
    state.isRemoteAction = true;
    try {
        state.player.seekTo(state.current.currentTime, true);
        if (state.current.isPlaying) {
            state.player.playVideo();
        }
    } finally {
        setTimeout(() => {
            state.isRemoteAction = false;
        }, 400);
    }
}

function applyVideoMode(videoId, startTime = 0, isPlaying = true) {
    // إيقاف وتفريغ عنصر الصوت المنفصل
    const audioEl = getAudioElement();
    if (audioEl) {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
    }

    if (!state.player || !state.playerReady) return;

    state.isRemoteAction = true;
    try {
        state.player.loadVideoById({
            videoId,
            startSeconds: startTime,
        });
        if (!isPlaying) {
            state.player.pauseVideo();
        }
    } finally {
        setTimeout(() => {
            state.isRemoteAction = false;
        }, 500);
    }
}

export function playMedia() {
    if (!state.current) return;
    state.current.isPlaying = true;

    const audioEl = getAudioElement();
    if (effectiveMode() === 'audio' && !state.audioUsingFallback && audioEl && audioEl.src) {
        audioEl.play().catch(() => {});
    } else if (state.player && state.playerReady) {
        state.player.playVideo();
    }

    updatePlayButtons(true);
    if (isOwner()) {
        broadcastSync('play', getCurrentPlaybackTime());
    }
}

export function pauseMedia() {
    if (!state.current) return;
    state.current.isPlaying = false;

    const audioEl = getAudioElement();
    if (effectiveMode() === 'audio' && !state.audioUsingFallback && audioEl) {
        audioEl.pause();
    }
    if (state.player && state.playerReady) {
        state.player.pauseVideo();
    }

    updatePlayButtons(false);
    if (isOwner()) {
        broadcastSync('pause', getCurrentPlaybackTime());
    }
}

export function togglePlay() {
    if (!state.current) return;
    if (state.current.isPlaying) {
        pauseMedia();
    } else {
        playMedia();
    }
}

export function seekMedia(seconds) {
    if (!state.current) return;
    const target = Math.max(0, Math.min(seconds, state.current.duration || seconds));
    state.current.currentTime = target;

    state.isRemoteAction = true;
    try {
        const audioEl = getAudioElement();
        if (effectiveMode() === 'audio' && !state.audioUsingFallback && audioEl && audioEl.src) {
            audioEl.currentTime = target;
        }
        if (state.player && state.playerReady) {
            state.player.seekTo(target, true);
        }
        updateTimeDisplays(target, state.current.duration);
    } finally {
        setTimeout(() => {
            state.isRemoteAction = false;
        }, 300);
    }

    if (isOwner()) {
        broadcastSync('seek', target);
    }
}

export function stopMedia({ broadcast = true } = {}) {
    stopDriftChecker();

    const audioEl = getAudioElement();
    if (audioEl) {
        audioEl.pause();
        audioEl.removeAttribute('src');
        audioEl.load();
    }

    if (state.player && state.playerReady) {
        try {
            state.player.stopVideo();
        } catch {}
    }

    if (broadcast && isOwner()) {
        rtcModule?.broadcast?.({ type: 'yt-stop' });
    }

    state.current = null;
    hideMediaUI();
    uiModule?.toast(STR.ytStopped, 'info');
}

function getCurrentPlaybackTime() {
    const audioEl = getAudioElement();
    if (effectiveMode() === 'audio' && !state.audioUsingFallback && audioEl && audioEl.src) {
        return audioEl.currentTime || 0;
    }
    if (state.player && state.playerReady) {
        return state.player.getCurrentTime() || 0;
    }
    return state.current?.currentTime || 0;
}

/* --------------------------- صلاحيات الوضع: صاحب الطلب مقابل التفضيل الشخصي --------------------------- */

export function switchMode(targetMode) {
    if (!state.current) return;
    const mode = targetMode === 'audio' ? 'audio' : 'video';
    const currentTime = getCurrentPlaybackTime();

    if (isOwner()) {
        // صاحب الطلب: التغيير يطبق عند الجميع
        state.current.globalMode = mode;
        state.current.personalMode = null;
        applyModeChange(mode, currentTime);
        rtcModule?.broadcast?.({
            type: 'yt-mode',
            mode,
            time: currentTime,
            by: rtcModule.state.myId,
        });
        uiModule?.toast(STR.ytOwnerModeChanged(mode === 'audio' ? STR.ytModeAudio : STR.ytModeVideo), 'ok');
    } else {
        // مشارك آخر: تفضيل محلي فقط
        state.current.personalMode = mode;
        applyModeChange(mode, currentTime);
        uiModule?.toast(mode === 'audio' ? STR.ytPersonalModeAudio : STR.ytPersonalModeVideo, 'ok');
    }
}

function applyModeChange(mode, currentTime) {
    renderMediaUI();
    if (!state.current) return;

    if (mode === 'audio') {
        applyAudioMode(state.current.videoId, currentTime, state.current.isPlaying);
    } else {
        applyVideoMode(state.current.videoId, currentTime, state.current.isPlaying);
    }
}

export function toggleMode() {
    const currentEff = effectiveMode();
    const next = currentEff === 'video' ? 'audio' : 'video';
    switchMode(next);
}

/* --------------------------- محرك التزامن والانجراف --------------------------- */

function startDriftChecker() {
    stopDriftChecker();
    state.driftTimer = setInterval(() => {
        if (!state.current || !isOwner()) {
            stopDriftChecker();
            return;
        }

        const time = getCurrentPlaybackTime();
        broadcastSync('tick', time);
    }, YT_DRIFT_INTERVAL);
}

function stopDriftChecker() {
    if (state.driftTimer) {
        clearInterval(state.driftTimer);
        state.driftTimer = null;
    }
}

function broadcastSync(action, time) {
    if (!state.current || !rtcModule?.broadcast) return;

    rtcModule.broadcast({
        type: 'yt-sync',
        action,
        time,
        isPlaying: state.current.isPlaying,
        sentAt: Date.now(),
        videoId: state.current.videoId,
    });
}

function startTimelineWatcher() {
    if (state.timelineTimer) clearInterval(state.timelineTimer);

    state.timelineTimer = setInterval(() => {
        if (!state.current) return;

        try {
            const audioEl = getAudioElement();
            let current = 0;
            let duration = state.current.duration || 0;

            if (effectiveMode() === 'audio' && !state.audioUsingFallback && audioEl && audioEl.src) {
                current = audioEl.currentTime || 0;
                duration = audioEl.duration || duration;
            } else if (state.player && state.playerReady) {
                current = state.player.getCurrentTime() || 0;
                duration = state.player.getDuration() || duration;
            }

            state.current.currentTime = current;
            state.current.duration = duration;
            updateTimeDisplays(current, duration);
        } catch {}
    }, 500);
}

/* --------------------------- معالجة الرسائل الواردة من الأقران --------------------------- */

export function handleRemoteActivity(message, fromName) {
    if (!message || message.action !== 'searching') return;

    const banner = $('yt-searching-indicator');
    const textEl = $('yt-searching-text');
    if (!banner || !textEl) return;

    const safeName = fromName || STR.defaultName;
    textEl.textContent = STR.ytSearchingNotice(safeName);
    banner.hidden = false;

    clearTimeout(state.remoteSearchingTimer);
    state.remoteSearchingTimer = setTimeout(() => {
        banner.hidden = true;
    }, 3500);
}

export function handleRemotePlay(message, fromName) {
    if (!message?.videoId) return;

    const videoId = extractYouTubeId(message.videoId);
    if (!videoId) return;

    loadMedia({
        videoId,
        title: message.title,
        ownerId: message.ownerId,
        ownerName: message.ownerName || fromName,
        globalMode: message.globalMode || 'video',
        startTime: Number(message.time) || 0,
        isPlaying: message.isPlaying !== false,
    });

    uiModule?.toast(STR.ytPlayStarted(message.title || STR.appName, message.ownerName || fromName), 'join');
}

export function handleRemoteSync(message) {
    if (!state.current || message.videoId !== state.current.videoId) return;

    const now = Date.now();
    const latency = message.sentAt ? (now - message.sentAt) / 1000 : 0;
    const remoteTime = Number(message.time) || 0;
    const target = remoteTime + (message.isPlaying ? latency : 0);

    state.current.lastHostTime = target;
    state.current.lastHostTimeAt = now;

    const myTime = getCurrentPlaybackTime();
    const diff = Math.abs(myTime - target);

    if (message.action === 'seek' || diff > YT_DRIFT_THRESHOLD) {
        seekMedia(target);
    }

    if (message.action === 'play' || message.isPlaying) {
        if (!state.current.isPlaying) {
            playMedia();
        }
    } else if (message.action === 'pause' || !message.isPlaying) {
        if (state.current.isPlaying) {
            pauseMedia();
        }
    }
}

export function handleRemoteMode(message) {
    if (!state.current) return;
    if (message.mode === 'video' || message.mode === 'audio') {
        state.current.globalMode = message.mode;
        state.current.personalMode = null;
        applyModeChange(message.mode, Number(message.time) || state.current.currentTime);
        uiModule?.toast(
            STR.ytOwnerModeChanged(message.mode === 'audio' ? STR.ytModeAudio : STR.ytModeVideo),
            'info',
        );
    }
}

export function handleRemoteStop() {
    stopMedia({ broadcast: false });
}

export function handleStateRequest(targetPeerConn) {
    if (!state.current || !targetPeerConn) return;

    const currentSec = getCurrentPlaybackTime();

    targetPeerConn.send({
        type: 'yt-state-resp',
        videoId: state.current.videoId,
        title: state.current.title,
        ownerId: state.current.ownerId,
        ownerName: state.current.ownerName,
        globalMode: state.current.globalMode,
        time: currentSec,
        isPlaying: state.current.isPlaying,
        sentAt: Date.now(),
    });
}

export function handleStateResponse(message) {
    if (!message?.videoId) return;

    const now = Date.now();
    const latency = message.sentAt ? (now - message.sentAt) / 1000 : 0;
    const startTime = (Number(message.time) || 0) + (message.isPlaying ? latency : 0);

    loadMedia({
        videoId: message.videoId,
        title: message.title,
        ownerId: message.ownerId,
        ownerName: message.ownerName,
        globalMode: message.globalMode,
        startTime,
        isPlaying: message.isPlaying,
    });

    uiModule?.toast(STR.ytResynced, 'ok');
}

export function requestStateFromPeers() {
    if (rtcModule?.broadcast) {
        rtcModule.broadcast({ type: 'yt-state-req' });
    }
}

/* --------------------------- استخراج رابط تدفق الصوت من CDN --------------------------- */

async function resolveAudioStreamUrl(videoId) {
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);

            // فحص وجود مسار الصوت itag 140
            const directUrl = `${instance}/latest_version?id=${videoId}&itag=140&local=true`;
            const testRes = await fetch(directUrl, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeout);

            if (testRes.ok || testRes.status === 206) {
                return directUrl;
            }
        } catch {}
    }

    return null;
}

/* --------------------------- مؤشر البحث وإرسال النشاط --------------------------- */

export function notifyTyping(query) {
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
        const cleaned = cleanSearchQuery(query);
        if (!cleaned || !rtcModule?.broadcast) return;

        rtcModule.broadcast({
            type: 'yt-activity',
            action: 'searching',
            user: rtcModule.state.myName,
        });
    }, 350);
}

/* --------------------------- البحث المباشر (Invidious API) --------------------------- */

export async function searchVideos(query) {
    const trimmed = cleanSearchQuery(query);
    if (!trimmed) return [];

    const directId = extractYouTubeId(trimmed);
    if (directId) {
        return [
            {
                videoId: directId,
                title: `${STR.ytTitle} (${directId})`,
                author: STR.appName,
                thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
                lengthSeconds: 0,
                durationFormatted: '0:00',
            },
        ];
    }

    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);

            const url = `${instance}/api/v1/search?q=${encodeURIComponent(trimmed)}&type=video`;
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) continue;
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) continue;

            return data.slice(0, 8).map((item) => ({
                videoId: item.videoId,
                title: item.title,
                author: item.author || '',
                thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                lengthSeconds: item.lengthSeconds || 0,
                durationFormatted: item.lengthSeconds ? formatDuration(item.lengthSeconds) : '0:00',
            }));
        } catch {}
    }

    for (const instance of PIPED_INSTANCES) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);

            const url = `${instance}/search?q=${encodeURIComponent(trimmed)}&filter=videos`;
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) continue;
            const data = await res.json();
            const items = data?.items;
            if (!Array.isArray(items) || items.length === 0) continue;

            return items
                .slice(0, 8)
                .map((item) => {
                    const vid = item.url ? item.url.replace('/watch?v=', '') : '';
                    return {
                        videoId: vid,
                        title: item.title,
                        author: item.uploaderName || '',
                        thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
                        lengthSeconds: item.duration || 0,
                        durationFormatted: item.duration ? formatDuration(item.duration) : '0:00',
                    };
                })
                .filter((x) => x.videoId);
        } catch {}
    }

    return [];
}

function formatDuration(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/* --------------------------- تحديث واجهات المستخدم (DOM) --------------------------- */

function renderMediaUI() {
    const stage = $('youtube-stage');
    const mini = $('mini-audio-bar');
    if (!stage || !mini || !state.current) return;

    const mode = effectiveMode();
    const title = state.current.title;
    const ownerName = state.current.ownerName;

    const ownerBadge = $('yt-owner-badge');
    const videoTitle = $('yt-video-title');
    const miniTitle = $('mini-audio-title');
    const miniOwner = $('mini-audio-owner');

    if (ownerBadge) ownerBadge.textContent = `بطلب من: ${ownerName}`;
    if (videoTitle) videoTitle.textContent = title;
    if (miniTitle) miniTitle.textContent = title;
    if (miniOwner) miniOwner.textContent = `بطلب من: ${ownerName}`;

    const modeLabel = $('yt-mode-label');
    const miniModeLabel = $('mini-audio-mode-label');

    if (mode === 'video') {
        stage.hidden = false;
        mini.hidden = true;
        if (modeLabel) modeLabel.textContent = STR.ytModeAudio;
        if (miniModeLabel) miniModeLabel.textContent = STR.ytModeVideo;
    } else {
        stage.hidden = true;
        mini.hidden = false;
        if (modeLabel) modeLabel.textContent = STR.ytModeAudio;
        if (miniModeLabel) miniModeLabel.textContent = STR.ytModeVideo;
    }

    updatePlayButtons(state.current.isPlaying);
}

function hideMediaUI() {
    const stage = $('youtube-stage');
    const mini = $('mini-audio-bar');
    if (stage) stage.hidden = true;
    if (mini) mini.hidden = true;
}

function updatePlayButtons(isPlaying) {
    const stageIcon = $('yt-play-icon');
    const miniIcon = $('mini-audio-play-icon');
    const targetHref = isPlaying ? '#i-pause' : '#i-play';

    if (stageIcon) stageIcon.setAttribute('href', targetHref);
    if (miniIcon) miniIcon.setAttribute('href', targetHref);
}

function updateTimeDisplays(current, duration) {
    const curFmt = formatDuration(current);
    const durFmt = formatDuration(duration);

    const c1 = $('yt-current-time');
    const d1 = $('yt-duration-time');
    const c2 = $('mini-audio-time');
    const d2 = $('mini-audio-duration');

    if (c1) c1.textContent = curFmt;
    if (d1) d1.textContent = durFmt;
    if (c2) c2.textContent = curFmt;
    if (d2) d2.textContent = durFmt;

    const pct = duration > 0 ? (current / duration) * 100 : 0;
    const s1 = $('yt-seek-bar');
    const s2 = $('mini-audio-seek');

    if (s1 && document.activeElement !== s1) s1.value = pct;
    if (s2 && document.activeElement !== s2) s2.value = pct;
}
