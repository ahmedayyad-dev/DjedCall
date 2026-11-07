/* محرّك الاتصال: PeerJS + شبكة متكاملة + بوابة اكتشاف قابلة للتبديل */

import {
    CHAT_HISTORY_MAX,
    CHAT_RATE_MAX,
    CHAT_RATE_WINDOW,
    DATA_CONNECT_TIMEOUT,
    LOCAL_SEND_GAP,
    MAX_PEERS,
    PEER_OPEN_TIMEOUT,
    PEER_PREFIX,
    RAW_NAME_MAX,
    RAW_TEXT_MAX,
    RELAY_CLAIM_JITTER,
    RELAY_CLAIM_MIN,
    RELAY_LIST_TIMEOUT,
    RELAY_MAX_MEMBERS,
    ROOM_PREFIX,
    getEffectivePeerOptions,
} from './config.js';
import { STR } from './strings.js';
import { cleanMessage, cleanName, cleanRoomLabel, hasLink, validPeerId } from './guard.js';
import { randomId, safeSend, safeTimestamp, sanitizeRoom, writeRoute } from './utils.js';
import { describeConnection } from './net.js';
import * as audio from './audio.js';
import * as ui from './ui.js';

export const state = {
    peer: null,
    relayPeer: null,
    relayConn: null,
    relayMembers: new Map(),
    isRelay: false,
    claiming: false,

    roomKey: '',
    roomLabel: '',
    myId: '',
    myName: '',
    inRoom: false,
    joining: false,
    muted: false,

    peers: new Map(),
    chatHistory: [],
    historyLoaded: false,
    lastSendAt: 0,
    localNotified: false,
};

/* كل معرّفات المشاركين يجب أن تنتمي لنفس الغرفة */
function peerInRoom(peerId) {
    return validPeerId(peerId) && peerId.startsWith(`${PEER_PREFIX}${state.roomKey}-`);
}

/* --------------------------- إنشاء الند --------------------------- */

function createPeer(id) {
    return new Promise((resolve, reject) => {
        let peer;
        try {
            peer = new Peer(id, getEffectivePeerOptions());
        } catch (error) {
            reject(error);
            return;
        }

        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            peer.off('open', handleOpen);
            peer.off('error', handleError);
            callback(value);
        };

        const handleOpen = () => finish(resolve, peer);
        const handleError = (error) => {
            finish(reject, error ?? { type: 'unknown' });
            try {
                peer.destroy();
            } catch {
                /* تم إغلاقه بالفعل */
            }
        };

        const timer = setTimeout(() => {
            finish(reject, { type: 'timeout' });
            try {
                peer.destroy();
            } catch {
                /* تم إغلاقه بالفعل */
            }
        }, PEER_OPEN_TIMEOUT);

        peer.on('open', handleOpen);
        peer.on('error', handleError);
    });
}

/* --------------------------- الدخول والخروج --------------------------- */

const micErrorMessage = (error) => {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return STR.micDenied;
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return STR.micMissing;
    return STR.micError;
};

const connections = () => [...state.peers.values()].map((entry) => entry.pc).filter(Boolean);

