/* ثوابت التطبيق — مكان واحد لكل الإعدادات */

export const ROOM_PREFIX = 'djedcall-r-';
export const PEER_PREFIX = 'djedcall-m-';

export const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:peer.djedcall.ahmedayyad.dev:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: 'turn:peer.djedcall.ahmedayyad.dev:3478?transport=udp',
        username: 'djedcall',
        credential: 'djed2026pass',
    },
    {
        urls: 'turn:peer.djedcall.ahmedayyad.dev:3478?transport=tcp',
        username: 'djedcall',
        credential: 'djed2026pass',
    },
];

export const ICE_SERVERS = DEFAULT_ICE_SERVERS;

export const ROOM_WORDS = [
    'nile', 'ankh', 'horus', 'isis', 'osiris', 'djed', 'karnak', 'luxor',
    'giza', 'sphinx', 'papyrus', 'ammit', 'aten', 'sobek', 'min', 'set',
];

export const STORAGE_KEYS = {
    name: 'djedcall:name',
    room: 'djedcall:room',
    servers: 'djedcall:servers',
};

/* خادم التنسيق الافتراضي الخاص بنا (PeerJS) */
export const DEFAULT_PEER_SERVER = {
    host: 'peer.djedcall.ahmedayyad.dev',
    port: 443,
    secure: true,
    path: '/',
};

export const PEER_SERVER = DEFAULT_PEER_SERVER;

/* قراءة واسترجاع إعدادات الخوادم المحفوظة محلياً أو استخدام الافتراضية */
export function getSavedServers() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.servers);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch {
        /* تجاهل الأخطاء إن كانت البيانات غير صالحة */
    }
    return null;
}

export function getEffectivePeerServer() {
    const saved = getSavedServers();
    if (saved?.peerServer?.host) {
        return {
            host: String(saved.peerServer.host).trim(),
            port: Number(saved.peerServer.port) || 443,
            secure: saved.peerServer.secure !== false,
            path: String(saved.peerServer.path || '/').trim() || '/',
        };
    }
    return DEFAULT_PEER_SERVER;
}

export function getEffectiveIceServers() {
    const saved = getSavedServers();
    if (saved?.turnServer?.url) {
        const turnUrl = String(saved.turnServer.url).trim();
        const baseTurn = turnUrl.replace(/\?transport=(udp|tcp)/g, '');
        const stunUrl = turnUrl.startsWith('turn:') ? turnUrl.replace(/^turn:/, 'stun:') : '';

        const ice = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];

        if (stunUrl) {
            ice.push({ urls: stunUrl.split('?')[0] });
        }

        const username = saved.turnServer.username ? String(saved.turnServer.username).trim() : undefined;
        const credential = saved.turnServer.credential ? String(saved.turnServer.credential).trim() : undefined;

        const turnUdp = { urls: `${baseTurn}?transport=udp` };
        const turnTcp = { urls: `${baseTurn}?transport=tcp` };
        if (username) {
            turnUdp.username = username;
            turnTcp.username = username;
        }
        if (credential) {
            turnUdp.credential = credential;
            turnTcp.credential = credential;
        }

        ice.push(turnUdp, turnTcp);
        return ice;
    }
    return DEFAULT_ICE_SERVERS;
}

export function getEffectivePeerOptions() {
    const server = getEffectivePeerServer();
    const ice = getEffectiveIceServers();
    return {
        ...server,
        debug: 1,
        config: {
            iceServers: ice,
            iceTransportPolicy: 'all',
            iceCandidatePoolSize: 4,
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
        },
    };
}

export function saveCustomServers(config) {
    try {
        if (!config || typeof config !== 'object') return false;
        localStorage.setItem(STORAGE_KEYS.servers, JSON.stringify(config));
        return true;
    } catch {
        return false;
    }
}

export function resetCustomServers() {
    try {
        localStorage.removeItem(STORAGE_KEYS.servers);
        return true;
    } catch {
        return false;
    }
}

export const PEER_OPTIONS = getEffectivePeerOptions();

export const AUDIO_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
    latency: 0.01,
};

export const VAD = {
    tickMs: 120,
    start: 0.024,
    stop: 0.012,
    holdTicks: 3,
    meterScale: 220,
};

export const MAX_BITRATE = 24000;
export const STATS_INTERVAL = 2000;

export const PEER_OPEN_TIMEOUT = 12000;
export const DATA_CONNECT_TIMEOUT = 12000;
export const RELAY_LIST_TIMEOUT = 6500;
export const RELAY_CLAIM_MIN = 1200;
export const RELAY_CLAIM_JITTER = 2500;

export const CHAT_HISTORY_MAX = 60;
export const CHAT_MAX = 300;
export const NAME_MAX = 20;
export const ROOM_MAX = 24;

/* حدود الحماية من الإغراق وسوء الاستخدام */
export const MAX_PEERS = 12;
export const RELAY_MAX_MEMBERS = 24;
export const CHAT_RATE_WINDOW = 4000;
export const CHAT_RATE_MAX = 6;
export const LOCAL_SEND_GAP = 400;
export const PEER_ID_PATTERN = /^djedcall-m-[a-z0-9]{1,24}-[a-z0-9]{4,16}$/;

/* حدود البيانات الخام القادمة من الشبكة قبل التنظيف */
export const RAW_NAME_MAX = 200;
export const RAW_TEXT_MAX = 2000;
