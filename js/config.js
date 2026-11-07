/* ثوابت التطبيق — مكان واحد لكل الإعدادات */

export const ROOM_PREFIX = 'djedcall-r-';
export const PEER_PREFIX = 'djedcall-m-';

export const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:peer.djedcall.ahmedayyad.dev:3478' },
    {
        urls: [
            'turn:peer.djedcall.ahmedayyad.dev:3478?transport=udp',
            'turn:peer.djedcall.ahmedayyad.dev:3478?transport=tcp',
        ],
        username: 'djedcall',
        credential: 'djed2026pass',
    },
];

export const ROOM_WORDS = [
    'nile', 'ankh', 'horus', 'isis', 'osiris', 'djed', 'karnak', 'luxor',
    'giza', 'sphinx', 'papyrus', 'ammit', 'aten', 'sobek', 'min', 'set',
];

export const STORAGE_KEYS = {
    name: 'djedcall:name',
    room: 'djedcall:room',
};

/* خادم التنسيق الخاص بنا (PeerJS) — نفس النطاق يعمل عبر WSS على المنفذ 443 */
export const PEER_SERVER = {
    host: 'peer.djedcall.ahmedayyad.dev',
    port: 443,
    secure: true,
    path: '/',
};

export const PEER_OPTIONS = {
    ...PEER_SERVER,
    debug: 0,
    config: {
        /* الوسائط تختار المسار المحلي تلقائياً عند توفر نفس الشبكة، أو عبر STUN/TURN لبقية الشبكات */
        iceServers: ICE_SERVERS,
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 4,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
    },
};

export const AUDIO_CONSTRAINTS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
};

export const VAD = {
    tickMs: 120,
    start: 0.024,
    stop: 0.012,
    holdTicks: 3,
    meterScale: 220,
};

export const MAX_BITRATE = 16000;
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
