/* طبقة الواجهة: بناء الـ DOM وتحديثه فقط */

import { VAD } from './config.js';
import { cleanMessage, cleanName, hasLink } from './guard.js';
import { STR } from './strings.js';
import {
    $,
    avatarLetter,
    escapeHtml,
    formatTime,
    gradIndex,
    iconMarkup,
    isDesktopChat,
    safeTimestamp,
    setIcon,
} from './utils.js';

const refs = {
    lobby: $('lobby-view'),
    room: $('room-view'),
    roomName: $('active-room-name'),
    stageRoomCode: $('stage-room-code'),
    stageMyName: $('stage-my-name'),
    peersCount: $('peers-count-badge'),
    grid: $('participants-grid'),
    audio: $('audio-container'),

    chat: $('chat-sidebar'),
    chatLog: $('chat-messages'),
    chatForm: $('chat-form'),
    chatInput: $('chat-input'),
    unreadBadge: $('unread-chat-badge'),
    footerUnread: $('footer-chat-badge'),

    micBtn: $('toggle-mic-btn'),
    micIcon: $('mic-icon'),
    micLabel: $('mic-label'),
    bitrateText: $('bitrate-text'),

    meAvatar: $('footer-user-avatar'),
    meName: $('footer-username'),
    footerStatus: $('footer-status'),

    meterBar: $('mic-test-bar'),
    meterStatus: $('mic-test-status'),
    toasts: $('toast-container'),

    ytModal: $('youtube-modal'),
    ytSearchInput: $('yt-search-input'),
    ytResultsContainer: $('yt-results-container'),
    ytResultsItems: $('yt-results-items'),
    ytResultsSpinner: $('yt-results-spinner'),
    ytIndicator: $('yt-searching-indicator'),
};

const cards = new Map();
let localCard = null;
let unread = 0;

/* عنوان الردهة مصدره index.html — لا يُكرَّر كنص في الجافاسكربت */
const LOBBY_TITLE = document.title;

/* --------------------------- التنقل --------------------------- */

export function showLobby() {
    refs.room.hidden = true;
    refs.lobby.hidden = false;
    document.title = LOBBY_TITLE;
}

export function showRoom() {
    refs.lobby.hidden = true;
    refs.room.hidden = false;
}

export function setMyName(myName) {
    const safeName = cleanName(myName) || STR.defaultName;
    refs.stageMyName.textContent = safeName;
    refs.meName.textContent = safeName;
    refs.meAvatar.textContent = avatarLetter(safeName);
    if (localCard) {
        localCard.querySelector('.p-name').textContent = safeName;
        localCard.querySelector('.p-avatar').textContent = avatarLetter(safeName);
    }
}

export function setRoomHeader(roomName, myName) {
    refs.roomName.textContent = roomName;
    refs.stageRoomCode.textContent = roomName;
    setMyName(myName);
    document.title = `${STR.appName} ▪ ${roomName}`;
}

export const audioContainer = () => refs.audio;

/* --------------------------- الإشعارات --------------------------- */

const TOAST_ICONS = {
    info: 'info',
    error: 'alert',
    join: 'user-plus',
    leave: 'user-minus',
    ok: 'check',
    chat: 'message-square',
};

export function toast(text, kind = 'info') {
    const element = document.createElement('div');
    element.className = 'toast';
    element.dataset.kind = kind;
    element.innerHTML = `${iconMarkup(TOAST_ICONS[kind] ?? 'info')}<span>${escapeHtml(text)}</span>`;
    refs.toasts.append(element);

    setTimeout(() => {
        element.classList.add('is-out');
        setTimeout(() => element.remove(), 320);
    }, 3600);
}

/* --------------------------- مؤشر المايك --------------------------- */

export function setMicTestStatus(text) {
    refs.meterStatus.textContent = text;
}

export function updateMicMeter(rms) {
    const percent = Math.min(100, Math.round(Math.sqrt(rms) * VAD.meterScale));
    refs.meterBar.style.width = `${percent}%`;
}

export function resetMicMeter() {
    refs.meterBar.style.width = '0%';
    setMicTestStatus(STR.micTestIdle);
}

export function updateMicButton(muted) {
    refs.micBtn.classList.toggle('is-muted', muted);
    setIcon(refs.micIcon, muted ? 'mic-off' : 'mic');
    refs.micLabel.textContent = muted ? STR.micMuted : STR.micReady;
}

/* --------------------------- المشاركون --------------------------- */

