'use strict';
// Actual application/client runtime with fictional rows and DOM; no network or browser claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
scripts.forEach((source, index) => new vm.Script(source, { filename: `po-inline-${index}.js` }));
const source = scripts.find(script => script.includes('async function submitDirectPO'));
const json = value => JSON.parse(JSON.stringify(value));
const poId = '10000000-0000-4000-8000-000000000001';
const uid = '20000000-0000-4000-8000-000000000001';
const expected = { status: 'Pending GR', sku: null, product: 'Old fixture product', quantity: 3, unit: null, expectedDate: null, remark: null };
const fixture = () => [0, 1, 2, 3].map(index => ({ uid: index ? `20000000-0000-4000-8000-00000000000${index + 1}` : uid,
    poId, poItemCount: 4, refPrUid: 'DIRECT-FIXTURE', poNumber: 'PO-FIXTURE', vendor: 'Original vendor', warehouse: 'W1',
    poDate: '2026-10-01', expectedDate: '2026-10-30', billRemark: 'Bill note', itemRemark: '',
    product: index ? `Received product ${index}` : expected.product, sku: index ? `RECEIVED-${index}` : '', quantity: 3, unit: '',
    status: index ? 'Pending Review' : 'Pending GR', displayStatus: index ? 'Pending Review' : 'Pending GR',
    billReceivingStarted: true, editableUnreceived: index === 0, editSnapshot: index ? null : { ...expected } }));

function runtime() {
    const elements = new Map(), notices = [], calls = [];
    let stored = fixture(), deny = false, rejectRefresh = false, rejectMutation = false, reads = 0, timers = [];
    function element(tag = 'div') {
        let markup = '', fields = [];
        const listeners = {}, classes = new Set();
        return { tagName: tag, value: '', innerText: '', dataset: {}, children: [], disabled: false,
            classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
            set innerHTML(value) {
                markup = String(value); fields = [];
                if (!markup) this.children = [];
                for (const match of markup.matchAll(/<(input|button|ul)\b([^>]*)>/g)) {
                    const field = element(match[1]), attrs = match[2];
                    field.value = attrs.match(/value="([^"]*)"/)?.[1] || '';
                    field.className = attrs.match(/class="([^"]*)"/)?.[1] || '';
                    field.disabled = /\bdisabled\b/.test(attrs);
                    field.readOnly = /\breadonly\b/.test(attrs);
                    field.parentElement = this;
                    fields.push(field);
                }
            }, get innerHTML() { return markup; },
            querySelector(selector) { return fields.find(field => selector[0] === '.' ? field.className.split(/\s+/).includes(selector.slice(1)) : field.tagName === selector) || null; },
            querySelectorAll() { return []; },
            closest() { return this.parentElement; },
            appendChild(child) { child.parentElement = this; this.children.push(child); },
            addEventListener(type, handler) { listeners[type] = handler; },
            dispatch(type) { listeners[type]?.call(this, { target: this }); },
            setAttribute() {}, reset() {}, focus() {},
            remove() { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); }
        };
    }
    const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const client = { async updatePO() { throw new Error('partial mode must never call whole-bill writer'); },
        async updateUnreceivedPO(payload) {
            calls.push(json(payload));
            if (rejectMutation) throw new Error('stale_po_unreceived_snapshot');
            stored = stored.map(row => {
                const item = payload.items.find(item => item.uid === row.uid);
                return item ? { ...row, product: item.product, sku: item.sku, quantity: item.quantity, unit: item.unit,
                    itemRemark: item.remark, editSnapshot: { ...row.editSnapshot, product: item.product, sku: item.sku,
                        quantity: item.quantity, unit: item.unit, remark: item.remark } } : row;
            });
            return { success: true, poId, updatedItemCount: payload.items.length };
        } };
    const context = vm.createContext({ document: { getElementById: get, createElement: element, addEventListener() {},
        querySelectorAll: selector => selector === '.create-po-item-row' ? get('create-po-items-container').children : [] },
        window: { location: { search: '', pathname: '/PO/' }, self: {}, top: {}, addEventListener() {},
            appSession: { token: 'fixture', identityId: 'fixture-owner', sessionVersion: 1, authorizationRevision: 'fixture' } },
        console: { ...console, warn() {} }, URL, URLSearchParams, AkraSupabasePO: client,
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        fetch: async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')) }),
        setTimeout(handler) { timers.push(handler); return timers.length; }, clearTimeout() {}, setInterval() {}, lucide: { createIcons() {} } });
    vm.runInContext(source, context);
    vm.runInContext('AppVersionGuard.start({ current: CURRENT_VERSION, readActions: [] });', context);
    context.can = () => !deny;
    context.showNotification = (message, type) => notices.push({ message, type });
    context.processDataAndRender = () => context.groupPOData();
    context.scheduleProductsBackground = () => {};
    context.readApiCall = async () => { reads++; return { success: !rejectRefresh, pendingPOs: json(stored), prList: [], vendors: [] }; };
    context.appData = { pendingPOs: json(stored), products: [{ sku: 'CORRECTED-SKU', name: 'Corrected fixture', unit: 'box', last_vendor: 'Other vendor', last_warehouse: 'W2' }] };
    context.groupPOData();
    return { context, get, notices, calls, stored: () => stored, reads: () => reads,
        open() { context.openEditUnreceivedPOForm(context.groupedPOs[0]); },
        submit() { return context.submitDirectPO({ preventDefault() {} }); },
        row() { return get('create-po-items-container').children[0]; },
        deny(value) { deny = value; }, rejectRefresh(value) { rejectRefresh = value; }, rejectMutation(value) { rejectMutation = value; },
        flushTimers() { const current = timers; timers = []; current.forEach(fn => fn()); } };
}

