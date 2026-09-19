const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(!html.includes('https://cdn.tailwindcss.com'), 'runtime Tailwind CDN must not remain on the critical path');
assert(html.includes('href="styles.css"'), 'precompiled Tailwind stylesheet must be linked');
assert(fs.existsSync(path.join(__dirname, '..', 'styles.css')), 'precompiled Tailwind stylesheet must exist');
const authStart = html.indexOf('init: async () =>');
const authEnd = html.indexOf('\n        bindEvents:', authStart);
const authSource = html.slice(authStart, authEnd);
const prefetchStart = authSource.indexOf("initialDataPrefetch = readApiCall('getInitialData'");
const verifyAwait = authSource.indexOf("await window.AkraModule.verifySession('app-tracking')");

assert(prefetchStart >= 0, 'AuthGuard must start the lean initial-data prefetch');
assert(verifyAwait >= 0 && verifyAwait < prefetchStart, 'current Main verification must precede embedded domain prefetch');
assert(authSource.includes("verifySession('app-tracking', tokenToVerify)"), 'standalone PO must verify the same centrally managed app id');
assert(!authSource.includes('roles=${encodeURIComponent(rolesParam)}'), 'PO token verification must not hardcode entry roles');

const loadStart = html.indexOf('async function loadInitialData(');
const loadEnd = html.indexOf('\n    function processDataAndRender', loadStart);
const loadSource = html.slice(loadStart, loadEnd);
assert(loadSource.includes('initialDataPrefetch') && loadSource.includes("readApiCall('getInitialData'"), 'loadInitialData must consume the auth-overlap prefetch');
assert(loadSource.includes('scheduleProductsBackground()'), 'large product catalog should be idle-scheduled after active readiness');

console.log('PASS po-startup-overlap: static verified-entry/deferred-products contract (behavior in Main purchasing-identity-state suite)');