function cardMarkup(id, name, subtitle) {
    const safeName = cleanName(name) || STR.defaultName;
    return `
        <span class="p-signal"></span>
        <span class="p-mute">${iconMarkup('mic-off')}</span>
        <div class="avatar-container">
            <div class="p-avatar avatar-grad-${gradIndex(id)}">${escapeHtml(avatarLetter(safeName))}</div>
        </div>
        <div class="p-meta">
            <div class="p-name">${escapeHtml(safeName)}</div>
            <div class="p-sub">${escapeHtml(subtitle)}<span class="p-route" hidden></span></div>
        </div>`;
}

function buildCard(id, name, subtitle) {
    const card = document.createElement('div');
    card.className = 'participant';
    card.dataset.peer = id;
    card.innerHTML = cardMarkup(id, name, subtitle);
    return card;
}

export function resetParticipants() {
    refs.grid.replaceChildren();
    cards.clear();
    localCard = null;
}

export function renderLocalCard(name) {
    resetParticipants();
    localCard = buildCard('local', name, STR.you);
    localCard.classList.add('is-self');
    refs.grid.append(localCard);
}

export function addPeerCard(id, name) {
    const card = buildCard(id, name, STR.online);
    cards.set(id, card);
    refs.grid.append(card);
    setPeerRoute(id, 'connecting');
    return card;
}

export function updatePeerCard(peer) {
    const card = cards.get(peer.id);
    if (!card) return;
    const safeName = cleanName(peer.name) || STR.defaultName;
    card.querySelector('.p-name').textContent = safeName;
    card.querySelector('.p-avatar').textContent = avatarLetter(safeName);
    card.classList.toggle('is-muted', Boolean(peer.muted));
}

export function setPeerRoute(id, route) {
    const card = id === 'local' ? localCard : cards.get(id);
    const badge = card?.querySelector('.p-route');
    if (!badge) return;

    let label = '';
    if (route === 'local') label = STR.routeLocal;
    else if (route === 'direct') label = STR.routeDirect;
    else if (route === 'relay') label = STR.routeRelay;
    else if (route === 'connecting') label = STR.routeConnecting;

    badge.textContent = label;
    badge.dataset.route = route;
    badge.hidden = !label;
}

export function removePeerCard(id) {
    const card = cards.get(id);
    if (!card) return;
    card.remove();
    cards.delete(id);
}

export function updatePeersCount(total) {
    refs.peersCount.textContent = STR.peersCount(total);
}

export function setSpeaking(id, speaking) {
    const card = id === 'local' ? localCard : cards.get(id);
    card?.querySelector('.avatar-container')?.classList.toggle('speaking', speaking);
}

export function setLocalMuted(muted) {
    if (!localCard) return;
    localCard.classList.toggle('is-muted', muted);
    if (muted) localCard.querySelector('.avatar-container')?.classList.remove('speaking');
}

/* --------------------------- المحادثة --------------------------- */

function emptyState() {
    const element = document.createElement('div');
    element.className = 'chat-empty';
    element.innerHTML = `${iconMarkup('headphones')}<span>${escapeHtml(STR.chatStart)}</span>`;
    return element;
}

function clearEmptyState() {
    refs.chatLog.querySelector('.chat-empty')?.remove();
}

export function resetChat() {
    refs.chatLog.replaceChildren(emptyState());
    unread = 0;
    renderUnread();
}

export function addSystemMessage(text) {
    clearEmptyState();
    const element = document.createElement('div');
    element.className = 'msg-sys';
    element.innerHTML = `<span>${escapeHtml(text)}</span>`;
    refs.chatLog.append(element);
    scrollChat();
}

export function addChatMessage({ from, text, at, mine = false, silent = false }) {
    const safeText = cleanMessage(text);
    if (!safeText || hasLink(safeText)) return;
    const safeFrom = cleanName(from) || STR.defaultName;
    const stamp = safeTimestamp(at);
    clearEmptyState();

    const element = document.createElement('div');
    element.className = `msg ${mine ? 'msg-me' : 'msg-peer'}`;
    element.innerHTML = `
        <div class="msg-body">
            ${mine ? '' : `<span class="msg-from">${escapeHtml(safeFrom)}</span>`}
            <div class="msg-bubble">${escapeHtml(safeText)}</div>
            <span class="msg-time">${formatTime(stamp)}</span>
        </div>`;
    refs.chatLog.append(element);
    scrollChat();

    if (!silent && !mine) {
        const hiddenChat = !isChatVisible();
        if (hiddenChat || document.hidden) {
            unread += 1;
            renderUnread();
            const preview = safeText.length > 70 ? `${safeText.slice(0, 70)}...` : safeText;
            toast(STR.chatNotice(safeFrom, preview), 'chat');
        }
    }
}

function scrollChat() {
    refs.chatLog.scrollTop = refs.chatLog.scrollHeight;
}