export async function join(roomRaw, name) {
    if (state.inRoom || state.joining) return;
    state.joining = true;

    try {
        const roomKey = sanitizeRoom(roomRaw);
        if (!roomKey) {
            ui.toast(STR.roomInvalid, 'error');
            return;
        }

        try {
            await audio.acquireMic();
        } catch (error) {
            ui.toast(micErrorMessage(error), 'error');
            return;
        }

        Object.assign(state, {
            roomKey,
            roomLabel: cleanRoomLabel(roomRaw) || roomKey,
            myName: cleanName(name) || STR.defaultName,
            muted: false,
            inRoom: true,
            chatHistory: [],
            historyLoaded: false,
            lastSendAt: 0,
            localNotified: false,
        });
        state.relayMembers.clear();

        ui.showRoom();
        ui.setRoomHeader(state.roomLabel, state.myName);
        writeRoute(state.roomLabel);
        ui.resetChat();
        ui.renderLocalCard(state.myName);
        ui.updateMicButton(false);
        ui.updatePeersCount(1);
        ui.setBitrateText(STR.bitrateIdle);

        audio.setMicEnabled(true);
        audio.startVAD();
        audio.startBitrateStats(connections, onBitrate);

        try {
            state.peer = await createPeer(`${PEER_PREFIX}${roomKey}-${randomId(8)}`);
        } catch {
            ui.toast(STR.connectFailed, 'error');
            teardown();
            ui.showLobby();
            return;
        }

        state.myId = state.peer.id;
        state.peer.on('connection', onIncomingData);
        state.peer.on('call', onIncomingCall);
        state.peer.on('disconnected', () => {
            if (!state.inRoom) return;
            try {
                state.peer.reconnect();
            } catch {
                /* إعادة الاتصال غير متاحة */
            }
        });
        state.peer.on('error', onPeerError);

        await joinDiscovery();
        startHeartbeat();
    } finally {
        state.joining = false;
    }
}

function onBitrate(kbps) {
    ui.setBitrateText(kbps <= 0 ? STR.bitrateSilent : STR.bitrate(kbps));
}

function onPeerError(error) {
    if (error?.type === 'browser-incompatible') ui.toast(STR.browserUnsupported, 'error');
}

export function leave() {
    if (!state.inRoom) return;

    stopHeartbeat();
    broadcast({ type: 'bye', id: state.myId });

    if (state.relayConn) {
        safeSend(state.relayConn, { type: 'bye', id: state.myId });
    }

    if (state.isRelay) {
        for (const member of state.relayMembers.values()) {
            safeSend(member.conn, { type: 'peer-left', id: state.myId });
        }
    }

    ui.showLobby();
    ui.toast(STR.leftRoom);

    /* نمهل المتصفح فترة وجيزة لتفريغ رسالة الوداع عبر الشبكة قبل هدم المقابس */
    setTimeout(() => {
        teardown();
    }, 150);
}

export function teardown() {
    state.inRoom = false;

    stopHeartbeat();
    audio.stopBitrateStats();
    audio.stopVAD();
    for (const peerId of [...state.peers.keys()]) dropPeer(peerId, { silent: true });
    state.peers.clear();

    closeRelayConn();
    state.relayMembers.clear();

    try {
        state.peer?.destroy();
    } catch {
        /* أُغلق مسبقاً */
    }
    try {
        state.relayPeer?.destroy();
    } catch {
        /* أُغلق مسبقاً */
    }

    state.peer = null;
    state.relayPeer = null;
    state.isRelay = false;
    state.claiming = false;
    state.myId = '';

    writeRoute('');

    audio.releaseMic();
    ui.resetMicMeter();
    ui.resetParticipants();
    ui.resetChat();
    ui.updatePeersCount(1);
    ui.setBitrateText(STR.bitrateIdle);
    ui.setChatOpen(false);
}

/* --------------------------- بوابة الاكتشاف --------------------------- */

async function joinDiscovery() {
    try {
        const relay = await createPeer(ROOM_PREFIX + state.roomKey);
        state.relayPeer = relay;
        state.isRelay = true;
        relay.on('connection', onRelayConnection);
        relay.on('error', () => {});
        ui.addSystemMessage(STR.firstInRoom);
        ui.toast(STR.firstInRoom, 'join');
    } catch (error) {
        if (error?.type === 'unavailable-id') {
            state.isRelay = false;
            connectToRelay();
            return;
        }
        if (!state.inRoom) return;
        ui.addSystemMessage(STR.retrying);
        setTimeout(() => {
            if (state.inRoom) joinDiscovery();
        }, 2000);
    }
}

function closeRelayConn() {
    if (!state.relayConn) return;
    try {
        state.relayConn.close();
    } catch {
        /* أُغلق مسبقاً */
    }
    state.relayConn = null;
}

