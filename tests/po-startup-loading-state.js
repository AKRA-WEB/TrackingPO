const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const loadingStart = html.indexOf('function showDataLoading(');
const loadingEnd = html.indexOf('\n    function showNotification', loadingStart);
const loadStart = html.indexOf('async function loadInitialData(');
const loadEnd = html.indexOf('\n    function processDataAndRender', loadStart);
assert.ok(loadingStart >= 0 && loadingEnd > loadingStart, 'PO loading-state functions must exist');
assert.ok(loadStart >= 0 && loadEnd > loadStart, 'PO loadInitialData must exist');

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); }
  };
}

const elements = new Map([
  ['data-loader', { classList: classList(['hidden']), setAttribute() {} }],
  ['data-loader-text', { innerText: '' }],
  ['data-loader-spinner', { classList: classList() }],
  ['data-loader-retry', { classList: classList(['hidden']) }]
]);
const rendered = [], calls = [];
elements.set('po-read-error', {classList:classList(['hidden']),innerHTML:''});
const context = vm.createContext({ console });
Object.assign(context, {
  document: { getElementById(id) { return elements.get(id) || { classList: classList(), innerText: '', setAttribute() {} }; } },
  appData: { prList: [], pendingPOs: [], grCompleted: [], apvList: [], vendors: [], products: [] },
  poMatchLoaded: false,
  poApvLoaded: false,
  poProductsLoaded: false,
  poSecondaryDataGeneration: 0,
  poActiveLoadGeneration: 0,
  poActiveDataRendered: false,
  initialDataPrefetch: null,
  PO_ACTIVE_CACHE_TTL: 1,
  PO_PRODUCTS_CACHE_TTL: 1,
  getCache() { return null; },
  setCache() {},
  showNotification() {},
  scheduleProductsBackground() {},
  processDataAndRender() { rendered.push(JSON.parse(JSON.stringify(context.appData.pendingPOs))); },
  async readApiCall(action,options) { calls.push({action,options}); return { success:false,reason:'internal_error',status:500,message:'fixture-private' }; }
});
const classifierSource=html.slice(html.indexOf('    function uiReadErrorState('),html.indexOf('    function poReadFailure('));
const escStart=html.indexOf('    function esc('),escEnd=html.indexOf('\n    }',escStart)+'\n    }'.length;
vm.runInContext(classifierSource+'\n'+html.slice(escStart,escEnd),context);
vm.runInContext(`${html.slice(loadingStart, loadingEnd)}\n${html.slice(loadStart, loadEnd)}`, context);

(async () => {
  const notice=elements.get('po-read-error');
  await vm.runInContext('loadInitialData(false)',context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'),true,'failed read stops its blocking spinner');
  assert.equal(notice.classList.contains('hidden'),false,'cold failure remains visibly actionable');
  assert.match(notice.innerHTML,/ระบบขัดข้องชั่วคราว/);assert.doesNotMatch(notice.innerHTML,/fixture-private/);
  assert.equal(rendered.length,0,'cold failed read must not render a successful empty list');
  assert.equal(calls.length,1);

  context.readApiCall=async(action,options)=>{calls.push({action,options});return {success:true,prList:[],pendingPOs:[],vendors:[]};};
  const retry=vm.runInContext('retryPoRead()',context);
  const duplicate=vm.runInContext('retryPoRead()',context);
  await Promise.all([retry,duplicate]);assert.equal(calls.length,2,'one retry consumes its action once');
  assert.equal(notice.classList.contains('hidden'),true,'successful retry clears persistent error');
  assert.equal(rendered.length,1);assert.deepEqual(rendered[0],[],'fresh successful empty may render');


  context.getCache=key=>key==='CACHE_PO_ACTIVE_V3'?{prList:[],pendingPOs:[],vendors:[]}:null;
  context.processDataAndRender=()=>{throw Error('corrupt cache shape');};
  context.poActiveDataRendered=false;
  context.readApiCall=async()=>({success:false,reason:'offline',message:'เชื่อมต่อไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง'});
  const renderedBeforeInvalid=rendered.length;
  await vm.runInContext('loadInitialData(false)',context);
  assert.equal(notice.classList.contains('hidden'),false,'corrupt cache and failed read keep a persistent error');
  assert.match(notice.innerHTML,/เชื่อมต่อไม่ได้/);assert.equal(rendered.length,renderedBeforeInvalid);
  await vm.runInContext('retryPoRead()',context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'),false,'manual read-back with no usable rendering preserves its blocking guard');
  assert.equal(elements.get('data-loader-spinner').classList.contains('hidden'),true,'blocking failure stops its spinner');
  assert.equal(elements.get('data-loader-retry').classList.contains('hidden'),false,'blocking read-back failure preserves retry');
  assert.match(elements.get('data-loader-text').innerText,/เชื่อมต่อไม่ได้/);
  assert.equal(rendered.length,renderedBeforeInvalid,'failure cannot manufacture an empty list');

  context.processDataAndRender=()=>rendered.push(JSON.parse(JSON.stringify(context.appData.pendingPOs)));
  context.getCache=key=>key==='CACHE_PO_ACTIVE_V3'?{prList:[],pendingPOs:[{uid:'cached'}],vendors:[]}:null;
  context.poActiveDataRendered=false;
  await vm.runInContext('loadInitialData(false)',context);
  assert.equal(elements.get('data-loader').classList.contains('hidden'),true,'cached UI remains available without a blocking spinner');
  assert.equal(notice.classList.contains('hidden'),false,'failed cached refresh stays retryable');
  assert.equal(context.appData.pendingPOs[0].uid,'cached','cached bill identity survives failed read');
  console.log('PASS PO startup loading: persistent inline failure/read retry/no false empty/corrupt cache/retained cached identity');
})().catch(error=>{console.error(error);process.exitCode=1;});