function renderUnread() {
    const hasUnread = unread > 0;
    const label = unread > 9 ? '9+' : String(unread);
    refs.unreadBadge.hidden = !hasUnread;
    refs.footerUnread.hidden = !hasUnread;
    if (hasUnread) refs.unreadBadge.textContent = label;

    const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
    document.title = hasUnread ? `(${label}) ${base}` : base;
}

export function clearUnread() {
    unread = 0;
    renderUnread();
}

export function isChatVisible() {
    return isDesktopChat() || refs.chat.classList.contains('is-open');
}

export function setChatOpen(open) {
    refs.chat.classList.toggle('is-open', open);
    if (open) clearUnread();
}

export function toggleChat() {
    setChatOpen(!refs.chat.classList.contains('is-open'));
}

export function onChatSubmit(handler) {
    refs.chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = refs.chatInput.value.trim();
        if (!text) return;
        refs.chatInput.value = '';
        handler(text);
    });
}

export function focusChatInput() {
    refs.chatInput.focus();
}

/* --------------------------- البتريت --------------------------- */

export function setBitrateText(text) {
    refs.bitrateText.textContent = text;
}

/* --------------------------- حالة التواجد والإنترنت --------------------------- */

export function setPresenceStatus(isOnline) {
    if (!refs.footerStatus) return;
    if (isOnline) {
        refs.footerStatus.classList.remove('me-status-disconnected');
        refs.footerStatus.innerHTML = '<i class="live-dot"></i> ' + escapeHtml(STR.online);
    } else {
        refs.footerStatus.classList.add('me-status-disconnected');
        refs.footerStatus.innerHTML =
            '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-wifi-off"/></svg> ' +
            escapeHtml(STR.offlineStatus);
    }
}

/* --------------------------- نافذة يوتيوب --------------------------- */

export function openYouTubeModal() {
    if (!refs.ytModal) return;
    refs.ytModal.hidden = false;
    refs.ytSearchInput?.focus();
}

export function closeYouTubeModal() {
    if (!refs.ytModal) return;
    refs.ytModal.hidden = true;
}

export function isYouTubeModalOpen() {
    return Boolean(refs.ytModal && !refs.ytModal.hidden);
}

export function setSearchResultsLoading(loading) {
    if (refs.ytResultsSpinner) refs.ytResultsSpinner.hidden = !loading;
    if (refs.ytResultsContainer) refs.ytResultsContainer.hidden = false;
}

export function renderSearchResults(results, onSelect) {
    if (!refs.ytResultsContainer || !refs.ytResultsItems) return;
    refs.ytResultsItems.innerHTML = '';
    if (refs.ytResultsSpinner) refs.ytResultsSpinner.hidden = true;
    refs.ytResultsContainer.hidden = false;

    if (!Array.isArray(results) || results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'yt-loading';
        empty.textContent = STR.ytNoResults;
        refs.ytResultsItems.append(empty);
        return;
    }

    for (const item of results) {
        if (item.isSearchPrompt) {
            const card = document.createElement('div');
            card.className = 'yt-result-card yt-search-prompt-card';
            card.innerHTML = `
                <div class="yt-thumb-wrap yt-prompt-icon-wrap">
                    <svg class="icon yt-prompt-icon" aria-hidden="true"><use href="#i-search"/></svg>
                </div>
                <div class="yt-card-info">
                    <span class="yt-card-title">${escapeHtml(item.title)}</span>
                    <span class="yt-card-channel">${escapeHtml(item.author)}</span>
                </div>
                <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm yt-open-search-btn">
                    <span>فتح يوتيوب ↗</span>
                </a>
            `;
            refs.ytResultsItems.append(card);
            continue;
        }

        const card = document.createElement('div');
        card.className = 'yt-result-card';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', item.title);

        const safeTitle = escapeHtml(item.title);
        const safeAuthor = escapeHtml(item.author || '');
        const safeThumb = escapeHtml(item.thumbnail);
        const safeDuration = escapeHtml(item.durationFormatted || '0:00');

        card.innerHTML = `
            <div class="yt-thumb-wrap">
                <img class="yt-thumb-img" src="${safeThumb}" alt="" loading="lazy">
                <span class="yt-duration-badge">${safeDuration}</span>
            </div>
            <div class="yt-card-info">
                <span class="yt-card-title">${safeTitle}</span>
                <span class="yt-card-channel">${safeAuthor}</span>
            </div>
        `;

        card.addEventListener('click', () => {
            onSelect(item);
            closeYouTubeModal();
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(item);
                closeYouTubeModal();
            }
        });

        refs.ytResultsItems.append(card);
    }
}

