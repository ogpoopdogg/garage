// Garage service worker: lets Garage install as an app and open with no signal.
// - Garage's own files and the time clock files it loads (../timeclock/tc-core.js and the rest) open from the copy
//   saved on the device, at once, whatever the signal. Each time, the newest ones are downloaded in the background
//   and saved for next time; when one of them changed, the page is told, and it offers to reload ("Garage was
//   updated"). Nothing saved yet (the first visit): from the network.
// - The Firebase code and the fonts never change at the same address, so the saved copy is used first.
// - Firebase's own traffic (the database and sign-in) always goes straight to the network. With no signal the page
//   shows the data it saved on the device last time (garage.html, "saved copy").

const CACHE = "garage-v3";
const SHELL = [
    "./", "garage.html", "garage-core.js", "garage.webmanifest",
    "../timeclock/tc-core.js", "../timeclock/firebase-config.js",
    "logo.svg", "favicon-32.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"
];
const LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;

self.addEventListener("install", event => {
    // Save the app (a missing file doesn't stop the install) and the Firebase code in the version tc-core.js uses
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: "no-cache" })).catch(() => {})));
        try {
            const core = await cache.match("../timeclock/tc-core.js");
            const m = core && (await core.text()).match(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\//);
            if (m) await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-database.js"].map(f => cache.match(m[0] + f).then(hit => hit || cache.add(m[0] + f)).catch(() => {})));
        } catch (e) { /* saved the first time the page loads them instead */ }
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k.startsWith("garage-") && k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    if (LIBS.test(req.url)) { event.respondWith(savedFirst(req)); return; }
    if (new URL(req.url).origin !== self.location.origin) return;
    event.respondWith(savedThenUpdate(event));
});

async function savedFirst(req) {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(req.url, { ignoreVary: true });
    if (saved) return saved;
    const fresh = await fetch(req);
    // A font stylesheet comes back unreadable ("opaque"), which is fine to save and hand back as-is
    if (fresh.ok || fresh.type === "opaque") cache.put(req.url, fresh.clone()).catch(() => {});
    return fresh;
}

// The saved copy at once, and the newest one downloaded and saved for next time
async function savedThenUpdate(event) {
    const req = event.request, url = req.url.split("?")[0].split("#")[0];
    const cache = await caches.open(CACHE);
    const saved = await cache.match(url, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match(new URL("garage.html", self.registration.scope).href) : null);
    const savedText = saved && /\.(html|js)$|\/$/.test(url) ? saved.clone().text().catch(() => "") : null; // read before it's handed to the page
    const download = fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "follow" })).then(async res => {
        // A redirected page (e.g. /garage → /garage/) can't be handed back or saved as-is
        if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
        if (res.ok && res.type === "basic") {
            if (savedText) {
                // Tell the page when the app itself changed, so it can offer to reload
                const [was, now] = await Promise.all([savedText, res.clone().text()]).catch(() => ["", ""]);
                if (was && now && was !== now) tellPages();
            }
            await cache.put(url, res.clone()).catch(() => {});
        }
        return res;
    });
    event.waitUntil(download.catch(() => {}));
    if (saved) return saved;
    return download; // nothing saved yet: wait for the network
}
let told = false, updatedAt = 0;
// A page that just opened asks whether its own files changed while it was loading (it may have missed the message)
self.addEventListener("message", event => {
    const d = event.data;
    if (d && d.type === "garage-check" && event.source && updatedAt && updatedAt >= (Number(d.since) || 0) - 1000) event.source.postMessage({ type: "garage-updated" });
});
async function tellPages() {
    updatedAt = Date.now();
    if (told) return;
    told = true;
    setTimeout(() => { told = false; }, 10000);
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "garage-updated" });
}
