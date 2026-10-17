'use strict';
const id = number => `10000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
function fullBillFixture() {
  const poId = id(1);
  const names = ['แป้งสาลีอเนกประสงค์', 'นมสด UHT', 'สินค้ายังไม่ได้รับ', 'สินค้ารออนุมัติ', 'รายการยกเลิกยอดค้าง', 'สินค้าหน่วยรับต่างกัน', 'สินค้ารับเกิน', 'สินค้าขาดใบรับอ้างอิง', 'แป้งสาลีอเนกประสงค์'];
  const quantities = [10, 10, 5, 8, 6, 12, 5, 4, 2];
  const statuses = ['GR Completed', 'GR Completed', 'Pending GR', 'Pending Review', 'Cancelled', 'GR Completed', 'GR Completed', 'GR Completed', 'Pending GR'];
  const items = names.map((product_name, index) => ({ id: id(index + 10), po_id: poId, legacy_uid: `LEGACY-${index}`, sku: `SKU-${index + 1}`, product_name, po_qty: quantities[index], unit: 'ลัง', status: statuses[index], remark: index === 0 ? 'หมายเหตุสินค้าทดสอบ' : '', created_at: `2026-10-17T00:00:0${index}Z` }));
  const receipts = [], grItems = [];
  function add(lineIndex, number, status, gr_qty, unit = 'ลัง', timestamp = '2026-10-17T01:00:00Z') {
    const grId = id(number);
    receipts.push({ id: grId, po_id: poId, gr_number: `GR-FIXTURE-${number}`, receiving_event_id: id(900 + number), ata_date: '2026-10-17', status, created_at: timestamp, updated_at: timestamp });
    grItems.push({ id: id(number + 1000), gr_id: grId, po_item_id: items[lineIndex].id, ref_po_item_uid: items[lineIndex].legacy_uid, product_name: items[lineIndex].product_name, sku: items[lineIndex].sku, gr_qty, unit, is_extra: false });
  }
  add(0, 100, 'GR Completed', 10);
  add(0, 101, 'GR Completed', 9, 'ลัง', '2026-10-16T01:00:00Z');
  add(0, 102, 'Cancelled', 99, 'ลัง', '2026-10-17T02:00:00Z');
  add(1, 103, 'Completed', 3);
  add(3, 104, 'Pending Review', 2);
  add(5, 105, 'GR Completed', 1, 'กล่อง');
  add(6, 106, 'GR Completed', 7);
  grItems.push({ id: id(2000), gr_id: id(100), po_item_id: null, product_name: 'สินค้าเพิ่มเติมทดสอบ', sku: 'EXTRA-1', gr_qty: 1, unit: 'ชิ้น', is_extra: true });
  return { poId, request: { poId, poUids: [items[2].id], refPrUid: 'DIRECT-FIXTURE' }, purchase_orders: [{ id: poId, po_number: 'PO-FIXTURE-001', po_date: '2026-10-17', ref_pr_uid: 'DIRECT-FIXTURE', vendor_name: 'ผู้ขายจำลอง', warehouse: 'W3', status: 'Partial GR', remark: 'ข้อมูลจำลองสำหรับตรวจหน้าจอ ไม่ใช่ข้อมูลจริง', updated_at: '2026-10-17T01:00:00Z' }], purchase_order_items: items, goods_receipts: receipts, goods_receipt_items: grItems };
}
module.exports = { id, fullBillFixture };