function connectToRelay() {
    if (!state.inRoom || !state.peer) return;
    closeRelayConn();

    let conn;
    try {
        conn = state.peer.connect(ROOM_PREFIX + state.roomKey, { reliable: true });
    } catch {
        scheduleRelayClaim();
        return;
    }
    if (!conn) {
        scheduleRelayClaim();
        return;
    }
    state.relayConn = conn;

    let received = false;
    const failsafe = setTimeout(() => {
        if (received) return;
        try {
            conn.close();
        } catch {
            /* أُغلق مسبقاً */
        }
        scheduleRelayClaim();
    }, RELAY_LIST_TIMEOUT);

    conn.on('open', () => safeSend(conn, { type: 'hello', name: state.myName }));
    conn.on('data', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'peer-list') {
            received = true;
            clearTimeout(failsafe);
            state.isRelay = false;
            applyPeerList(message.peers);
            applyHistory(message.history);
        } else if (message.type === 'peer-joined') {
            const rawName = typeof message.name === 'string' && message.name.length <= RAW_NAME_MAX ? message.name : '';
            ui.toast(STR.peerJoined(cleanName(rawName) || STR.defaultName), 'join');
        } else if (message.type === 'peer-left') {
            if (typeof message.id === 'string' && peerInRoom(message.id)) dropPeer(message.id);
        }
    });
    conn.on('close', () => {
        clearTimeout(failsafe);
        if (state.relayConn === conn) state.relayConn = null;
        if (state.inRoom) scheduleRelayClaim();
    });
    conn.on('error', () => {});
}

function applyHistory(messages) {
    if (state.historyLoaded || !Array.isArray(messages)) return;
    state.historyLoaded = true;
    for (const message of messages.slice(-40)) {
        if (!message || typeof message !== 'object') continue;
        if (typeof message.text !== 'string' || message.text.length > RAW_TEXT_MAX) continue;
        const text = cleanMessage(message.text);
        if (!text || hasLink(text)) continue;
        const rawFrom = typeof message.from === 'string' && message.from.length <= RAW_NAME_MAX ? message.from : '';
        const from = cleanName(rawFrom) || STR.defaultName;
        const at = safeTimestamp(message.at);
        ui.addChatMessage({ from, text, at, mine: false, silent: true });
    }
}

function applyPeerList(peers) {
    if (!Array.isArray(peers)) return;
    for (const peer of peers.slice(0, MAX_PEERS + 1)) {
        if (!peer || typeof peer !== 'object') continue;
        if (!peerInRoom(peer.id) || peer.id === state.myId) continue;
        const rawName = typeof peer.name === 'string' && peer.name.length <= RAW_NAME_MAX ? peer.name : '';
        connectToPeer(peer.id, cleanName(rawName));
    }
}

function scheduleRelayClaim() {
    if (state.claiming || !state.inRoom || state.relayPeer) return;
    state.claiming = true;
    const delay = RELAY_CLAIM_MIN + Math.random() * RELAY_CLAIM_JITTER;

    setTimeout(async () => {
        state.claiming = false;
        if (!state.inRoom || state.relayPeer) return;
        try {
            const relay = await createPeer(ROOM_PREFIX + state.roomKey);
            state.relayPeer = relay;
            state.isRelay = true;
            relay.on('connection', onRelayConnection);
            relay.on('error', () => {});
            ui.addSystemMessage(STR.relayActivated);
        } catch (error) {
            if (error?.type === 'unavailable-id') connectToRelay();
            else if (state.inRoom) scheduleRelayClaim();
        }
    }, delay);
}

function roster() {
    const list = [{ id: state.myId, name: state.myName }];
    for (const peer of state.peers.values()) list.push({ id: peer.id, name: peer.name });
    const seen = new Set();
    return list
        .filter((item) => item.id && !seen.has(item.id) && seen.add(item.id))
        .slice(0, MAX_PEERS + 1);
}