async function run() {
    let rt = runtime();
    rt.context.renderTab2_PO();
    const card = rt.get('po-container').children[0].innerHTML;
    assert.match(card, /openEditUnreceivedPOForm/);
    assert.match(card, /openEditPOForm[^\n]+btn-edit hidden/, 'whole-bill edit remains hidden');
    rt.context.openEditPOForm(rt.context.groupedPOs[0]);
    assert.equal(rt.get('create-po-items-container').children.length, 0, 'direct full editor opening is guarded');
    rt.open();
    assert.equal(rt.get('form-create-po').dataset.mode, 'edit-unreceived');
    assert.equal(rt.get('create-po-items-container').children.length, 1);
    assert.match(rt.get('modal-create-po-subtitle').innerText, /1 รายการ · ล็อกอีก 3 รายการ/);
    assert.match(rt.get('po-edit-locked-context').innerText, /วันที่สั่งซื้อ:/);
    for (const id of ['create-po-vendor', 'create-po-warehouse', 'create-po-expected-date', 'create-po-remark', 'create-po-add-item']) assert.equal(rt.get(id).disabled, true, `${id} locked`);
    assert.equal(rt.row().querySelector('button').disabled, true);
    assert.equal(rt.row().querySelector('.c-unit').readOnly, false);
    assert.match(rt.row().innerHTML, /วันที่ส่งรายการ: ไม่ระบุ \(คงเดิม\)/, 'raw NULL item date is not replaced by header date');
    rt.context.addCreatePoItemRow();
    assert.equal(rt.get('create-po-items-container').children.length, 1, 'add action cannot add a partial-mode row');
    const productInput = rt.row().querySelector('.c-product');
    productInput.value = 'Corrected'; productInput.dispatch('input'); rt.flushTimers();
    const suggestion = rt.row().querySelector('.suggestion-box').children[0];
    assert.ok(suggestion, 'actual autocomplete finds corrected catalog product');
    suggestion.onmousedown({ preventDefault() {} });
    assert.equal(rt.row().querySelector('.c-sku').value, 'CORRECTED-SKU');
    assert.equal(rt.row().querySelector('.c-unit').value, 'box');
    assert.equal(rt.get('create-po-vendor').value, 'Original vendor', 'autocomplete cannot change locked vendor');
    rt.get('create-po-warehouse').value = '';
    suggestion.onmousedown({ preventDefault() {} });
    assert.equal(rt.get('create-po-warehouse').value, '', 'autocomplete cannot fill locked warehouse');
    rt.get('create-po-remark').value = 'attempted header edit';
    rt.get('create-po-expected-date').value = '2027-01-01';
    rt.row().querySelector('.c-qty').value = '7';
    rt.row().querySelector('.c-item-remark').value = 'Corrected note';
    rt.context.appData.pendingPOs[0].editSnapshot.remark = 'later projection mutation';
    const lockedBefore = json(rt.stored().slice(1));
    await rt.submit();
    assert.deepEqual(rt.calls[0], { poId, expectedItemCount: 4, items: [{ uid, expected, sku: 'CORRECTED-SKU', product: 'Corrected fixture', quantity: 7, unit: 'box', remark: 'Corrected note' }] });
    assert.deepEqual(rt.stored().slice(1), lockedBefore);
    assert.equal(rt.stored().length, 4);
    assert.equal(rt.stored()[0].expectedDate, '2026-10-30', 'fixture mutation receives no date field');
    assert.ok(rt.reads() > 0);
    assert.equal(rt.context.appData.pendingPOs[0].sku, 'CORRECTED-SKU', 'UI uses authoritative read-back');
    await rt.submit(); assert.equal(rt.calls.length, 1, 'saved snapshot cannot be submitted again');

    for (const mutate of [row => { row.dataset.uid = 'foreign'; },
        (row, current) => { current.get('create-po-items-container').children = []; },
        (row, current) => { current.get('create-po-items-container').children.push(row); }]) {
        rt = runtime(); rt.open(); mutate(rt.row(), rt); await rt.submit();
        assert.equal(rt.calls.length, 0, 'changed/omitted/duplicate canonical UID set cannot save');
    }
    rt = runtime(); rt.open(); rt.deny(true); await rt.submit(); assert.equal(rt.calls.length, 0);
    rt = runtime(); rt.deny(true); rt.open(); assert.equal(rt.get('create-po-items-container').children.length, 0);
    rt = runtime(); rt.open(); rt.context.window.appSession.token = 'another-owner'; await rt.submit(); assert.equal(rt.calls.length, 0);
    rt = runtime(); rt.open(); vm.runInContext('poActiveLoadGeneration += 1;', rt.context); await rt.submit(); assert.equal(rt.calls.length, 0);
    rt = runtime(); rt.context.appData.pendingPOs.forEach(row => { row.editSnapshot = null; }); rt.context.groupPOData(); rt.context.renderTab2_PO();
    assert.doesNotMatch(rt.get('po-container').children[0].innerHTML, /openEditUnreceivedPOForm/, 'status alone never enables edit');
    rt = runtime(); rt.context.appData.pendingPOs[0].editableUnreceived = false; rt.context.groupPOData(); rt.open();
    assert.equal(rt.get('create-po-items-container').children.length, 0, 'snapshot alone never grants edit eligibility');
    rt = runtime(); rt.context.appData.pendingPOs = [rt.context.appData.pendingPOs[0]]; rt.context.groupPOData(); rt.open(); await rt.submit();
    assert.equal(rt.calls[0].expectedItemCount, 4, 'whole bill count survives a pending-only listing');
    assert.match(rt.get('modal-create-po-subtitle').innerText, /ล็อกอีก 3 รายการ/);
    rt = runtime(); rt.open(); rt.rejectMutation(true); const original = json(rt.context.appData.pendingPOs); await rt.submit();
    assert.deepEqual(json(rt.context.appData.pendingPOs), original, 'stale/GR-race rejection preserves frontend rows');
    assert.equal(rt.get('btn-submit-direct-po').disabled, false);
    rt = runtime(); rt.open(); rt.rejectRefresh(true); await rt.submit();
    assert.equal(rt.get('data-loader').classList.contains('hidden'), false);
    assert.equal(rt.get('data-loader-retry').classList.contains('hidden'), false);
    assert.match(rt.get('data-loader-text').innerText, /บันทึก PO แล้ว/);
    rt.open(); await rt.submit(); assert.equal(rt.calls.length, 1, 'failed read-back blocks stale reopening/resubmission');
    vm.runInContext('initialDataPrefetch = null;', rt.context);
    await rt.context.loadInitialData(true); assert.equal(rt.get('data-loader').classList.contains('hidden'), false);
    rt.rejectRefresh(false); await rt.context.loadInitialData(true); assert.equal(rt.get('data-loader').classList.contains('hidden'), true);
    rt.open(); assert.equal(rt.get('create-po-items-container').children.length, 1);
    rt.context.openPurchasingForm();
    assert.equal(rt.get('form-create-po').dataset.mode, undefined);
    assert.equal(rt.get('create-po-vendor').disabled, false);
    assert.equal(rt.get('create-po-add-item').disabled, false);
    assert.equal(rt.row().querySelector('button').disabled, false);
    rt.open();
    rt.context.appData.prList = [{ uid: 'pr-fixture', prId: 'pr-id', prNumber: 'PR-FIXTURE', rowNumber: 12,
        product: 'PR product', quantity: 2, unit: 'box', sku: 'PR-SKU', warehouse: 'W1' }];
    rt.context.approvePRToPOForm(12, 'pr-fixture', 'pr-id');
    assert.equal(rt.get('form-create-po').dataset.mode, undefined, 'PR form clears partial mode');
    assert.equal(rt.get('create-po-expected-date').disabled, false);
    assert.equal(rt.get('create-po-add-item').disabled, false);
    console.log('PASS partial PO frontend: server eligibility, locked context/headers/row set, autocomplete, exact raw snapshot/count/UID payload, permissions/owner/generation, rejection, authoritative reload and retry');

    const requests = []; let mutations = 0, saved = 0, resolve;
    global.window = { appSession: { token: 'bound-fixture' }, AkraModule: { embedded: true, getToken: () => window.appSession.token,
        runMutation: async operation => { mutations++; return operation(); }, markSaved() { saved++; } } };
    global.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return new Promise(done => { resolve = done; }); };
    try {
        const client = require('../js/supabase-po-client.js');
        const payload = { poId, expectedItemCount: 4, items: [{ uid, expected, sku: 'FIX', product: 'Fixture', quantity: 3, unit: 'box', remark: '' }] };
        const call = client.updateUnreceivedPO(payload, 'ignored');
        resolve({ ok: true, json: async () => ({ success: true, poId, updatedItemCount: 1 }) }); await call;
        assert.deepEqual(requests[0], { action: 'updateUnreceivedPO', data: payload, token: 'bound-fixture' });
        assert.equal(mutations, 1); assert.equal(saved, 1);
        const stale = client.updateUnreceivedPO(payload); window.appSession = { token: 'other-owner' };
        resolve({ ok: true, json: async () => ({ success: true }) }); await assert.rejects(stale, error => error.reason === 'session_changed');
        assert.equal(requests.length, 2, 'mutations never auto-retry'); assert.equal(saved, 1);
    } finally { delete global.window; delete global.fetch; }
    console.log('PASS partial PO client: additive authenticated bound mutation dispatch, busy/save guard and stale-owner rejection');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
