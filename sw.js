// Garage service worker: lets Garage install as an app and open with no signal.
// - Garage's own files and the time clock files it loads (../timeclock/tc-core.js and the rest) come from the network
//   first, so an update pushed to GitHub shows on the next open; with no signal (or no answer within a few seconds)
//   the copy saved last time is used.
// - The Firebase code and the fonts never change at the same address, so the saved copy is used first.
// - Firebase's own traffic (the database and sign-in) always goes straight to the network. With no signal the page
//   shows the data it saved on the device last time (garage.html, "saved copy").

const CACHE = "garage-v1";
const SHELL = [
    "./", "garage.html", "garage-core.js", "garage.webmanifest",
    "../timeclock/tc-core.js", "../timeclock/firebase-config.js",
    "../timeclock/icon-logo.png", "../timeclock/icon-192.png", "../timeclock/icon-512.png", "../timeclock/icon-maskable-512.png", "../timeclock/favicon.ico"
];
const LIBS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;
const WAIT_MS = 4000; // how long to wait for the network before using the saved copy

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
    event.respondWith(networkFirst(event));
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

async function networkFirst(event) {
    const req = event.request, url = req.url.split("?")[0].split("#")[0];
    const cache = await caches.open(CACHE);
    const download = fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "follow" })).then(async res => {
        // A redirected page (e.g. /garage → /garage/) can't be handed back or saved as-is
        if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
        if (res.ok && res.type === "basic") await cache.put(url, res.clone()).catch(() => {});
        return res;
    });
    event.waitUntil(download.catch(() => {}));
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), WAIT_MS));
    const first = await Promise.race([download.catch(() => null), timeout]);
    if (first && first.ok) return first;
    const saved = await cache.match(url, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match(new URL("garage.html", self.registration.scope).href) : null);
    if (saved) return saved;
    if (first) return first;
    return download; // nothing saved: wait for the network after all
}