function onRelayConnection(conn) {
    if (!peerInRoom(conn.peer) || state.relayMembers.size >= RELAY_MAX_MEMBERS) {
        try {
            conn.close();
        } catch {
            /* أُغلق مسبقاً */
        }
        return;
    }

    conn.on('data', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'bye') {
            state.relayMembers.delete(conn.peer);
            dropPeer(conn.peer);
            for (const member of state.relayMembers.values()) {
                safeSend(member.conn, { type: 'peer-left', id: conn.peer });
            }
            return;
        }
        if (message.type !== 'hello') return;
        if (typeof message.name === 'string' && message.name.length > RAW_NAME_MAX) return;
        const name = cleanName(message.name) || STR.defaultName;
        const isExisting = state.relayMembers.has(conn.peer);
        state.relayMembers.set(conn.peer, { name, conn });
        if (isExisting) return;

        safeSend(conn, {
            type: 'peer-list',
            peers: roster(),
            history: state.chatHistory.slice(-40),
        });

        for (const [memberId, member] of state.relayMembers) {
            if (memberId === conn.peer) continue;
            safeSend(member.conn, { type: 'peer-joined', id: conn.peer, name });
        }

        ui.toast(STR.peerJoined(name), 'join');
        audio.chime('join');
    });

    conn.on('close', () => {
        state.relayMembers.delete(conn.peer);
        for (const member of state.relayMembers.values()) {
            safeSend(member.conn, { type: 'peer-left', id: conn.peer });
        }
    });
    conn.on('error', (err) => console.warn('Relay conn error:', err));
}

/* --------------------------- الشبكة المتكاملة --------------------------- */

function ensurePeer(peerId, name) {
    if (!peerInRoom(peerId)) return null;

    let entry = state.peers.get(peerId);
    if (!entry) {
        if (state.peers.size >= MAX_PEERS) return null;
        entry = {
            id: peerId,
            name: cleanName(name) || STR.defaultName,
            dataConn: null,
            mediaConn: null,
            pc: null,
            audioEl: null,
            muted: false,
            msgTimes: [],
            route: '',
            lastSeen: 0,
        };
        state.peers.set(peerId, entry);
        ui.addPeerCard(peerId, entry.name);
        ui.updatePeersCount(state.peers.size + 1);
    } else {
        const safeName = cleanName(name);
        if (safeName && entry.name !== safeName) {
            entry.name = safeName;
            ui.updatePeerCard(entry);
        }
    }
    return entry;
}

function connectToPeer(peerId, name) {
    if (!peerId || peerId === state.myId || !state.peer || !peerInRoom(peerId)) return;

    const existing = state.peers.get(peerId);
    if (existing) {
        if (existing.dataConn?.open) {
            if (!existing.mediaConn) startMediaCall(peerId);
            return;
        }
        if (existing.dataConn) return;
    }

    const entry = ensurePeer(peerId, name);
    if (!entry) return;

    let conn;
    try {
        conn = state.peer.connect(peerId, {
            reliable: true,
            metadata: { name: state.myName },
        });
    } catch {
        dropPeer(peerId, { silent: true });
        return;
    }
    if (!conn) return;

    entry.dataConn = conn;

    const guard = setTimeout(() => {
        const current = state.peers.get(peerId);
        if (current && !current.dataConn?.open) dropPeer(peerId, { silent: true });
    }, DATA_CONNECT_TIMEOUT);

    conn.on('open', () => {
        clearTimeout(guard);
        entry.lastSeen = Date.now();
        safeSend(conn, { type: 'hello', name: state.myName });
        if (!state.peers.get(peerId)?.mediaConn) startMediaCall(peerId);
    });
    conn.on('data', (message) => handleData(peerId, message));
    conn.on('close', () => {
        clearTimeout(guard);
        const current = state.peers.get(peerId);
        if (current?.dataConn === conn) dropPeer(peerId);
    });
    conn.on('error', (err) => {
        clearTimeout(guard);
        console.warn('Peer conn error:', err);
    });
}

