/* نقطة الدخول: ربط الأحداث بالوحدات */

import {
    DEFAULT_PEER_SERVER,
    STORAGE_KEYS,
    getEffectivePeerServer,
    getSavedServers,
    resetCustomServers,
    saveCustomServers,
} from './config.js';
import { cleanName } from './guard.js';
import { STR } from './strings.js';
import { $, generateRoomCode, readRoute, readStorage, writeStorage } from './utils.js';
import * as audio from './audio.js';
import * as rtc from './rtc.js';
import * as ui from './ui.js';

const joinForm = $('join-form');
const usernameInput = $('username-input');
const roomInput = $('room-input');
const randomRoomBtn = $('random-room-btn');
const testMicBtn = $('test-mic-btn');
const micBtn = $('toggle-mic-btn');
const leaveBtn = $('leave-room-btn');
const copyBtn = $('copy-link-btn');
const roomCodeBtn = $('room-code-btn');
const editNameBtn = $('edit-name-btn');
const renameForm = $('rename-form');
const renameInput = $('rename-input');
const renameCancelBtn = $('rename-cancel-btn');
const chatToggleButtons = [$('toggle-chat-header-btn'), $('toggle-chat-footer-btn')];
const closeChatBtn = $('close-chat-btn');
const joinRoomBtn = $('join-room-btn');

/* عناصر نافذة إعدادات الخوادم */
const openSettingsBtn = $('open-settings-btn');
const closeSettingsBtn = $('close-settings-btn');
const settingsModal = $('settings-modal');
const settingsForm = $('settings-form');
const resetSettingsBtn = $('reset-settings-btn');

const cfgPeerHost = $('cfg-peer-host');
const cfgPeerPort = $('cfg-peer-port');
const cfgPeerPath = $('cfg-peer-path');
const cfgPeerSecure = $('cfg-peer-secure');
const cfgTurnUrl = $('cfg-turn-url');
const cfgTurnUser = $('cfg-turn-user');
const cfgTurnPass = $('cfg-turn-pass');

async function handleJoin(event) {
    event.preventDefault();
    if (rtc.state.inRoom || rtc.state.joining) return;

    const typedName = usernameInput.value.trim();
    const name = cleanName(typedName);
    if (!name) {
        ui.toast(typedName ? STR.nameInvalid : STR.nameRequired, 'error');
        usernameInput.focus();
        return;
    }

    const room = roomInput.value.trim();
    if (!room) {
        ui.toast(STR.roomRequired, 'error');
        roomInput.focus();
        return;
    }

    writeStorage(STORAGE_KEYS.name, name);
    writeStorage(STORAGE_KEYS.room, room);

    if (joinRoomBtn) joinRoomBtn.disabled = true;

    audio.ensureAudioContext();
    try {
        await rtc.join(room, name);
    } finally {
        if (joinRoomBtn) joinRoomBtn.disabled = false;
    }
}

async function handleMicTest() {
    ui.setMicTestStatus(STR.micTesting);
    audio.ensureAudioContext();
    try {
        await audio.acquireMic();
        audio.setMicEnabled(true);
        audio.startVAD();
        ui.setMicTestStatus(STR.micTestReady);
    } catch {
        ui.setMicTestStatus(STR.micTestFail);
        ui.toast(STR.micTestFail, 'error');
    }
}

function handleChatToggle() {
    ui.toggleChat();
    if (ui.isChatVisible()) ui.focusChatInput();
}

function openRename() {
    if (!rtc.state.inRoom) return;
    renameInput.value = rtc.state.myName;
    renameForm.hidden = false;
    renameInput.focus();
    renameInput.select();
}

function closeRename() {
    renameForm.hidden = true;
}

function handleRename(event) {
    event.preventDefault();
    const typed = renameInput.value.trim();
    const name = cleanName(typed);
    if (!name) {
        ui.toast(typed ? STR.nameInvalid : STR.nameRequired, 'error');
        renameInput.focus();
        return;
    }

    if (!rtc.rename(name)) return;
    writeStorage(STORAGE_KEYS.name, name);
    closeRename();
    ui.toast(STR.nameUpdated, 'ok');
}

/* ------------------------- نافذة إعدادات الخوادم ------------------------- */

