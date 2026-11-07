/* كل النصوص الديناميكية التي تظهر للمستخدم — مصدر واحد للحقيقة */

export const STR = {
    appName: 'DjedCall',
    defaultName: 'مستخدم',
    you: 'أنت',
    online: 'متصل',

    peersCount: (n) => (n === 1 ? '1 متصل' : `${n} متصلين`),

    firstInRoom: 'أنت أول واحد في الغرفة ▪ انسخ الرابط وابعته لأصحابك',
    aloneInRoom: 'أنت الآن في الغرفة ▪ استنى باقي الأعضاء ينضموا',
    relayActivated: 'تم تفعيل بوابة الغرفة على جهازك ✓',
    peerJoined: (name) => `${name} انضم للغرفة`,
    peerLeft: (name) => `${name} خرج من الغرفة`,
    routeLocal: 'محلي',
    routeDirect: 'مباشر',
    routeRelay: 'عبر خادم',
    peerLocal: (name) => `${name} معاك على نفس الشبكة ▪ الصوت محلي`,
    chatStart: 'بداية المحادثة في الغرفة',

    micReady: 'المايك يعمل',
    micMuted: 'المايك مكتوم',
    micEnabledToast: 'تم تشغيل المايك ✓',
    micMutedToast: 'تم كتم المايك ✓',

    micTesting: 'جاري الفحص...',
    micTestReady: 'المايك شغال ▪ اتكلم وشوف المؤشر',
    micTestFail: 'فشل الوصول للمايك ✗',
    micTestIdle: 'جرّب المايك',
    micDenied: 'لازم تسمح بالوصول للمايكروفون عشان تدخل الغرفة',
    micMissing: 'مفيش مايكروفون متاح على الجهاز ده',
    micError: 'تعذر تشغيل المايكروفون',
    nameInvalid: 'الاسم لازم حروف وأرقام بس بدون رموز',
    nameRequired: 'اكتب اسمك الأول عشان تدخل الغرفة',
    nameUpdated: 'تم تحديث اسمك ✓',
    msgBlocked: 'الرسالة فيها رابط أو محتوى غير مسموح',
    msgRate: 'استنى لحظة قبل ما تبعت رسالة تانية',

    roomRequired: 'اكتب رمز الغرفة الأول',
    roomInvalid: 'رمز الغرفة غير صالح',
    connectFailed: 'تعذر الاتصال بخادم التنسيق ▪ حاول تاني',
    retrying: 'تعذر الوصول لخادم التنسيق ▪ جاري إعادة المحاولة',
    browserUnsupported: 'المتصفح لا يدعم WebRTC',
    leftRoom: 'خرجت من الغرفة',

    copyOk: 'تم نسخ رابط الغرفة ✓ ابعته لأصحابك',
    copyPrompt: 'انسخ الرابط وابعته:',
    copyFail: 'تعذر النسخ ▪ افتح الرابط وانسخه يدوياً',
    shareTitle: 'DjedCall',
    shareText: 'تعالى نعمل مكالمة صوتية',

    chatNotice: (from, text) => `${from}: ${text}`,

    bitrateSilent: '0kbps ▪ DTX (سكوت)',
    bitrate: (kbps) => `${kbps}kbps ▪ DTX اقتصادي`,
    bitrateIdle: '16kbps ▪ DTX',
};
