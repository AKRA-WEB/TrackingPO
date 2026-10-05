// Synthetic frontend runtime: no network, production data, or browser claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).find(script => script.includes('async function submitDirectPO'));
const elements = new Map();
function element(id) {
    const el = { id, value: '', innerText: '', dataset: {}, children: [],
        classList: { values: new Set(), add(name) { this.values.add(name); }, remove(name) { this.values.delete(name); }, contains(name) { return this.values.has(name); } },
        addEventListener() {}, setAttribute() {}, reset() {},
        appendChild(child) { this.children.push(child); },
        set innerHTML(value) { this.html = value; if (!value) this.children = []; },
        get innerHTML() { return this.html || ''; },
        querySelector(selector) {
            const className = selector.slice(1);
            const tag = this.innerHTML.match(new RegExp('<input[^>]*class="[^"]*\\b' + className + '\\b[^>]*"[^>]*>'))?.[0];
            return tag ? { value: tag.match(/value="([^"]*)"/)?.[1] || '', addEventListener() {} } : element(selector);
        }, querySelectorAll() { return []; }
    };
    elements.set(id, el);
    return el;
}
const get = id => elements.get(id) || element(id);
const document = { getElementById: get, createElement: element, addEventListener() {},
    querySelectorAll: selector => selector === '.create-po-item-row' ? get('create-po-items-container').children : [] };
const poId = '10000000-0000-4000-8000-000000000001';
const ids = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
const addedId = '20000000-0000-4000-8000-000000000003';
let saved = ids.map((uid, i) => ({ uid, id: uid, poId, refPrUid: 'DIRECT-fixture', poNumber: 'PO-DIR-FIXTURE',
    vendor: 'Fixture vendor', warehouse: 'W1', poDate: '01/10/2026', expectedDate: '',
    product: `Fixture product ${i + 1}`, sku: `FIX-${i + 1}`, quantity: i + 2, unit: 'ชิ้น',
    billRemark: 'bill note', itemRemark: `item note ${i + 1}`, status: 'Pending GR', displayStatus: 'Pending GR' }));
