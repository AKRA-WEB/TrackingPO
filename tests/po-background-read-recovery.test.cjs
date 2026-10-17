// Executes the actual inline runtime/client against fictional intercepted transport only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=process.env.PO_FOLLOWUP_BASELINE_DIR||path.join(__dirname,'..');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8'),client=fs.readFileSync(path.join(base,'js/supabase-po-client.js'),'utf8');
const writes=new Set(['createPO','updatePO','deleteBill','cancelUnreceivedPO','approvePR','rejectPR','closePO']);
const response=(status,data)=>({ok:status<400,status,json:async()=>data});
const tick=()=>new Promise(setImmediate);
async function settle(){await tick();await tick();}
function fixture({embedded=false}={}){
 const nodes=new Map(),storage=new Map(),calls=[],home=[],retired=[],notices=[],renders=[];
 function node(id){if(!nodes.has(id)){const classes=new Set(['hidden']);nodes.set(id,{id,value:'',dataset:{},innerText:'',innerHTML:'',disabled:false,classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},contains:n=>classes.has(n),toggle(n,on){on?classes.add(n):classes.delete(n);}},setAttribute(){},querySelectorAll:()=>[],addEventListener(){},focus(){}});}return nodes.get(id);}
 const user={identityId:'00000000-0000-4000-8000-000000000011',sessionVersion:1,authorizationRevision:1,token:'fixture',roles:['ADMIN']};
 let token='fixture',stamp='owner-one',mode='server',finish=null;
 const window={appSession:user,location:{search:'',pathname:'/PO/'},history:{replaceState(){}},addEventListener(){},AkraModule:{embedded,getToken:()=>token,sessionStamp:()=>stamp,runMutation:fn=>fn(),markSaved(){},home:()=>home.push(1),authRequired:()=>retired.push(1)}};
 const fetch=async(url,init)=>{
  const body=JSON.parse(init.body);calls.push(body);
  if(writes.has(body.action)){if(mode==='unknown-write')throw Object.assign(Error('fictional unresolved transport'),{name:'AbortError'});return response(200,{success:true,poId:'po-fixture',poUids:['item-new'],directBillRefUid:'DIRECT-fixture'});}
  if(mode==='defer')return new Promise(resolve=>{finish=resolve;});
  if(mode==='cancel')throw Object.assign(Error('intentional cancellation'),{name:'AbortError'});
  if(mode==='network')throw new TypeError('fictional offline detail');
  if(mode==='denied')return response(403,{success:false,reason:'permission_denied',message:'private-fixture-detail'});
  if(mode==='expired')return response(401,{success:false,reason:'invalid_or_expired_token'});
  if(mode==='server')return response(500,{success:false,reason:'internal_error',message:'private-fixture-detail'});
  return response(200,body.action==='getProducts'?{success:true,products:[{sku:'NEW',name:'Fictional fresh product',unit:'ชิ้น'}]}:{success:true,prList:[],pendingPOs:[{uid:'item-fresh',poId:'po-fixture'}],vendors:[],grCompleted:[{uid:'match-fresh'}],apvList:[{uid:'apv-fresh'}]});
 };
 const context=vm.createContext({window,self:window,document:{getElementById:node,querySelectorAll:()=>[],createElement:node,addEventListener(){},body:node('body')},fetch,AbortController,Error,TypeError,URL,URLSearchParams,Date,Intl,setTimeout,clearTimeout,setInterval(){},lucide:{createIcons(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},console:{warn(){},error(){},log(){}}});
 vm.runInContext(client,context);context.AkraSupabasePO=window.AkraSupabasePO;
 for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())vm.runInContext(m[1],context);
 vm.runInContext('AppVersionGuard.blockIfStale=async()=>false;',context);
 context.showNotification=(message,type)=>notices.push({message,type});
 const actualProcessDataAndRender=context.processDataAndRender;
 context.processDataAndRender=()=>renders.push('active');context.renderTab1_PR=()=>renders.push('catalog');
 context.groupGRData=()=>{context.groupedMatchData={fixture:{}};};context.groupAPVData=()=>{context.groupedAPVData={fixture:{}};};
 context.renderTab3_Match=()=>{node('match-container').innerHTML='Fresh Match fixture';renders.push('match');};context.renderTab4_APV=()=>{node('apv-container').innerHTML='Fresh APV fixture';renders.push('apv');};
 context.appData={prList:[{uid:'pr-fixture',prId:'pr-fixture'}],pendingPOs:[{uid:'item-cached',poId:'po-cached'}],grCompleted:[{uid:'match-cached'}],apvList:[{uid:'apv-cached'}],products:[{sku:'OLD',name:'Fictional cached product'}],vendors:['Fictional vendor']};
 context.poActiveDataRendered=true;
 node('create-po-vendor').value='typed vendor';node('create-po-remark').value='typed note';
 return{context,node,calls,home,retired,notices,renders,window,storage,renderActive(){context.groupPOData=()=>{context.groupedPOs=[];};context.renderTab2_PO=()=>renders.push('po');context.setupVendorAutocomplete=()=>{};return actualProcessDataAndRender();},set mode(value){mode=value;},get finish(){return finish;},changeOwner(){window.appSession={...user,identityId:'00000000-0000-4000-8000-000000000022',token:'new-fixture'};token='new-fixture';stamp='owner-two';},changeToken(){window.appSession.token='fresh-fixture';token='fresh-fixture';stamp='fresh-stamp';}};
}
const payload={poId:'po-fixture',prId:'pr-fixture',poUids:['item-cached'],expectedItemCount:1,items:[{uid:'item-cached',product:'Fictional product',quantity:1,unit:'ชิ้น'}],vendor:'Fictional vendor',warehouse:'W1'};
for(const action of ['createPO','deletePO','cancelUnreceivedPO','approvePR','rejectPR','closePO']){
 test(action+' confirmed write stays successful and failed background read gets one persistent read-only retry',async()=>{
  const f=fixture();const saved=await f.context.apiAction(action,payload);await settle();
  assert.equal(saved.success,true);assert.equal(f.calls.filter(c=>writes.has(c.action)).length,1);
  const alert=f.node('po-read-error');assert.equal(alert.classList.contains('hidden'),false,'confirmed-write read failure is persistent');
  assert.match(alert.innerHTML,/บันทึกสำเร็จแล้ว/);assert.match(alert.innerHTML,/ระบบขัดข้องชั่วคราว/);assert.doesNotMatch(alert.innerHTML,/private-fixture/);
  f.mode='success';const retry=f.context.retryPoRegionRead('active');f.context.retryPoRegionRead('active');await retry;
  assert.equal(f.calls.filter(c=>writes.has(c.action)).length,1,'retry must not replay the confirmed write');
  assert.equal(f.calls.filter(c=>c.action==='getInitialData').length,2,'one failed read then one recovery read');
  assert.equal(alert.classList.contains('hidden'),true);assert.equal(f.context.appData.pendingPOs[0].uid,'item-fresh');
  assert.equal(f.node('create-po-remark').value,'typed note');
 });
}
test('updatePO retains its blocking authoritative-readback guard and retry sends no second write',async()=>{
 const f=fixture();assert.equal((await f.context.apiAction('updatePO',payload)).success,true);
 assert.equal(f.node('data-loader').classList.contains('hidden'),false);assert.match(f.node('data-loader-text').innerText,/บันทึก PO แล้ว/);
 f.mode='success';await f.node('data-loader-retry').onclick();
 assert.equal(f.calls.filter(c=>c.action==='updatePO').length,1);assert.equal(f.node('data-loader').classList.contains('hidden'),true);
});
test('catalog warm failure retains products and typed form, retry only refreshes catalog and clears both catalog notices',async()=>{
 const f=fixture();await f.context.loadProductsBackground(true);
 assert.equal(f.context.appData.products[0].sku,'OLD');assert.equal(f.node('create-po-vendor').value,'typed vendor');
 for(const id of ['po-products-error','po-create-products-error']){assert.equal(f.node(id).classList.contains('hidden'),false);assert.match(f.node(id).innerHTML,/ระบบขัดข้องชั่วคราว/);}
 f.mode='success';const retry=f.context.retryPoRegionRead('catalog');f.context.retryPoRegionRead('catalog');await retry;
 assert.deepEqual(f.calls.map(c=>c.action),['getProducts','getProducts']);assert.equal(f.context.appData.products[0].sku,'NEW');
 assert.equal(f.calls.at(-1).data.bypassCache,true);assert.equal(f.node('po-products-error').classList.contains('hidden'),true);assert.equal(f.node('po-create-products-error').classList.contains('hidden'),true);
 assert.equal(f.node('create-po-vendor').value,'typed vendor');assert.equal(f.node('create-po-remark').value,'typed note');
});
for(const [region,method,field,notice,container] of [['match','ensureMatchLoaded','grCompleted','po-match-error','match-container'],['apv','ensureApvLoaded','apvList','po-apv-error','apv-container']]){
 test(region+' warm failure preserves rows and independent safe retry only reads the failed section',async()=>{
  const f=fixture();f.node(container).innerHTML='Existing '+region+' rows';await f.context[method](true);
  assert.equal(f.node(container).innerHTML,'Existing '+region+' rows');assert.match(f.node(notice).innerHTML,/ระบบขัดข้องชั่วคราว/);
  assert.equal(f.context.appData[field][0].uid,region+'-cached');f.mode='success';const retry=f.context.retryPoRegionRead(region);f.context.retryPoRegionRead(region);await retry;
  assert.equal(f.calls.length,2);assert(f.calls.every(c=>c.action==='getInitialData'));assert(f.calls.every(c=>c.data[region==='match'?'includeMatch':'includeAPV']===true));
  assert.equal(f.node(notice).classList.contains('hidden'),true);assert.equal(f.context.appData[field][0].uid,region+'-fresh');
 });
}
for(const [region,method,field,notice] of [['active','loadInitialDataInBackground','pendingPOs','po-read-error'],['catalog','loadProductsBackground','products','po-products-error'],['match','ensureMatchLoaded','grCompleted','po-match-error'],['apv','ensureApvLoaded','apvList','po-apv-error']]){
 test(region+' permission denial clears only denied cached rows and retry routes home without a domain request',async()=>{
  const f=fixture();const badges={active:['badge-pr','badge-po','po-metric-pr','po-metric-po'],catalog:[],match:['badge-match','po-metric-match'],apv:['badge-apv','po-metric-apv']}[region];
  badges.forEach(id=>f.node(id).innerText='7');f.mode='denied';await f.context[method](true);assert.equal(f.context.appData[field].length,0);assert.match(f.node(notice).innerHTML,/ไม่มีสิทธิ์ใช้ส่วนนี้/);
  badges.forEach(id=>assert.equal(f.node(id).innerText,'—','denied region cannot retain a private cached count'));
  if(region!=='active')assert.equal(f.context.appData.pendingPOs[0].uid,'item-cached','unrelated permitted rows remain');
  const before=f.calls.length;await f.context.retryPoRegionRead(region);assert.equal(f.home.length,1);assert.equal(f.calls.length,before);
 });
 test(region+' stale success/401 and same-object token refresh cannot publish old rows or retire the new owner',async()=>{
  for(const outcome of ['success','401','token']){const f=fixture({embedded:true});f.mode='defer';const pending=f.context[method](true);while(!f.finish)await tick();
   if(outcome==='token')f.changeToken();else f.changeOwner();const original=f.context.appData[field][0];
   f.finish(response(outcome==='401'?401:200,outcome==='401'?{success:false,reason:'invalid_or_expired_token'}:{success:true,products:[{sku:'stale'}],pendingPOs:[{uid:'stale'}],grCompleted:[{uid:'stale'}],apvList:[{uid:'stale'}],prList:[],vendors:[]}));await pending;
   assert.equal(f.context.appData[field][0],original);assert.equal(f.node(notice).classList.contains('hidden'),true);assert.equal(f.retired.length,0);
  }
 });
 test(region+' intentional cancellation is not a network warning',async()=>{const f=fixture();f.mode='cancel';await f.context[method](true);assert.equal(f.node(notice).classList.contains('hidden'),true);assert.equal(f.calls.length,1);});
 test(region+' cold network failure stays accurate and simultaneous reads coalesce before one safe retry',async()=>{
  const f=fixture();f.context.appData[field]=[];f.mode='network';await Promise.all([f.context[method](true),f.context[method](true)]);
  assert.equal(f.calls.length,2,'one logical read with its existing bounded transport retry');assert.equal(f.context.appData[field].length,0);
  assert.match(f.node(notice).innerHTML,/เชื่อมต่อไม่ได้/);assert.doesNotMatch(f.node(notice).innerHTML,/fictional offline detail/);
  f.mode='success';await f.context.retryPoRegionRead(region);assert.equal(f.calls.length,3);assert.equal(f.node(notice).classList.contains('hidden'),true);
 });
 test(region+' verified current expired session retires the embedded owner without offering domain retry',async()=>{
  const f=fixture({embedded:true});f.mode='expired';await f.context[method](true);assert.equal(f.retired.length,1);
  assert.equal(f.node(notice).classList.contains('hidden'),true);assert.equal(f.context.retryPoRegionRead(region),undefined);assert.equal(f.calls.length,1);
 });
}
test('a newer confirmed-write read supersedes older read success or failure',async()=>{
 for(const outcome of ['success','server']){const f=fixture();f.mode='defer';const old=f.context.loadInitialDataInBackground(true,true);while(!f.finish)await tick();const finishOld=f.finish;
  const latest=f.context.loadInitialDataInBackground(true,true);while(f.finish===finishOld)await tick();const finishLatest=f.finish;
  finishLatest(response(200,{success:true,prList:[],pendingPOs:[{uid:'latest-confirmed'}],vendors:[]}));await latest;
  finishOld(response(outcome==='server'?500:200,outcome==='server'?{success:false,reason:'internal_error'}:{success:true,prList:[],pendingPOs:[{uid:'old-confirmed'}],vendors:[]}));await old;
  assert.equal(f.context.appData.pendingPOs[0].uid,'latest-confirmed');assert.equal(f.node('po-read-error').classList.contains('hidden'),true);assert.equal(f.calls.length,2);
 }
});
test('old background active read cannot overwrite a newer manual active refresh',async()=>{
 const f=fixture();f.mode='defer';const old=f.context.loadInitialDataInBackground(true);while(!f.finish)await tick();const finish=f.finish;
 f.mode='success';f.context.scheduleProductsBackground=()=>{};await f.context.loadInitialData(true);finish(response(200,{success:true,prList:[],pendingPOs:[{uid:'stale-background'}],vendors:[]}));await old;
 assert.equal(f.context.appData.pendingPOs[0].uid,'item-fresh');
});
test('manual active permission denial clears warm rows, counts and cache while preserving the catalog',async()=>{
 for(const warm of [true,false]){
  const f=fixture();f.context.poActiveDataRendered=warm;f.context.scheduleProductsBackground=()=>{};
  f.context.setCache('CACHE_PO_ACTIVE_V3',{prList:[{uid:'private-pr'}],pendingPOs:[{uid:'private-po'}],vendors:['Private vendor']});
  f.node('pr-container').innerHTML='Private PR';f.node('po-container').innerHTML='Private PO';
  f.mode='denied';await f.context.loadInitialData(true);
  assert.equal(f.context.appData.pendingPOs.length,0,'manual 403 cannot retain private active rows');
  assert.equal(f.context.appData.prList.length,0);assert.equal(f.context.appData.vendors.length,0);
  assert.equal(f.context.getCache('CACHE_PO_ACTIVE_V3',60000),null);
  assert.equal(f.node('pr-container').innerHTML,'');assert.equal(f.node('po-container').innerHTML,'');
  for(const id of ['badge-pr','badge-po','po-metric-pr','po-metric-po'])assert.equal(f.node(id).innerText,'—');
  assert.equal(f.context.appData.products[0].sku,'OLD','catalog remains separately authorized');
  const before=f.calls.length;
  if(warm)await f.context.retryPoRead();else await f.node('data-loader-retry').onclick();
  assert.equal(f.home.length,1);assert.equal(f.calls.length,before,'denial recovery never replays a read or write');
 }
});
for(const [region,method,field,badge,metric] of [['match','ensureMatchLoaded','grCompleted','badge-match','po-metric-match'],['apv','ensureApvLoaded','apvList','badge-apv','po-metric-apv']]){
 test(region+' settled failure remains retryable after manual header refresh without replaying a write',async()=>{
  const f=fixture();f.context.scheduleProductsBackground=()=>{};await f.context[method](true);
  f.mode='success';await f.context.loadInitialData(true);const count=f.calls.length;
  await f.context.retryPoRegionRead(region);
  assert.equal(f.calls.length,count+1,'header refresh cannot strand the failed secondary retry');
  assert.equal(f.context.appData[field][0].uid,region+'-fresh');assert.equal(f.calls.filter(c=>writes.has(c.action)).length,0);
 });
 test(region+' failed-read retry can replace its invalidated pending retry after header refresh',async()=>{
  for(const oldOutcome of ['success','server']){
   const f=fixture();f.context.scheduleProductsBackground=()=>{};await f.context[method](true);
   f.mode='defer';const old=f.context.retryPoRegionRead(region);while(!f.finish)await tick();const finishOld=f.finish;
   f.mode='success';await f.context.loadInitialData(true);const count=f.calls.length;
   await f.context.retryPoRegionRead(region);const replacementCalls=f.calls.length;
   finishOld(response(oldOutcome==='success'?200:500,oldOutcome==='success'?{success:true,grCompleted:[{uid:'obsolete'}],apvList:[{uid:'obsolete'}]}:{success:false,reason:'internal_error'}));await old;
   assert.equal(replacementCalls,count+1,'an invalidated pending read cannot strand its visible retry');
   assert.equal(f.context.appData[field][0].uid,region+'-fresh');assert.equal(f.calls.filter(c=>writes.has(c.action)).length,0);
  }
 });
 test(region+' denied count remains unknown through active render and header refresh until an authorized section read',async()=>{
  const f=fixture();f.context.scheduleProductsBackground=()=>{};f.mode='denied';await f.context[method](true);
  f.renderActive();assert.equal(f.node(badge).innerText,'—');assert.equal(f.node(metric).innerText,'—');
  f.mode='success';await f.context.loadInitialData(true);f.renderActive();
  assert.equal(f.node(badge).innerText,'—');assert.equal(f.node(metric).innerText,'—');
  const count=f.calls.length;await f.context.retryPoRegionRead(region);assert.equal(f.home.length,1);assert.equal(f.calls.length,count);
  await f.context[method](true);assert.equal(f.node(badge).innerText,1);assert.equal(f.node(metric).innerText,1);
 });
}
test('failed region retries remain fenced after owner or same-object token changes',async()=>{
 for(const [region,method] of [['active','loadInitialDataInBackground'],['catalog','loadProductsBackground'],['match','ensureMatchLoaded'],['apv','ensureApvLoaded']])for(const change of ['owner','token']){
  const f=fixture();await f.context[method](true);if(change==='owner')f.changeOwner();else f.changeToken();
  const count=f.calls.length;await f.context.retryPoRegionRead(region);assert.equal(f.calls.length,count);assert.equal(f.home.length,0);assert.equal(f.retired.length,0);
 }
});
for(const [region,method,field,notice] of [['match','ensureMatchLoaded','grCompleted','po-match-error'],['apv','ensureApvLoaded','apvList','po-apv-error'],['active','loadInitialDataInBackground','pendingPOs','po-read-error']]){
 test(region+' replacement read starts before invalidated pending read settles and retains its own success/error retry',async()=>{
  for(const latestOutcome of ['success','server'])for(const oldOutcome of ['success','server']){
   const f=fixture();f.context.appData[field]=[];f.context.scheduleProductsBackground=()=>{};f.mode='defer';
   const old=f.context[method](true);while(!f.finish)await tick();const finishOld=f.finish;
   f.mode='success';await f.context.loadInitialData(true);f.mode='defer';
   const latest=f.context[method](true);await settle();const finishLatest=f.finish;
   const regionCalls=f.calls.filter(c=>c.action==='getInitialData'&&(region==='active'?!c.data.includeCompleted:c.data[region==='match'?'includeMatch':'includeAPV']===true)).length;
   const rows=uid=>({success:true,prList:[],pendingPOs:[{uid}],vendors:[],grCompleted:[{uid}],apvList:[{uid}]});
   if(finishLatest!==finishOld){finishLatest(response(latestOutcome==='server'?500:200,latestOutcome==='server'?{success:false,reason:'internal_error'}:rows('replacement-'+region)));await latest;}
   finishOld(response(oldOutcome==='server'?500:200,oldOutcome==='server'?{success:false,reason:'internal_error'}:rows('obsolete-'+region)));await old;await latest;
   assert.equal(regionCalls,region==='active'?3:2,'new read must start after manual invalidation while obsolete read is still pending');
   if(latestOutcome==='success'){assert.equal(f.context.appData[field][0].uid,'replacement-'+region);assert.equal(f.node(notice).classList.contains('hidden'),true);}
   else{assert.equal(f.node(notice).classList.contains('hidden'),false,'obsolete settlement cannot erase the current failed-read notice');assert.match(f.node(notice).innerHTML,/ระบบขัดข้องชั่วคราว/);
    const count=f.calls.length;f.mode='success';await f.context.retryPoRegionRead(region);assert.equal(f.calls.length,count+1);assert.equal(f.node(notice).classList.contains('hidden'),true);
   }
   assert.equal(f.calls.filter(c=>writes.has(c.action)).length,0);
  }
 });
}
test('unknown mutation outcome creates no confirmed-read recovery or automatic write replay',async()=>{
 const f=fixture();f.mode='unknown-write';const result=await f.context.apiAction('createPO',payload);await settle();
 assert.equal(result.success,false);assert.equal(f.calls.length,1);assert.equal(f.node('po-read-error').classList.contains('hidden'),true);
 assert.equal(f.context.retryPoRegionRead('active'),undefined);assert.equal(f.calls.length,1);
});
test('superseded update readback cannot close or reset the new owner Direct PO form',async()=>{
 const f=fixture({embedded:true});f.mode='defer';const form=f.node('form-create-po');
 Object.assign(form.dataset,{mode:'edit',oldUids:'["item-cached"]',poId:'po-fixture'});f.node('create-po-warehouse').value='W1';
 const fields={'.c-product':{value:'Fictional product'},'.c-qty':{value:'1'},'.c-sku':{value:'OLD'},'.c-unit':{value:'ชิ้น'},'.c-item-remark':{value:'typed item'}};
 f.context.document.querySelectorAll=selector=>selector==='.create-po-item-row'?[{dataset:{uid:'item-cached'},querySelector:s=>fields[s]}]:[];
 let closed=0;f.context.closeCreatePoModal=()=>closed++;
 const pending=f.context.submitDirectPO({preventDefault(){}});while(!f.finish)await tick();
 f.changeOwner();f.node('btn-submit-direct-po').innerText='New owner button';f.node('create-po-remark').value='new owner draft';
 f.finish(response(200,{success:true,prList:[],pendingPOs:[{uid:'old-readback'}],vendors:[]}));await pending;
 assert.equal(closed,0,'stale readback continuation cannot close the new owner form');
 assert.equal(f.node('btn-submit-direct-po').innerText,'New owner button','stale continuation cannot reset new owner controls');
 assert.equal(f.node('create-po-remark').value,'new owner draft');assert.equal(f.calls.filter(c=>c.action==='updatePO').length,1);
});
