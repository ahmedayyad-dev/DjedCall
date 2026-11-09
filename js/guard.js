/* حماية المدخلات: تنظيف الأسماء والرسائل، منع الروابط، والتحقق من المعرّفات */

import { CHAT_MAX, NAME_MAX, PEER_ID_PATTERN, ROOM_MAX, YT_VIDEO_ID_PATTERN } from './config.js';

/* محارف تحكم ومحارف اتجاه مخفية تُستخدم لتزوير النص */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const NAME_ALLOWED = /[^\p{L}\p{N} ._-]/gu;
const LINK_PATTERN =
    /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|\b[a-z0-9-]+\.(?:com|net|org|io|me|ly|gg|link|site|xyz|dev|app|info|online|shop|top|club)\b)/i;
const YT_URL_PATTERN =
    /(?:youtube(?:-nocookie)?\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([\w-]{11})/i;

const clamp = (value, max) => [...value].slice(0, max).join('');

export function cleanName(value, max = NAME_MAX) {
    return clamp(
        String(value ?? '')
            .replace(CONTROL, ' ')
            .replace(/\s+/g, ' ')
            .replace(NAME_ALLOWED, '')
            .trim(),
        max,
    ).trim();
}

export function cleanRoomLabel(value, max = ROOM_MAX) {
    return cleanName(value, max);
}

export function cleanMessage(value, max = CHAT_MAX) {
    return clamp(
        String(value ?? '')
            .replace(/\r\n?/g, '\n')
            .replace(CONTROL, '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim(),
        max,
    ).trim();
}

export function hasLink(text) {
    return LINK_PATTERN.test(String(text ?? ''));
}

export function validPeerId(id) {
    return typeof id === 'string' && PEER_ID_PATTERN.test(id);
}

export function extractYouTubeId(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (YT_VIDEO_ID_PATTERN.test(trimmed)) return trimmed;
    const match = trimmed.match(YT_URL_PATTERN);
    return match ? match[1] : null;
}

export function validYouTubeId(id) {
    return typeof id === 'string' && YT_VIDEO_ID_PATTERN.test(id);
}

export function cleanSearchQuery(value, max = 100) {
    return clamp(
        String(value ?? '')
            .replace(CONTROL, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        max,
    ).trim();
}