function openSettings() {
    const saved = getSavedServers();
    const effectivePeer = getEffectivePeerServer();

    cfgPeerHost.value = saved?.peerServer?.host || effectivePeer.host || '';
    cfgPeerPort.value = saved?.peerServer?.port || effectivePeer.port || 443;
    cfgPeerPath.value = saved?.peerServer?.path || effectivePeer.path || '/';
    cfgPeerSecure.checked = saved?.peerServer ? saved.peerServer.secure !== false : effectivePeer.secure !== false;

    if (saved?.turnServer?.url) {
        cfgTurnUrl.value = saved.turnServer.url || '';
        cfgTurnUser.value = saved.turnServer.username || '';
        cfgTurnPass.value = saved.turnServer.credential || '';
    } else {
        cfgTurnUrl.value = '';
        cfgTurnUser.value = '';
        cfgTurnPass.value = '';
    }

    settingsModal.hidden = false;
    cfgPeerHost.focus();
}

function closeSettings() {
    settingsModal.hidden = true;
}

function handleSaveSettings(event) {
    event.preventDefault();
    const host = cfgPeerHost.value.trim();
    if (!host) {
        ui.toast(STR.settingsInvalid, 'error');
        cfgPeerHost.focus();
        return;
    }

    const port = Number(cfgPeerPort.value) || 443;
    const path = cfgPeerPath.value.trim() || '/';
    const secure = cfgPeerSecure.checked;

    const turnUrl = cfgTurnUrl.value.trim();
    const turnUser = cfgTurnUser.value.trim();
    const turnPass = cfgTurnPass.value.trim();

    const config = {
        peerServer: { host, port, path, secure },
    };

    if (turnUrl) {
        config.turnServer = {
            url: turnUrl,
            username: turnUser,
            credential: turnPass,
        };
    }

    saveCustomServers(config);
    closeSettings();
    ui.toast(STR.settingsSaved, 'ok');
}

function handleResetSettings() {
    resetCustomServers();
    const defPeer = DEFAULT_PEER_SERVER;
    cfgPeerHost.value = defPeer.host;
    cfgPeerPort.value = defPeer.port;
    cfgPeerPath.value = defPeer.path;
    cfgPeerSecure.checked = defPeer.secure;
    cfgTurnUrl.value = '';
    cfgTurnUser.value = '';
    cfgTurnPass.value = '';
    closeSettings();
    ui.toast(STR.settingsReset, 'ok');
}

function init() {
    rtc.wireAudioHandlers();

    joinForm.addEventListener('submit', handleJoin);
    randomRoomBtn.addEventListener('click', () => {
        roomInput.value = generateRoomCode();
        roomInput.focus();
    });
    testMicBtn.addEventListener('click', handleMicTest);

    micBtn.addEventListener('click', rtc.toggleMute);
    leaveBtn.addEventListener('click', rtc.leave);
    copyBtn.addEventListener('click', rtc.shareLink);
    roomCodeBtn.addEventListener('click', rtc.shareLink);
    editNameBtn.addEventListener('click', () => (renameForm.hidden ? openRename() : closeRename()));
    renameForm.addEventListener('submit', handleRename);
    renameCancelBtn.addEventListener('click', closeRename);
    renameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeRename();
        }
    });

    ui.onChatSubmit(rtc.sendChat);
    for (const button of chatToggleButtons) button.addEventListener('click', handleChatToggle);
    closeChatBtn.addEventListener('click', () => ui.setChatOpen(false));

    openSettingsBtn?.addEventListener('click', openSettings);
    closeSettingsBtn?.addEventListener('click', closeSettings);
    settingsForm?.addEventListener('submit', handleSaveSettings);
    resetSettingsBtn?.addEventListener('click', handleResetSettings);
    settingsModal?.addEventListener('click', (event) => {
        if (event.target === settingsModal) closeSettings();
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && settingsModal && !settingsModal.hidden) {
            closeSettings();
        }
    });

    document.addEventListener('pointerdown', () => audio.ensureAudioContext(), { passive: true });
    window.addEventListener('beforeunload', () => rtc.leave());
    window.addEventListener('pagehide', () => rtc.leave());

    const savedName = cleanName(readStorage(STORAGE_KEYS.name));
    if (savedName) usernameInput.value = savedName;

    const params = new URLSearchParams(location.search);
    const route = readRoute();
    const roomFromLink = params.get('room') ?? params.get('r') ?? route.room;

    if (roomFromLink) roomInput.value = roomFromLink.slice(0, 25);

    /* الاسم لا يُقرأ من الرابط أبداً: من التخزين المحلي فقط أو إدخال أول مرة */
    if (savedName) roomInput.focus();
    else usernameInput.focus();

    ui.showLobby();
    ui.updateMicButton(false);
    ui.resetChat();
    ui.resetMicMeter();
    ui.updatePeersCount(1);
}

init();