function onIncomingData(conn) {
    if (!validPeerId(conn.peer)) {
        try {
            conn.close();
        } catch {
            /* أُغلق مسبقاً */
        }
        return;
    }

    const entry = ensurePeer(conn.peer, conn.metadata?.name);
    if (!entry) {
        try {
            conn.close();
        } catch {
            /* أُغلق مسبقاً */
        }
        return;
    }
    if (entry.dataConn && entry.dataConn !== conn) {
        try {
            entry.dataConn.close();
        } catch {
            /* أُغلق مسبقاً */
        }
    }
    entry.dataConn = conn;
    entry.lastSeen = Date.now();

    conn.on('data', (message) => handleData(conn.peer, message));
    conn.on('close', () => {
        const current = state.peers.get(conn.peer);
        if (current?.dataConn === conn) dropPeer(conn.peer);
    });
    conn.on('error', (err) => console.warn('Incoming data conn error:', err));
}

function onIncomingCall(call) {
    if (!validPeerId(call.peer)) {
        try {
            call.close();
        } catch {
            /* أُغلق مسبقاً */
        }
        return;
    }

    const entry = ensurePeer(call.peer, call.metadata?.name);
    if (!entry) {
        try {
            call.close();
        } catch {
            /* أُغلق مسبقاً */
        }
        return;
    }

    if (entry.mediaConn && entry.mediaConn !== call) {
        try {
            entry.mediaConn.close();
        } catch {
            /* أُغلق مسبقاً */
        }
    }
    entry.mediaConn = call;

    audio.ensureAudioContext();

    try {
        call.answer(audio.currentMic(), { sdpTransform: audio.tuneSdp });
    } catch {
        /* تعذر الرد */
    }

    call.on('stream', (remote) => attachRemote(call.peer, remote));
    call.on('close', () => detachRemote(call.peer));
    call.on('error', (err) => console.warn('Call error:', err));

    audio.waitForPeerConnection(call).then((pc) => {
        if (!pc) return;
        entry.pc = pc;
        audio.applyLowBitrate(pc);
        trackRoute(call.peer, pc);
        watchPeerConnection(call.peer, pc);
    });
}

function startMediaCall(peerId) {
    const entry = state.peers.get(peerId);
    if (!entry || entry.mediaConn || !state.peer) return;
    const stream = audio.currentMic();
    if (!stream) return;

    audio.ensureAudioContext();

    let call;
    try {
        call = state.peer.call(peerId, stream, {
            metadata: { name: state.myName },
            sdpTransform: audio.tuneSdp,
        });
    } catch {
        return;
    }
    if (!call) return;

    entry.mediaConn = call;
    call.on('stream', (remote) => attachRemote(peerId, remote));
    call.on('close', () => {
        const current = state.peers.get(peerId);
        if (current) {
            current.mediaConn = null;
            current.pc = null;
        }
        detachRemote(peerId);
    });
    call.on('error', (err) => console.warn('Call error:', err));

    audio.waitForPeerConnection(call).then((pc) => {
        if (!pc) return;
        entry.pc = pc;
        audio.applyLowBitrate(pc);
        trackRoute(peerId, pc);
        watchPeerConnection(peerId, pc);
    });
}

/* مراقبة حالة اتصال WebRTC وإسقاط المشارك فور فقدانه أو انقطاعه */
function watchPeerConnection(peerId, pc) {
    if (!pc || typeof pc.addEventListener !== 'function') return;

    let disconnectTimer = null;

    const onStateChange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            clearTimeout(disconnectTimer);
            dropPeer(peerId);
        }
    };

    const onIceChange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            clearTimeout(disconnectTimer);
            dropPeer(peerId);
        } else if (pc.iceConnectionState === 'disconnected') {
            clearTimeout(disconnectTimer);
            disconnectTimer = setTimeout(() => {
                const current = state.peers.get(peerId);
                if (
                    current &&
                    (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')
                ) {
                    dropPeer(peerId);
                }
            }, 15000);
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            clearTimeout(disconnectTimer);
        }
    };

    pc.addEventListener('connectionstatechange', onStateChange);
    pc.addEventListener('iceconnectionstatechange', onIceChange);
}

