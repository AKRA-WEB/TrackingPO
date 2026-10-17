'use strict';
// Complete actual handler/controller, fictional in-memory tables, no network or business writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { backendPath } = require('./helpers/backend-source.cjs');
const { id, fullBillFixture } = require('./fixtures/po-full-bill.cjs');
const source = stripTypeScriptTypes(fs.readFileSync(backendPath('supabase', 'functions', 'po-api', 'index.ts'), 'utf8').replace(/^import\b.*$/gm, ''));
function runtime(db, options = {}) {
  let handler;
  const calls = [], counts = {};
  const user = { id: 'fixture', identityId: id(9999), roles: ['PURCHASER'], apps: ['app-tracking'], perms: { 'app-po': ['viewPO'] }, tokenVersion: 2, sessionVersion: 1, authorizationRevision: 'fixture', exp: Math.floor(Date.now() / 1000) + 3600, ...options.user };
  const context = vm.createContext({ URL, URLSearchParams, Headers, Request, Response, TextEncoder, crypto: globalThis.crypto, console: { error() {} },
    verifyMainJwt: async token => token === 'invalid' ? null : user,
    mainSessionRpc: () => ({ name: 'fixture_current_session', params: {} }),
    supabaseServiceKey: () => 'fictional', supabaseServiceHeaders: () => ({}),
    Deno: { env: { get: key => ({ MAIN_JWT_SECRET: 'fictional', SUPABASE_URL: 'https://fixture.invalid', PO_ALLOWED_ORIGINS: 'https://fixture.invalid' }[key] || '') }, serve: fn => { handler = fn; } },
    fetch: async (url, init = {}) => {
      const parsed = new URL(url), table = parsed.pathname.split('/rest/v1/')[1];
      calls.push({ table, method: init.method || 'GET', params: parsed.searchParams });
      if (table === 'rpc/fixture_current_session') return new Response(JSON.stringify({ valid: options.sessionValid !== false }));
      assert.equal(init.method || 'GET', 'GET', 'detail performs no business mutation');
      assert.ok(Object.hasOwn(db, table), `unexpected table/network ${table}`);
      options.onRead?.(table, counts[table] = (counts[table] || 0) + 1, db);
      let rows = structuredClone(db[table]);
      const eq = parsed.searchParams.get(table === 'purchase_orders' ? 'id' : 'po_id');
      if (eq) rows = rows.filter(row => row[table === 'purchase_orders' ? 'id' : 'po_id'] === eq.slice(3));
      if (table === 'goods_receipt_items') {
        const ids = parsed.searchParams.get('gr_id').slice(4, -1).split(',');
        rows = rows.filter(row => ids.includes(row.gr_id));
      }
      const order = parsed.searchParams.get('order');
      if (order) rows.sort((a, b) => {
        for (const term of order.split(',')) {
          const [key, direction, nulls] = term.split('.');
          if (a[key] === b[key]) continue;
          if (nulls === 'nullslast' && (a[key] == null || b[key] == null)) return a[key] == null ? 1 : -1;
          const cmp = String(a[key] || '').localeCompare(String(b[key] || ''));
          if (cmp) return direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
      const total = rows.length, range = new Headers(init.headers).get('range').split('-').map(Number);
      rows = rows.slice(range[0], range[1] + 1);
      return new Response(JSON.stringify(rows), { headers: options.noCount ? {} : { 'content-range': `0-${Math.max(0, rows.length - 1)}/${total}` } });
    }
  });
  vm.runInContext(source, context);
  return { context, calls, async read(data = db.request, token = 'fixture-token') {
    const response = await handler(new Request('https://fixture.invalid/po-api', { method: 'POST', headers: { Origin: 'https://fixture.invalid' }, body: JSON.stringify({ action: 'getPoBillDetail', data, token }) }));
    return { status: response.status, body: await response.json() };
  } };
}
async function run() {
  let db = fullBillFixture(), rt = runtime(db), result = await rt.read();
  assert.equal(result.status, 200);
  const lines = result.body.bill.items;
  assert.equal(lines.length, 9, 'pending card subset resolves the entire canonical PO');
  assert.deepEqual(lines.map(line => line.status), ['received', 'partial', 'pending', 'in_progress', 'cancelled', 'unknown', 'received', 'unknown', 'pending']);
  assert.equal(lines[0].receivedQty, 10, 'old/cancelled receipts never add to the current quantity');
  assert.equal(lines[0].receipts.filter(row => row.current).length, 1);
  assert.equal(lines[1].outstandingQty, 7);
  assert.equal(lines[3].receivedQty, 0); assert.equal(lines[3].inProgressQty, 2); assert.equal(lines[3].outstandingQty, 8);
  assert.equal(lines[4].cancelledQty, 6); assert.equal(lines[4].outstandingQty, 0);
  assert.equal(lines[5].receivedQty, 1); assert.equal(lines[5].receivedUnit, 'กล่อง'); assert.equal(lines[5].outstandingQty, null);
  assert.equal(lines[6].overReceivedQty, 2); assert.equal(lines[6].outstandingQty, 0);
  assert.equal(lines[7].receivedQty, null); assert.equal(lines[7].outstandingQty, null, 'missing completed receipt is unknown');
  assert.equal(lines[8].outstandingQty, 2, 'duplicate product names stay separate');
  assert.equal(result.body.bill.extras.length, 1); assert.ok(result.body.bill.extras[0].grId);
  assert.equal(rt.calls.filter(call => call.method === 'GET').length, 8, 'bounded double collection');
  for (const call of rt.calls.filter(call => call.method === 'GET')) assert.ok(call.params.get('id') || call.params.get('po_id') || call.params.get('gr_id'), 'every domain query is identity scoped');
  db = fullBillFixture(); db.goods_receipt_items[0].ref_po_item_uid = db.purchase_order_items[2].legacy_uid;
  result = await runtime(db).read(); assert.equal(result.body.bill.items[2].receivedQty, 0, 'canonical link wins over conflicting legacy ref');
  db.goods_receipt_items[0].po_item_id = null; db.goods_receipt_items[0].ref_po_item_uid = db.purchase_order_items[0].legacy_uid;
  assert.equal((await runtime(db).read()).body.bill.items[0].receivedQty, 10, 'legacy fallback only without canonical link');
  db = fullBillFixture(); db.goods_receipts.find(row => row.id === id(104)).status = 'Draft GR';
  result = await runtime(db).read(); assert.equal(result.body.bill.items[3].receivedQty, 0); assert.equal(result.body.bill.items[3].inProgressQty, 2);
  db = fullBillFixture(); db.goods_receipts.find(row => row.id === id(100)).updated_at = null;
  assert.equal((await runtime(db).read()).body.bill.items[0].receivedQty, 9, 'updated_at NULLS LAST matches current writer ordering');
  db = fullBillFixture(); db.purchase_order_items[2].unit = '';
  assert.equal((await runtime(db).read()).body.bill.items[2].outstandingQty, null, 'unknown unit does not imply a comparable remainder');
  db = fullBillFixture(); db.goods_receipt_items[0].po_item_id = id(999);
  assert.equal((await runtime(db).read()).status, 409, 'unresolved receipt cannot produce a claimed full bill');
  db = fullBillFixture(); db.goods_receipt_items.push({ ...db.goods_receipt_items[0], id: id(999) });
  result = await runtime(db).read(); assert.equal(result.body.bill.items[0].outstandingQty, null, 'ambiguous current rows are never summed');
  db = fullBillFixture(); result = await runtime(db, { onRead(table, count, current) { if (table === 'goods_receipt_items' && count === 2) current.goods_receipt_items[0].gr_qty = 4; } }).read();
  assert.equal(result.status, 409); assert.equal(result.body.reason, 'stale_po_bill_detail_changed');
  db = fullBillFixture(); assert.equal((await runtime(db, { noCount: true }).read()).status, 409);
  db.purchase_order_items = Array.from({ length: 501 }, (_, i) => ({ ...db.purchase_order_items[0], id: id(20000 + i) }));
  assert.equal((await runtime(db).read()).status, 409, 'oversized bill is not silently truncated');
  db = fullBillFixture(); assert.equal((await runtime(db).read({ ...db.request, poUids: [id(999)] })).status, 409);
  assert.equal((await runtime(db).read({ ...db.request, refPrUid: 'OTHER-BILL' })).status, 409);
  assert.equal((await runtime(db).read({ ...db.request, poId: 'bad)' })).status, 404);
  for (const options of [{ user: { perms: { 'app-po': [] }, roles: ['ADMIN'] } }, { user: { apps: [] } }]) {
    rt = runtime(db, options); assert.equal((await rt.read()).status, 403); assert.equal(rt.calls.length, 0);
  }
  rt = runtime(db, { sessionValid: false }); assert.equal((await rt.read()).status, 401); assert.equal(rt.calls.filter(call => call.method === 'GET').length, 0);
  rt = runtime(db); assert.equal((await rt.read(db.request, 'invalid')).status, 401); assert.equal(rt.calls.length, 0);
  rt = runtime(db); assert.equal((await rt.read(db.request, '')).status, 401); assert.equal(rt.calls.length, 0);
  console.log('PASS full PO bill read: exact identity, all lines, receipt states/units/history, bounds/consistency, denied session and zero business writes');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runtime };
