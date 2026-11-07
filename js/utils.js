/* أدوات مساعدة نقية — بدون أي آثار جانبية على الواجهة */

import { ROOM_WORDS, ROOM_MAX } from './config.js';

export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function randomId(length = 8) {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = '';
    for (const byte of bytes) out += alphabet[byte % alphabet.length];
    return out;
}

export function hashString(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
}

/* يحوّل أي رمز (حتى العربي) إلى مقطع ASCII صالح لمعرّفات PeerJS */
export function sanitizeRoom(raw) {
    const cleaned = String(raw ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, ROOM_MAX);
    if (cleaned.length >= 2) return cleaned;
    const compact = String(raw ?? '').trim().toLowerCase();
    if (!compact) return '';
    return `r${hashString(compact)}`;
}

export function generateRoomCode() {
    const word = ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)];
    const num = 10 + Math.floor(Math.random() * 90);
    return `${word}-${num}`;
}

export function avatarLetter(name) {
    const clean = String(name ?? '').trim();
    return clean ? clean.charAt(0).toUpperCase() : '?';
}

export function gradIndex(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return (hash % 8) + 1;
}

const timeFormatter = new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit' });

export const formatTime = (timestamp) => timeFormatter.format(new Date(timestamp));

export const iconMarkup = (name, extraClass = '') =>
    `<svg class="icon${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function setIcon(useElement, name) {
    if (useElement) useElement.setAttribute('href', `#i-${name}`);
}

/* يقيّد أي وقت قادم من الشبكة داخل نطاق معقول لتجنّب تواريخ غير صالحة */
export function safeTimestamp(value) {
    const now = Date.now();
    const stamp = Number(value);
    if (!Number.isFinite(stamp)) return now;
    return Math.min(Math.max(stamp, now - 86400000), now + 60000);
}

export const isDesktopChat = () => window.matchMedia('(min-width: 1024px)').matches;

/* ------------------------- مسار الغرفة ------------------------- */
/* الشكل: /{room} — رمز الغرفة فقط، والاسم محفوظ محلياً ولا يدخل الرابط */

function decodeSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function readRoute() {
    const segments = location.pathname.split('/').filter(Boolean);
    return { room: segments[0] ? decodeSegment(segments[0]) : '' };
}

export function writeRoute(room) {
    const path = room ? `/${encodeURIComponent(room)}` : '/';
    if (location.pathname === path) return;
    try {
        history.replaceState(null, '', path);
    } catch {
        /* المتصفح رفض تعديل المسار */
    }
}

export function safeSend(conn, payload) {
    try {
        if (conn?.open) conn.send(payload);
    } catch {
        /* الاتصال أُغلق أثناء الإرسال */
    }
}

export function readStorage(key) {
    try {
        return localStorage.getItem(key) ?? '';
    } catch {
        return '';
    }
}

export function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* التخزين المحلي معطّل */
    }
}