/* يكشف مسار الوسائط الفعلي بعد نجاح ICE ويظهره على بطاقة المشارك */
function trackRoute(peerId, pc) {
    let attempts = 0;

    const check = async () => {
        const entry = state.peers.get(peerId);
        if (!entry || entry.pc !== pc) return;

        const route = await describeConnection(pc);
        if (route === 'unknown') {
            attempts += 1;
            if (attempts < 4) setTimeout(check, 1500);
            return;
        }

        if (entry.route === route) return;
        entry.route = route;
        ui.setPeerRoute(peerId, route);

        if (route === 'local' && !state.localNotified) {
            state.localNotified = true;
            ui.toast(STR.peerLocal(entry.name), 'ok');
        }
    };

    setTimeout(check, 800);
}

function attachRemote(peerId, stream) {
    const entry = ensurePeer(peerId);
    if (!entry) return;
    if (entry.audioEl) {
        entry.audioEl.pause();
        entry.audioEl.remove();
    }

    audio.ensureAudioContext();

    const element = document.createElement('audio');
    element.autoplay = true;
    element.playsInline = true;
    element.srcObject = stream;
    ui.audioContainer().append(element);
    entry.audioEl = element;

    const tryPlay = () => {
        element.play().catch(() => {
            const unlock = () => {
                element.play().catch(() => {});
            };
            document.addEventListener('pointerdown', unlock, { once: true });
            document.addEventListener('touchstart', unlock, { once: true });
        });
    };
    tryPlay();

    audio.attachVAD(peerId, stream);
    audio.startVAD();
    audio.chime('join');
}

function detachRemote(peerId) {
    const entry = state.peers.get(peerId);
    if (!entry) return;
    if (entry.audioEl) {
        entry.audioEl.pause();
        entry.audioEl.srcObject = null;
        entry.audioEl.remove();
        entry.audioEl = null;
    }
    entry.mediaConn = null;
    entry.pc = null;
    audio.detachVAD(peerId);
}

function dropPeer(peerId, { silent = false } = {}) {
    const entry = state.peers.get(peerId);
    if (!entry) return;

    if (state.isRelay && state.relayMembers.has(peerId)) {
        state.relayMembers.delete(peerId);
        for (const member of state.relayMembers.values()) {
            safeSend(member.conn, { type: 'peer-left', id: peerId });
        }
    }

    try {
        entry.dataConn?.close();
    } catch {
        /* أُغلق مسبقاً */
    }
    try {
        entry.mediaConn?.close();
    } catch {
        /* أُغلق مسبقاً */
    }

    if (entry.audioEl) {
        entry.audioEl.pause();
        entry.audioEl.srcObject = null;
        entry.audioEl.remove();
        entry.audioEl = null;
    }

    audio.detachVAD(peerId);
    state.peers.delete(peerId);
    ui.removePeerCard(peerId);
    ui.updatePeersCount(state.peers.size + 1);

    if (silent) return;
    ui.toast(STR.peerLeft(entry.name), 'leave');
    audio.chime('leave');
}

/* --------------------------- الرسائل والنبض الدوري --------------------------- */

let heartbeatTimer = null;

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (!state.inRoom) {
            stopHeartbeat();
            return;
        }
        const now = Date.now();
        for (const [peerId, entry] of state.peers) {
            if (entry.dataConn?.open) {
                safeSend(entry.dataConn, { type: 'ping' });
                if (entry.lastSeen && now - entry.lastSeen > 20000) {
                    dropPeer(peerId);
                }
            }
        }
    }, 3000);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function pushHistory(item) {
    state.chatHistory.push(item);
    if (state.chatHistory.length > CHAT_HISTORY_MAX) state.chatHistory.shift();
}

