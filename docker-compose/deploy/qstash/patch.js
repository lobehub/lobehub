/* eslint-disable @typescript-eslint/no-require-imports, no-console */
const fs = require('node:fs');

const path = '/usr/local/lib/node_modules/hellostash/dist';
const fail = (msg) => {
  console.error('PATCH FAILED:', msg);
  process.exit(1);
};

// ---- 1. callbacks: single Content-Type -------------------------------------
const callbacksPath = `${path}/engine/callbacks.js`;
let callbacks = fs.readFileSync(callbacksPath, 'utf8');
const cbOld = `    const headers = {
        ...(input.opts?.forwardHeaders ?? {}),
        "Content-Type": ["application/json"]
    };`;
const cbNew = `    // A forwarded lowercase "content-type" and this hard-coded key are distinct
    // object keys, so both were sent and the receiver joined them into one
    // growing comma list. Keep exactly one.
    const headers = { ...(input.opts?.forwardHeaders ?? {}) };
    for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === "content-type")
            delete headers[name];
    }
    headers["Content-Type"] = ["application/json"];`;
if (!callbacks.includes(cbOld)) fail('callbacks anchor not found');
callbacks = callbacks.replace(cbOld, cbNew);
fs.writeFileSync(callbacksPath, callbacks);

// ---- 2. ssrf lookup: honour options.all ------------------------------------
const ssrfPath = `${path}/security/ssrf.js`;
let ssrf = fs.readFileSync(ssrfPath, 'utf8');
const ssrfOld = `                lookup(hostname, { ...options, all: true }, (err, addresses) => {
                    if (err)
                        return callback(err, "", 4);
                    const list = Array.isArray(addresses) ? addresses : [];
                    const allowed = list.filter((a) => isIpAllowed(policy, a.address));
                    if (allowed.length === 0 || !allowed[0]) {
                        return callback(new Error(\`destination "\${hostname}" resolves to a blocked address\`), "", 4);
                    }
                    callback(null, allowed[0].address, allowed[0].family);
                });`;
const ssrfNew = `                lookup(hostname, { ...options, all: true }, (err, addresses) => {
                    // undici calls this with all:true when autoSelectFamily is on
                    // (Node 20+ default) and then expects an address ARRAY back;
                    // returning a single address made every delivery fail with
                    // ERR_INVALID_IP_ADDRESS.
                    const wantAll = options?.all === true;
                    const failWith = (error) => (wantAll ? callback(error, []) : callback(error, "", 4));
                    if (err)
                        return failWith(err);
                    const list = Array.isArray(addresses) ? addresses : [];
                    const allowed = list.filter((a) => isIpAllowed(policy, a.address));
                    if (allowed.length === 0)
                        return failWith(new Error(\`destination "\${hostname}" resolves to a blocked address\`));
                    if (wantAll)
                        return callback(null, allowed);
                    callback(null, allowed[0].address, allowed[0].family);
                });`;
if (!ssrf.includes(ssrfOld)) fail('ssrf anchor not found');
ssrf = ssrf.replace(ssrfOld, ssrfNew);
fs.writeFileSync(ssrfPath, ssrf);

// ---- 3. publish: content-type must not be forwarded under a second casing ----
const headersPath = `${path}/core/headers.js`;
let coreHeaders = fs.readFileSync(headersPath, 'utf8');
const nonForwardableOld = `    "upgrade",
    "expect"
]);`;
const nonForwardableNew = `    "upgrade",
    "expect",
    // The SDK forwards the (lower-cased) content-type as Upstash-Forward-content-type
    // while the parser also writes the canonical "Content-Type" key; two object keys
    // meant two delivered headers that the receiver joined into a comma list growing
    // on every hop. Let the canonical key own the content type.
    "content-type"
]);`;
if (!coreHeaders.includes(nonForwardableOld)) fail('headers anchor not found');
coreHeaders = coreHeaders.replace(nonForwardableOld, nonForwardableNew);
fs.writeFileSync(headersPath, coreHeaders);

console.log('patches applied');
