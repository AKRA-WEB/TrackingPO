const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function run(adapter = fs.readFileSync(path.join(__dirname, '../js/supabase-po-client.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')) {
  const requests = [], pending = [];
  const ctx = { module: { exports: {} }, setTimeout, clearTimeout, AbortController,
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return new Promise(resolve => pending.push(resolve)); } };
  vm.createContext(ctx); new vm.Script(adapter).runInContext(ctx);
  const client = ctx.module.exports;
  const products = [{ sku: 'one', name: 'Coconut', unit: 'box', last_vendor: 'Vendor A' }, { sku: 'two', name: 'Flour', unit: 'bag' }];
  const response = { ok: true, json: async () => ({ success: true, products }) };
  const first = client.getProducts({}, 'session-a');
  const second = client.searchProducts('unknown', 30, 'session-a');
  assert.equal(requests.length, 1, 'concurrent catalog/bootstrap searches share transport');
  pending.shift()(response); await first; assert.equal((await second).length, 0);
  assert.equal((await client.searchProducts('unknown-again', 30, 'session-a')).length, 0);
  assert.equal(requests.length, 1, 'repeated no-match searches reuse catalog');
  assert.equal((await client.searchProducts('box vendor', 30, 'session-a'))[0].sku, 'one');
  assert.equal((await client.searchProducts('', 1, 'session-a')).length, 1);
  await assert.rejects(client.searchProducts('box', 30, ''), /เข้าสู่ระบบ/);
  assert.equal(requests.length, 1, 'missing token causes zero transport calls');
  const other = client.searchProducts('box', 30, 'session-b');
  assert.equal(requests.length, 2, 'catalog cannot cross sessions');
  pending.shift()({ ok: false, status: 403, json: async () => ({ message: 'denied' }) });
  await assert.rejects(other, /denied/);
  const retry = client.searchProducts('box', 30, 'session-b');
  assert.equal(requests.length, 3, 'failed requests are not cached'); pending.shift()(response); await retry;
  const refresh = client.getProducts({ bypassCache: true }, 'session-b');
  assert.equal(requests.length, 4); pending.shift()(response); await refresh;

  // Actual autocomplete closure; fake elements only exercise matching/state, not layout.
  const start = html.indexOf('    function setupProductAutocompleteForPO(');
  const end = html.indexOf('    function rejectPR(', start);
  const elements = () => { const classes = new Set(); return { value: '', children: [], listeners: {}, classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n) }, addEventListener(type, fn) { this.listeners[type] = fn; }, appendChild(child) { this.children.push(child); }, set innerHTML(value) { this.children = []; this.html = value; }, get innerHTML() { return this.html || ''; } }; };
  const box = elements(), input = elements(), deferred = [];
  input.parentElement = { querySelector: () => box };
  const fallback = { searchProducts: () => new Promise(resolve => deferred.push(resolve)) };
  const frontend = { appData: { products: [] }, poProductsLoaded: false, window: { AkraSupabasePO: fallback }, AkraSupabasePO: fallback,
    getSessionToken: () => 'fixture-token', esc: value => String(value), console,
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, document: { createElement: elements } };
  vm.createContext(frontend); new vm.Script(html.slice(start, end)).runInContext(frontend);
  frontend.setupProductAutocompleteForPO(input);
  input.value = 'old'; input.listeners.focus.call(input);
  input.value = 'new'; input.listeners.input.call(input);
  deferred[1]([{ sku: 'new', name: 'new', unit: 'box' }]); await new Promise(setImmediate);
  assert.equal(box.children.length, 1); assert.match(box.children[0].innerHTML, /new/);
  deferred[0]([{ sku: 'old', name: 'old' }]); await new Promise(setImmediate);
  assert.equal(box.children.length, 1); assert.match(box.children[0].innerHTML, /new/);
  input.value = 'pending'; input.listeners.input.call(input);
  input.value = ''; input.listeners.input.call(input);
  deferred[2]([{ name: 'pending' }]); await new Promise(setImmediate);
  assert.equal(box.children.length, 0, 'cleared input suppresses pending response');
  input.value = 'blurred'; input.listeners.input.call(input);
  input.listeners.blur.call(input);
  deferred[3]([{ name: 'blurred' }]); await new Promise(setImmediate);
  assert.equal(box.classList.contains('hidden'), true, 'blurred input cannot reopen from late response');
  input.value = 'old-session'; input.listeners.input.call(input);
  frontend.getSessionToken = () => 'different-session';
  deferred[4]([{ name: 'old-session' }]); await new Promise(setImmediate);
  assert.equal(box.children.length, 0, 'old session response cannot populate current suggestions');
  frontend.poProductsLoaded = true; frontend.appData.products = products;
  input.value = 'unknown'; input.listeners.input.call(input); await new Promise(setImmediate);
  assert.equal(deferred.length, 5, 'complete local catalog miss never starts fallback');
  return 'PASS PO catalog dedup/token isolation/retry/matching/limit, stale and empty query suppression';
}
module.exports = { run };
if (require.main === module) run().then(console.log).catch(error => { console.error(error); process.exitCode = 1; });