function handleData(peerId, message) {
    try {
        if (!message || typeof message !== 'object') return;
        const entry = state.peers.get(peerId);
        if (!entry) return;

        entry.lastSeen = Date.now();

        if (message.type === 'ping') {
            safeSend(entry.dataConn, { type: 'pong' });
            return;
        }

        if (message.type === 'pong') {
            return;
        }

        if (message.type === 'hello') {
            if (typeof message.name !== 'string' || message.name.length > RAW_NAME_MAX) return;
            const name = cleanName(message.name);
            if (name && entry.name !== name) {
                entry.name = name;
                ui.updatePeerCard(entry);
            }
            return;
        }

        if (message.type === 'chat') {
            if (!allowIncomingChat(entry)) return;
            if (typeof message.text !== 'string' || message.text.length > RAW_TEXT_MAX) return;
            const text = cleanMessage(message.text);
            if (!text || hasLink(text)) return;
            const rawFrom = typeof message.from === 'string' && message.from.length <= RAW_NAME_MAX ? message.from : '';
            const from = cleanName(rawFrom) || entry.name;
            const at = safeTimestamp(message.at);
            pushHistory({ from, text, at });
            ui.addChatMessage({ from, text, at, mine: false });
            return;
        }

        if (message.type === 'bye') {
            dropPeer(peerId);
            return;
        }

        if (message.type === 'state') {
            const now = Date.now();
            if (entry.lastStateAt && now - entry.lastStateAt < 200) return;
            entry.lastStateAt = now;
            if (typeof message.muted === 'boolean') entry.muted = message.muted;
            ui.updatePeerCard(entry);
        }
    } catch {
        /* رسالة مشوّهة — تجاهل بهدوء */
    }
}

function allowIncomingChat(entry) {
    const now = Date.now();
    entry.msgTimes = (entry.msgTimes ?? []).filter((time) => now - time < CHAT_RATE_WINDOW);
    if (entry.msgTimes.length >= CHAT_RATE_MAX) return false;
    entry.msgTimes.push(now);
    return true;
}

function broadcast(payload) {
    for (const entry of state.peers.values()) safeSend(entry.dataConn, payload);
}

export function sendChat(text) {
    if (!state.inRoom) return;

    const trimmed = cleanMessage(text);
    if (!trimmed) return;

    if (hasLink(trimmed)) {
        ui.toast(STR.msgBlocked, 'error');
        return;
    }

    const now = Date.now();
    if (now - state.lastSendAt < LOCAL_SEND_GAP) {
        ui.toast(STR.msgRate, 'error');
        return;
    }
    state.lastSendAt = now;

    const at = now;
    ui.addChatMessage({ from: state.myName, text: trimmed, at, mine: true });
    pushHistory({ from: state.myName, text: trimmed, at });
    broadcast({ type: 'chat', from: state.myName, text: trimmed, at });
}

/* --------------------------- التحكم --------------------------- */

export function rename(nextName) {
    if (!state.inRoom) return false;

    const name = cleanName(nextName);
    if (!name) return false;
    if (name === state.myName) return true;

    state.myName = name;
    ui.setMyName(name);
    broadcast({ type: 'hello', name });
    safeSend(state.relayConn, { type: 'hello', name });
    return true;
}

export function toggleMute() {
    if (!state.inRoom) return;
    state.muted = !state.muted;
    audio.setMicEnabled(!state.muted);
    ui.updateMicButton(state.muted);
    ui.setLocalMuted(state.muted);
    broadcast({ type: 'state', muted: state.muted, name: state.myName });
    ui.toast(state.muted ? STR.micMutedToast : STR.micEnabledToast, 'ok');
}

function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.insetBlockStart = '-1000px';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    }
    area.remove();
    return copied;
}

export async function shareLink() {
    if (!state.inRoom) return;
    const url = `${location.origin}/${encodeURIComponent(state.roomLabel)}`;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            ui.toast(STR.copyOk, 'ok');
            return;
        }
    } catch {
        /* المتصفح رفض الحافظة — جرّب الطريقة اليدوية */
    }

    if (legacyCopy(url)) {
        ui.toast(STR.copyOk, 'ok');
        return;
    }

    if (navigator.share) {
        try {
            await navigator.share({ title: STR.shareTitle, text: STR.shareText, url });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }

    window.prompt(STR.copyPrompt, url);
    ui.toast(STR.copyFail, 'error');
}

export function wireAudioHandlers() {
    audio.setSpeakingHandler((id, speaking) => {
        if (id === 'local' && state.muted) return;
        ui.setSpeaking(id, speaking);
    });
    audio.setLevelHandler(ui.updateMicMeter);
}
