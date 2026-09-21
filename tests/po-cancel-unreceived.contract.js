const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const clientPath = path.join(__dirname, '..', 'js', 'supabase-po-client.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
delete require.cache[require.resolve(clientPath)];

const requests = [];
global.fetch = async (url, init) => {
  requests.push({ url, body: JSON.parse(init.body) });
  return {
    ok: true,
    async json() { return { success: true, message: 'ยอดคงเหลือถูกยกเลิกแล้ว' }; }
  };
};

(async () => {
  assert.match(html, /function cancelUnreceivedPO\(request\)/, 'PO UI must expose remainder-cancellation confirmation flow');
  assert.match(html, /cancelableUnreceivedItems/, 'PO UI must derive cancellation candidates from server-projected item state');
  assert.match(html, /รายการที่รับเข้า GR แล้วจะไม่ถูกลบ/, 'PO confirmation must state that received GR items are preserved');

  const client = require(clientPath);
  assert.equal(typeof client.cancelUnreceivedPO, 'function', 'PO client must expose remainder-cancellation mutation');

  const payload = {
    poId: '10000000-0000-0000-0000-000000000001',
    poUids: ['10000000-0000-0000-0000-00000000000b'],
    expectedItemCount: 2
  };
  const result = await client.cancelUnreceivedPO(payload, 'main-token');

  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.action, 'cancelUnreceivedPO');
  assert.deepEqual(requests[0].body.data, payload);
  assert.equal(requests[0].body.token, 'main-token');
  console.log('PASS po-cancel-unreceived-contract: client dispatches authenticated remainder cancellation');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