const calls = [];
const notices = [];
let deny = false;
let rejectMutation = false;
let rejectRefresh = false;
let refreshes = 0;
const client = { async updatePO(payload) {
    calls.push(structuredClone(payload));
    if (rejectMutation) throw new Error('cannot_update_received_po');
    const header = saved[0];
    saved = payload.items.map(item => ({ ...header, ...saved.find(row => row.uid === item.id),
        uid: item.id || addedId, id: item.id || addedId, expectedDate: item.expectedDate,
        product: item.product, sku: item.sku, quantity: item.quantity, unit: item.unit, itemRemark: item.remark }));
    return { success: true, poId }; // Existing SQL returns no poUids.
}, async createPO(payload) { calls.push(structuredClone(payload)); return { success: true, poUids: ids }; },
async approvePR(payload) { calls.push(structuredClone(payload)); return { success: true }; } };
const context = vm.createContext({ document, console, URL, URLSearchParams,
    window: { location: { search: '', pathname: '/PO/' }, self: {}, top: {}, addEventListener() {},
        appSession: { token: 'synthetic', roles: ['ADMIN'], perms: { 'app-tracking': ['createPO'] } } },
    AkraSupabasePO: client, AppVersionGuard: { async blockIfStale() { return false; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')) }),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, lucide: { createIcons() {} }
});
vm.runInContext(source, context);
vm.runInContext('AppVersionGuard.start({ current: CURRENT_VERSION, readActions: [] });', context);
context.showNotification = (message, type) => notices.push({ message, type });
context.setupProductAutocompleteForPO = () => {};
context.can = () => !deny;
context.processDataAndRender = () => context.groupPOData();
context.readApiCall = async () => { refreshes++; return { success: !rejectRefresh, prList: [], pendingPOs: structuredClone(saved), vendors: [] }; };
context.appData = { pendingPOs: structuredClone(saved) };
const submit = () => context.submitDirectPO({ preventDefault() {} });

(async () => {
    context.groupPOData();
    context.openEditPOForm(context.groupedPOs[0]);
    get('create-po-expected-date').value = '2026-10-12';
    await submit();
    assert.deepEqual(calls[0].items.map(item => item.id), ids, 'edit must retain each canonical item UUID');
    assert.equal(calls[0].poId, poId, 'edit must target its canonical PO');
    assert.ok(calls[0].items.every(item => item.expectedDate === '2026-10-12'));
    assert.ok(refreshes > 0, 'successful edit reads back authoritative rows');
    assert.deepEqual(Array.from(context.appData.pendingPOs, row => row.uid), ids, 'no manufactured IDs after success');
    assert.ok(context.appData.pendingPOs.every(row => row.poDate === '01/10/2026' && row.refPrUid === 'DIRECT-fixture'));
    context.openEditPOForm(context.groupedPOs[0]);
    assert.equal(get('create-po-expected-date').value, '2026-10-12');
    get('create-po-expected-date').value = '';
    await submit();
    context.openEditPOForm(context.groupedPOs[0]);
    assert.equal(get('create-po-expected-date').value, '', 'cleared optional date reopens blank');
    assert.deepEqual(calls[1].items.map(item => item.id), ids, 'immediate second edit keeps stable IDs');
    get('create-po-items-container').children.reverse();
    await submit();
    assert.deepEqual(calls[2].items.map(item => item.id), [...ids].reverse(), 'reordered rows keep their own IDs');
    context.openEditPOForm(context.groupedPOs[0]);
    get('create-po-items-container').children.pop();
    await submit();
    assert.equal(calls[3].items.length, 1);
    assert.equal(calls[3].items[0].id, ids[1], 'removing a row keeps the surviving identity');
    context.addCreatePoItemRow('Added product', '3', 'ชิ้น', 'ADDED-1');
    await submit();
    assert.equal(calls.at(-1).items[1].id, undefined, 'added row does not reuse an existing UUID');
    assert.equal(context.appData.pendingPOs[1].uid, addedId, 'read-back obtains the added row UUID');
    context.openEditPOForm(context.groupedPOs[0]);
    await submit();
    assert.equal(calls.at(-1).items[1].id, addedId, 'immediate next save uses the added canonical UUID');
    const count = calls.length;
    deny = true;
    await submit();
    assert.equal(calls.length, count, 'permission denial performs no mutation');
    deny = false;
    rejectMutation = true;
    const beforeFailure = JSON.stringify(context.appData.pendingPOs);
    await submit();
    assert.equal(JSON.stringify(context.appData.pendingPOs), beforeFailure, 'rejected edit preserves local rows');
    assert.equal(get('btn-submit-direct-po').disabled, false, 'rejected edit releases submit lock');
    rejectMutation = false;
    rejectRefresh = true;
    await submit();
    assert.equal(get('data-loader').classList.contains('hidden'), false, 'failed read-back blocks stale UI behind loader');
    assert.equal(get('data-loader-retry').classList.contains('hidden'), false, 'failed read-back exposes retry');
    assert.match(get('data-loader-text').innerText, /บันทึก PO แล้ว/, 'read failure distinguishes the successful mutation');
    vm.runInContext('initialDataPrefetch = null;', context);
    await context.loadInitialData(true);
    assert.equal(get('data-loader').classList.contains('hidden'), false, 'failed manual retry cannot unlock cached stale rows');
    rejectRefresh = false;
    context.scheduleProductsBackground = () => {};
    await context.loadInitialData(true);
    assert.equal(get('data-loader').classList.contains('hidden'), true, 'successful retry unlocks authoritative rows');
    context.openPurchasingForm();
    get('create-po-vendor').value = 'New vendor';
    get('create-po-warehouse').value = 'W1';
    get('create-po-items-container').children = [];
    context.addCreatePoItemRow('New product', '1', 'ชิ้น', 'NEW-1');
    await submit();
    assert.equal(calls.at(-1).poId, undefined, 'create does not inherit the edited PO');
    assert.equal(calls.at(-1).items[0].id, undefined, 'new rows have no old item UUID');
    context.appData.prList = [{ uid: 'pr-fixture', prId: 'pr-id', prNumber: 'PR-TEST', rowNumber: 12,
        warehouse: 'W1', product: 'PR product', quantity: 2, unit: 'ชิ้น', sku: 'PR-1' }];
    context.appData.products = [];
    context.approvePRToPOForm(12, 'pr-fixture', 'pr-id');
    assert.equal(get('form-create-po').dataset.poId, undefined, 'PR approval has no previous PO ID');
    get('create-po-vendor').value = 'PR vendor';
    get('create-po-expected-date').value = '2026-10-15';
    await submit();
    assert.equal(calls.at(-1).prId, 'pr-id');
    assert.equal(calls.at(-1).poData.items[0].id, undefined, 'PR approval has no edited item UUID');
    assert.equal(calls.at(-1).poData.items[0].expectedDate, '2026-10-15');
    console.log('PASS PO edit delivery date: identity, save/clear/reopen, reorder/add/remove, denial/failure, read-back retry guard, create/PR reset');
})().catch(error => { console.error(error); process.exitCode = 1; });
