const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(process.env.PO_TEST_BASELINE_HTML||path.join(__dirname,'..','index.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function deletePO'));
const nodes=new Map();
function node(id='') { const classes=new Set(), events={}; return {id,value:'',innerText:'',innerHTML:'',dataset:{},events,children:[],classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle(n,v){v?classes.add(n):classes.delete(n);}},addEventListener:(n,f)=>{events[n]=f;},setAttribute(){},appendChild(n){this.children.push(n);},querySelectorAll:()=>id==='custom-confirm-modal'?[get('btn-confirm-cancel'),get('btn-confirm-action')]:[],focus(){this.focused=true;document.activeElement=this;}}; }
const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
const documentEvents={};const document={getElementById:get,createElement:node,querySelectorAll:()=>[],addEventListener(name,fn){(documentEvents[name] ||= []).push(fn);},activeElement:node('original-button')};
const context=vm.createContext({document,console,window:{location:{search:''},addEventListener(){},appSession:{token:'fixture'}},URLSearchParams,setTimeout(){},clearTimeout(){},setInterval(){},lucide:{createIcons(){}}});
vm.runInContext(source,context);
let denied=false;const calls=[],notices=[];context.can=()=>!denied;context.showNotification=message=>notices.push(message);context.apiAction=async(action,payload)=>{calls.push({action,payload});return {success:true};};
const rows=[{uid:'item-a',poId:'po-a',poNumber:'PO-A',refPrUid:'DIRECT-A',product:'สินค้าทดสอบ',vendor:'ผู้ขาย',warehouse:'W2',quantity:3,status:'GR Completed',billReceivingStarted:true},{uid:'item-b',poId:'po-a',poNumber:'PO-A',refPrUid:'DIRECT-A',product:'รายการที่ยังไม่ได้รับ',vendor:'ผู้ขาย',warehouse:'W2',quantity:2,status:'Pending GR',cancelableUnreceived:true}];
context.appData={pendingPOs:rows,grCompleted:[],apvList:[]};
const request={poId:'po-a',poUids:['item-a','item-b'],refPrUid:'DIRECT-A',expectedItemCount:2,legacyBill:false};
const bill={poId:'po-a',poNumber:'PO-A',vendor:'ผู้ขาย',warehouse:'W2',items:[
  {poItemId:'item-a',product:'สินค้าทดสอบ',orderedQty:3,receivedQty:3,outstandingQty:0,unit:'ลัง',status:'received'},
  {poItemId:'item-b',product:'รายการที่ยังไม่ได้รับ',orderedQty:2,receivedQty:0,outstandingQty:2,unit:'ลัง',status:'pending'},
  {poItemId:'received-sibling',product:'รายการรับแล้วที่ไม่มีในการ์ดค้างรับ',orderedQty:4,receivedQty:4,outstandingQty:0,unit:'ลัง',status:'received'}
]};
const reads=[];let response=async()=>({success:true,bill});
context.getSessionToken=()=>context.window.appSession?.token;
context.readApiCall=async(action,payload)=>{reads.push({action,payload});return response();};
(async()=>{
assert.equal(typeof context.openPoBillDetail,'function','detail action must be available for received bills without opening edit');
await context.openPoBillDetail(request);
assert.match(get('po-bill-detail-content').innerHTML,/สินค้าทดสอบ/);
assert.match(get('po-bill-detail-content').innerHTML,/รายการรับแล้วที่ไม่มีในการ์ดค้างรับ/);
assert.match(get('po-bill-detail-content').innerHTML,/รับครบแล้ว/);assert.match(get('po-bill-detail-content').innerHTML,/ยังไม่ได้รับ/);
assert.equal(reads[0].action,'getPoBillDetail');assert.equal(JSON.stringify(reads[0].payload.poUids),JSON.stringify(request.poUids));
assert.equal(get('modal-create-po').classList.contains('flex'),false,'read-only detail does not enable ordinary edit');
get('po-bill-detail-delete').focus();get('po-bill-detail-delete').onclick();
assert.equal(document.activeElement,get('btn-confirm-cancel'),'foreground confirmation focuses safe cancellation');
const key=(key,shiftKey=false)=>{const event={key,shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};for(const listener of documentEvents.keydown||[])listener(event);};
key('Tab',true);assert.equal(document.activeElement,get('btn-confirm-action'),'Shift+Tab wraps inside confirmation');
key('Tab');assert.equal(document.activeElement,get('btn-confirm-cancel'),'Tab wraps inside confirmation');
key('Escape');assert.equal(document.activeElement,get('po-bill-detail-delete'),'Cancel returns to the detail action');
get('btn-confirm-action').events.click();assert.equal(calls.length,0,'cancel dispatches no mutation');
await context.openPoBillDetail(request);get('po-bill-detail-delete').onclick();get('btn-confirm-action').events.click();get('btn-confirm-action').events.click();
assert.equal(calls.length,1,'confirm dispatches one intended delete');assert.equal(calls[0].action,'deletePO');
assert.equal(JSON.stringify(calls[0].payload),JSON.stringify(request),'canonical whole-bill identity/count payload is unchanged');
await new Promise(setImmediate);
assert.equal(context.deletePO.inFlight,false,'successful delete settles before independent rejection checks');
denied=true;await context.openPoBillDetail(request);assert.equal(get('po-bill-detail-delete').classList.contains('hidden'),true);get('po-bill-detail-delete').onclick();assert.equal(calls.length,1,'permission rejection cannot mutate');
assert.match(notices.at(-1),/ไม่มีสิทธิ์ลบบิลสั่งซื้อ/);
assert.equal(context.deletePO.inFlight,false);
denied=false;context.deletePO({...request,expectedItemCount:3});assert.equal(calls.length,1,'stale count is rejected before mutation');
assert.match(notices.at(-1),/ข้อมูลบิลไม่เป็นปัจจุบัน/);
assert.equal(get('custom-confirm-modal').classList.contains('hidden'),true,'stale count cannot arm confirmation');
get('btn-confirm-action').events.click();assert.equal(calls.length,1);
context.cancelUnreceivedPO({poId:'po-a',poUids:['item-b'],expectedItemCount:2,expectedUnreceivedCount:1});get('btn-confirm-action').events.click();
assert.equal(calls[1].action,'cancelUnreceivedPO');assert.deepEqual(Array.from(calls[1].payload.poUids),['item-b']);
response=async()=>({success:false,reason:'permission_denied',status:403});
await context.openPoBillDetail(request);assert.match(get('po-bill-detail-content').innerHTML,/ไม่มีสิทธิ์/);assert.doesNotMatch(get('po-bill-detail-content').innerHTML,/สินค้าทดสอบ/);
assert.equal(get('po-bill-detail-delete').classList.contains('hidden'),true);
response=async()=>({success:true,bill});await get('po-bill-detail-retry').onclick();assert.match(get('po-bill-detail-content').innerHTML,/รายการในบิลทั้งหมด/);
response=async()=>({success:true,bill:{...bill,poId:'another-po'}});await context.openPoBillDetail(request);assert.match(get('po-bill-detail-content').innerHTML,/โหลดบิลฉบับเต็มไม่ได้/);
let resolve;response=()=>new Promise(done=>{resolve=done;});
const pending=context.openPoBillDetail(request);assert.match(get('po-bill-detail-content').innerHTML,/กำลังโหลด/);
context.closePoBillDetail();resolve({success:true,bill});await pending;assert.equal(get('po-bill-detail-content').innerHTML,'','closed dialog ignores late read');
const old=context.openPoBillDetail(request);const resolveOld=resolve;
response=async()=>({success:true,bill:{...bill,poNumber:'NEWER'}});await context.openPoBillDetail(request);resolveOld({success:true,bill});await old;
assert.match(get('po-bill-detail-title').innerText,/NEWER/,'old read cannot overwrite newer open');
response=()=>new Promise(done=>{resolve=done;});const stale=context.openPoBillDetail(request);
context.window.appSession={token:'new-session'};resolve({success:true,bill});await stale;
assert.equal(get('po-bill-detail-content').innerHTML,'','old owner data is discarded');assert.equal(get('po-bill-detail-modal').classList.contains('hidden'),true);
const escaped=context.renderPoBillDetail({...bill,items:[{...bill.items[0],product:'<img onerror=alert(1)>',remark:'<script>bad</script>'}]});assert.doesNotMatch(escaped,/<img|<script>/);
console.log('PASS PO bill detail: received read-only availability, cancel zero/confirm one, exact delete identity/count, denied/stale rejection, independent unreceived cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
