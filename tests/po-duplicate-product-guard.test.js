const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
const mainScript = inlineScripts[3]?.[1];
assert.ok(mainScript, 'PO main inline script must be available');

const elements = new Map();
const rows = [];
const notifications = [];
let apiCalls = 0;

function element(id, value = '') {
  const result = {
    id,
    value,
    innerText: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    dataset: {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  elements.set(id, result);
  return result;
}

const documentMock = {
  getElementById(id) {
    return elements.get(id) || element(id);
  },
  createElement(tag) {
    return element(`dynamic-${tag}-${Math.random()}`);
  },
  querySelectorAll(selector) {
    return selector === '.create-po-item-row' ? rows : [];
  },
  addEventListener() {}
};

for (const [id, value] of [
  ['create-po-vendor', 'Vendor A'],
  ['create-po-warehouse', 'W1'],
  ['create-po-expected-date', ''],
  ['create-po-remark', ''],
  ['form-create-po', ''],
  ['btn-submit-direct-po', 'บันทึกสั่งซื้อ'],
  ['c-ref-pr-row', '']
]) element(id, value);

function makeRow({ product, sku, quantity = '1', unit = 'ชิ้น' }) {
  const fields = {
    '.c-product': element(`product-${rows.length}`, product),
    '.c-sku': element(`sku-${rows.length}`, sku),
    '.c-qty': element(`qty-${rows.length}`, quantity),
    '.c-unit': element(`unit-${rows.length}`, unit),
    '.c-item-remark': element(`remark-${rows.length}`, '')
  };
  return { querySelector(selector) { return fields[selector] || null; } };
}

const context = vm.createContext({
  window: {
    location: { href: 'https://akra-web.github.io/TrackingPO/', pathname: '/TrackingPO/', search: '' },
    history: { replaceState() {} },
    self: {},
    top: {},
    appSession: { roles: ['ADMIN'], perms: { 'app-po': ['createPO'] } },
    AkraSupabasePO: {
      async createPO() {
        apiCalls += 1;
        return { success: true, poUids: [] };
      }
    }
  },
  document: documentMock,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  URL,
  URLSearchParams,
  console,
  setTimeout: (fn) => fn(),
  clearTimeout() {},
  setInterval() {},
  lucide: { createIcons() {} }
});

(async () => {
vm.runInContext(mainScript, context);
context.showNotification = (message, type) => notifications.push({ message, type });
context.apiAction = async () => {
  apiCalls += 1;
  return { success: true };
};
context.showDataLoading = () => {};
context.hideDataLoading = () => {};
context.processDataAndRender = () => {};
context.loadInitialDataInBackground = () => {};
context.appData = { pendingPOs: [] };

const duplicates = context.findDuplicateDirectPoItems([
  { product: '  แป้ง  สาลี ', sku: 'SKU-1' },
  { product: 'แป้ง สาลี', sku: 'SKU-2' },
  { product: 'อีกสินค้า', sku: ' SKU-1 ' }
]);
assert.equal(duplicates.length, 2, 'normalized name and SKU duplicates must both be detected');
assert.equal(duplicates[0].previousIndex, 0, 'name duplicate must point to the first matching row');
assert.equal(duplicates[1].previousIndex, 0, 'SKU duplicate must point to the first matching row');

rows.push(
  makeRow({ product: 'น้ำตาล ทราย', sku: 'SUGAR-1' }),
  makeRow({ product: ' น้ำตาล  ทราย ', sku: 'SUGAR-2' })
);
await context.submitDirectPO({ preventDefault() {} });
assert.equal(apiCalls, 0, 'duplicate Direct PO rows must not call the mutation API');
assert.match(notifications.at(-1)?.message || '', /ซ้ำ/, 'operator must receive a duplicate warning');

console.log('PASS po-duplicate-product-guard: Direct PO rejects normalized name and SKU duplicates before mutation');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
