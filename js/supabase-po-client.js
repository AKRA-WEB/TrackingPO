/**
 * ============================================================================
 * AKRA PO (PURCHASE ORDERS) SUPABASE API CLIENT
 * Supabase is the canonical Purchasing & Receiving store.
 * This browser client talks only to the authenticated PO Edge Function
 * and never holds a database credential.
 * ============================================================================
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AkraSupabasePO = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const API_URL = 'https://hgxrrskztbpejirrdpbq.supabase.co/functions/v1/po-api';
    const READ_ACTIONS = new Set(['bootstrap', 'getInitialData', 'getProducts', 'getDeliveryInsights']);

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function request(action, data, token) {
        const bridge = typeof window !== 'undefined' && window.AkraModule?.embedded ? window.AkraModule : null;
        if (bridge) token = bridge.getToken();
        const session = typeof window !== 'undefined' ? window.appSession : undefined;
        const operation = async () => {
            const result = await transportRequest(action, data, token);
            let current = typeof window === 'undefined' || window.appSession === session;
            try { if (bridge && bridge.getToken() !== token) current = false; } catch (_) { current = false; }
            if (!current) {
                const error = new Error('บัญชีหรือเซสชันเปลี่ยนแล้ว กรุณาตรวจสอบผลรายการจาก Main ก่อนทำซ้ำ');
                error.reason = 'session_changed';
                throw error;
            }
            if (bridge && !READ_ACTIONS.has(action) && result && result.success !== false && result.status !== 'error') {
                bridge.markSaved?.();
            }
            return result;
        };
        return bridge && !READ_ACTIONS.has(action) ? bridge.runMutation(operation) : operation();
    }

    async function transportRequest(action, data, token) {
        if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
        const isRead = READ_ACTIONS.has(action);
        const attempts = isRead ? 2 : 1;
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), isRead ? 25000 : 35000);
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, data: data || {}, token }),
                    signal: controller.signal
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const error = new Error(payload.message || payload.reason || `PO API HTTP ${response.status}`);
                    error.reason = payload.reason || '';
                    throw error;
                }
                return payload;
            } catch (error) {
                lastError = error;
                if (attempt < attempts && (error.name === 'AbortError' || error instanceof TypeError)) {
                    await delay(250 * attempt);
                    continue;
                }
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        }
        throw lastError || new Error('PO API unavailable');
    }

    let catalog = null;
    function getCatalog(data, token) {
        if (!token) return Promise.reject(new Error('กรุณาเข้าสู่ระบบใหม่'));
        if (!catalog || catalog.token !== token || (data && data.bypassCache)) {
            catalog = { token, value: null, expires: 0, pending: null };
        }
        const entry = catalog;
        if (entry.value && Date.now() < entry.expires) return Promise.resolve(entry.value);
        if (entry.pending) return entry.pending;
        entry.pending = request('getProducts', data || {}, token).then(result => {
            if (result.success !== false) {
                entry.value = result;
                entry.expires = Date.now() + 5 * 60 * 1000;
            }
            return result;
        }).finally(() => { entry.pending = null; });
        return entry.pending;
    }

    return {
        request,
        getInitialData: (options, token) => request('getInitialData', options, token),
        getProducts: (data, token) => getCatalog(data, token),
        getDeliveryInsights: (data, token) => request('getDeliveryInsights', data, token),
        saveDirectPO: (poData, token) => request('createPO', poData, token),
        createPO: (poData, token) => request('createPO', poData, token),
        updatePO: (poData, token) => request('updatePO', poData, token),
        deleteBill: (payload, token) => request('deleteBill', payload, token),
        deletePO: (payload, token) => request('deleteBill', payload, token),
        cancelUnreceivedPO: (payload, token) => request('cancelUnreceivedPO', payload, token),
        approvePR: (payload, token) => request('approvePR', payload, token),
        rejectPR: (payload, token) => request('rejectPR', payload, token),
        closePO: (payload, token) => request('closePO', payload, token),
        searchProducts: async (query, limit = 30, token) => {
            const res = await getCatalog({}, token);
            const prods = (res && res.data && res.data.products) || (res && res.products) || [];
            if (!prods.length) return [];
            const tokens = (query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) return prods.slice(0, limit);
            return prods
                .filter(p => tokens.every(token => [p.name || p.product_name, p.sku, p.subname, p.unit, p.last_vendor || p.vendor || p.default_vendor]
                    .some(value => String(value || '').toLowerCase().includes(token))))
                .slice(0, limit);
        },
        API_URL
    };
}));
