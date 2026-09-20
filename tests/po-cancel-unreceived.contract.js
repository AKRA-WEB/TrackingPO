const assert = require('node:assert/strict');

const clientPath = require('node:path').join(__dirname, '..', 'js', 'supabase-po-client.js');
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
