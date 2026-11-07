/* تصنيف مسار الوسائط لكل اتصال WebRTC: محلي، مباشر، أو عبر خادم */

const PRIVATE_ADDRESS =
    /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{0,2}:|fe80:)/i;

const isLocalAddress = (address) => {
    const value = String(address ?? '');
    return !value || value.endsWith('.local') || PRIVATE_ADDRESS.test(value);
};

const findPair = (report) => {
    let selected = null;
    let nominated = null;
    let succeeded = null;

    report.forEach((row) => {
        if (row.type === 'transport' && row.selectedCandidatePairId) {
            selected = report.get(row.selectedCandidatePairId) ?? selected;
        }
        if (row.type !== 'candidate-pair') return;
        if (row.state === 'succeeded' && !succeeded) succeeded = row;
        if (row.state === 'succeeded' && row.nominated && !nominated) nominated = row;
    });

    return selected ?? nominated ?? succeeded;
};

export async function describeConnection(pc) {
    if (!pc || typeof pc.getStats !== 'function') return 'unknown';

    try {
        const report = await pc.getStats();
        const pair = findPair(report);
        if (!pair) return 'unknown';

        const local = report.get(pair.localCandidateId);
        const remote = report.get(pair.remoteCandidateId);
        if (!local || !remote) return 'unknown';

        if (local.candidateType === 'relay' || remote.candidateType === 'relay') return 'relay';

        const hostPair = local.candidateType === 'host' && remote.candidateType === 'host';
        const localAddr = local.address || local.ip;
        const remoteAddr = remote.address || remote.ip;
        if (hostPair && isLocalAddress(localAddr) && isLocalAddress(remoteAddr)) return 'local';

        return 'direct';
    } catch {
        return 'unknown';
    }
}
