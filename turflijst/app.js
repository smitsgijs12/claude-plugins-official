/* Turflijst app. Data goes through window.backend (backend.js). */
(function () {
  "use strict";
  var BK = window.backend || null;

  // ---------- constants ----------
  var DRINKS = [
    { key: "mixjes",   label: "Mixjes",   one: "mixje",   many: "mixjes",   drink: true },
    { key: "biertjes", label: "Biertjes", one: "biertje", many: "biertjes", drink: true },
    { key: "shotjes",  label: "Shotjes",  one: "shotje",  many: "shotjes",  drink: true },
    { key: "stelz",    label: "Stelz",    one: "stelz",   many: "stelz",    drink: true },
    { key: "wijn",     label: "Wijn",     one: "wijn",    many: "wijn",     drink: true },
    { key: "barfjes",  label: "Barfjes",  one: "barfje",  many: "barfjes",  drink: false }
  ];
  var DEFAULT_POINTS = { mixjes: 1, biertjes: 1, shotjes: 1, stelz: 1, wijn: 1, barfjes: -3 };
  var ODDS = [
    { key: "zeker",     label: "Gaat vast gebeuren", ja: 1.3,  nee: 4 },
    { key: "waarsch",   label: "Waarschijnlijk",     ja: 1.65, nee: 3 },
    { key: "gelijk",    label: "50/50",              ja: 2,    nee: 2 },
    { key: "onwaarsch", label: "Onwaarschijnlijk",   ja: 3,    nee: 1.65 },
    { key: "nooit",     label: "Gebeurt nooit",      ja: 4,    nee: 1.3 }
  ];
  var STAKES = [5, 10, 25, 50];
  var MAX_MEMBERS = 15, MAX_PER_COUNTER = 30, NIGHT_CUTOFF_HOUR = 7, FEED_PAGE = 25;
  var KEYS = { draft: "turflijst-draft", stale: "turflijst-stale", outbox: "turflijst-outbox", me: "turflijst-me", claimed: "turflijst-me-claimed", seen: "turflijst-feed-seen", tab: "turflijst-tab" };
  // Counted drinks not registered within this long, and from another night, belong to that night.
  var STALE_MS = 2 * 3600 * 1000;
  var ICON = {
    cheers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3.2 6.2l6-1.6 1.6 6.6a3.1 3.1 0 0 1-2.3 3.8l-.3.1a3.1 3.1 0 0 1-3.8-2.3z"/><path d="M6.9 14.9l1.3 5.1M5.7 20.6l4.3-1.1"/><path d="M20.8 6.2l-6-1.6-1.6 6.6a3.1 3.1 0 0 0 2.3 3.8l.3.1a3.1 3.1 0 0 0 3.8-2.3z"/><path d="M17.1 14.9l-1.3 5.1M18.3 20.6l-4.3-1.1"/><path d="M12 1.8v1.6M9.8 2.4l.6 1.2M14.2 2.4l-.6 1.2"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9.5L5 19.8V16H4z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5a2.8 2.8 0 0 0 3 4M17 6h2.5a2.8 2.8 0 0 1-3 4M12 14v4M8 20.5h8"/></svg>',
    ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="10" r="6.5"/><path d="M7 20.5h10M8.5 17.5h7M9.3 8.6A3 3 0 0 1 12 6.6"/></svg>'
  };

  // ---------- state ----------
  var S = {
    db: null, user: null, assets: null, room: null, uid: null,
    canWrite: null, readOnly: false, noStore: false, signedOut: false, pastUids: [],
    members: [], entries: [], challenges: [], bets: [], events: [], points: {},
    loaded: { members: false, entries: false }, slow: false, storeError: "", ver: 0,
    meId: null, forId: null, counts: zero(), caption: "", photo: null, draftNight: null, draftAt: null,
    stale: [], pending: null, outbox: [], entriesSrv: [], sync: null, lastRegAt: 0,
    tab: "tellen", board: "vanavond", boardMode: "punten", spelTab: "uitdagingen",
    profileId: null, prevTab: "tellen", prevScroll: 0, feedLimit: FEED_PAGE, feedSeen: "",
    editing: null, editValue: "", focusEdit: false, confirmKey: null, confirmAt: 0,
    whoShownAt: 0, whoHl: null, nearOk: "",
    openComments: {}, commentDrafts: {}, stakeSel: {}, voteOpen: {}, online: {},
    pointsDirty: false, pointsDraft: null, pointsConflict: false, pointsMeta: null,
    dirty: false, compareId: null, tables: { trend: false, nights: false }
  };
  var localIds = {};
  // Our own name: the one whose server copy we last saw with our login on it (so a later empty
  // login means someone unlinked it), the last one we saw at all, and claim retries.
  var claimedId = null, knownMe = null, claimTryAt = 0, claimBusy = false;

  // ---------- helpers ----------
  function noop() {}
  function zero() { var o = {}; DRINKS.forEach(function (d) { o[d.key] = 0; }); return o; }
  function $(id) { return document.getElementById(id); }
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v; // only static icon markup from ICON / tally()
      else if (k === "on") Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // The night a moment belongs to: before 07:00 on the clock it is still the night before. By the
  // local clock, not by subtracting 7 hours, so the night that the clocks change also ends at 07:00.
  function nightKey(date) {
    var d = new Date(date.getTime());
    if (d.getHours() < NIGHT_CUTOFF_HOUR) d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function parseDay(key) { var p = key.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function nightLabel(key) { return parseDay(key).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }); }
  function timeOf(iso) { var d = new Date(iso); return isNaN(d) ? "" : pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function ago(iso) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var now = new Date(), mins = (now - d) / 60000;
    if (mins < 1) return "zojuist";
    if (mins < 60) return Math.floor(mins) + " min geleden";
    if (sameDay(d, now)) return "vandaag " + timeOf(iso);
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(d, y)) return "gisteren " + timeOf(iso);
    return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }) + " " + timeOf(iso);
  }
  function total(counts) { return DRINKS.reduce(function (s, d) { return s + (d.drink ? (counts[d.key] || 0) : 0); }, 0); }
  function anyCount(counts) { return DRINKS.some(function (d) { return (counts[d.key] || 0) > 0; }); }
  function word(d, n) { return n === 1 ? d.one : d.many; }
  function breakdown(counts, withBarf) {
    var parts = [];
    DRINKS.forEach(function (d) { var n = counts[d.key] || 0; if (n > 0 && (d.drink || withBarf)) parts.push(n + " " + word(d, n)); });
    return parts.join(" · ");
  }
  function drinksWord(n) { return n === 1 ? "drankje" : "drankjes"; }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function trySet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function hhmm(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function clampInt(v, lo, hi, dflt) { var n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }
  function clampNum(v, lo, hi, dflt) { var n = Number(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }
  // Never cuts an emoji in half at the length limit.
  function str(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, "") : ""; }
  function isoOr(v) { return typeof v === "string" && !isNaN(new Date(v)) ? v : null; }
  function strOrNull(v) { return typeof v === "string" && v ? v : null; }
  function validNight(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function cleanCounts(raw) {
    var o = zero();
    if (raw && typeof raw === "object") DRINKS.forEach(function (d) { o[d.key] = clampInt(raw[d.key], 0, 99, 0); });
    return o;
  }
  function memberById(id) { for (var i = 0; i < S.members.length; i++) if (S.members[i].id === id) return S.members[i]; return null; }
  function memberByUid(uid) { if (!uid) return null; for (var i = 0; i < S.members.length; i++) if (S.members[i].uid === uid) return S.members[i]; return null; }
  function nameOf(id) { var m = memberById(id); return m ? m.name : "Onbekend"; }
  // A uid this device used before (a new login after the old one was lost) still counts as "me".
  function isMyUid(u) { return !!u && (u === S.uid || S.pastUids.indexOf(u) >= 0); }
  function takenByOther(m) { return !!(m && m.uid && S.uid && !isMyUid(m.uid)); }
  function canWriteNow() { return !!S.db && !S.readOnly && S.canWrite !== false; }
  function canSocial() { return canWriteNow() && !!S.meId && !!memberById(S.meId); }
  function nowIso() { return new Date().toISOString(); }
  function needNow() { return S.members.length >= 4 ? 2 : 1; }
  function pv(k) { var v = S.points[k]; return typeof v === "number" && isFinite(v) ? v : DEFAULT_POINTS[k]; }
  function ptsOf(counts) { var s = 0; DRINKS.forEach(function (d) { s += (counts[d.key] || 0) * pv(d.key); }); return s; }
  function fmtDelta(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
  function fmtPts(n) { return fmtDelta(n) + " pnt"; }
  function fmtOdds(x) { return String(Math.round(x * 100) / 100).replace(".", ","); }
  // What a correct guess wins on top of the stake. Rounded on whole cents first, so 10 × 0,65 is
  // 6,5 and becomes +7 (plain floating point makes it 6,4999… and +6).
  function betWin(amount, odds) { return Math.round(Math.round(amount * (odds - 1) * 100) / 100); }
  function hue(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 360; }
  // What you see as one character (an emoji, a flag, a letter with an accent), in a list.
  var GRAPH = null;
  try { if (typeof Intl !== "undefined" && Intl.Segmenter) GRAPH = new Intl.Segmenter("nl", { granularity: "grapheme" }); } catch (e) {}
  function chars(s) {
    s = String(s || "");
    try { if (GRAPH) return Array.from(GRAPH.segment(s), function (x) { return x.segment; }); } catch (e) {}
    return Array.from ? Array.from(s) : s.split("");
  }
  // A letter or digit (any script). Built at run time: a browser without \p{} support then falls back to a-z.
  var LETTER = /[A-Za-z0-9\u00C0-\u024F]/, LETTERS = /[A-Za-z0-9\u00C0-\u024F]/g;
  try { LETTER = new RegExp("[\\p{L}\\p{N}]", "u"); LETTERS = new RegExp("[\\p{L}\\p{N}]", "gu"); } catch (e) {}
  // Initials from letters only, so "🍺 Jan" is J and "Sem 🍻" is SE. A name without letters shows its first emoji.
  function initials(name) {
    var s = String(name || "").trim();
    var firsts = s.split(/\s+/).map(function (w) { var m = w.match(LETTER); return m ? m[0] : null; }).filter(Boolean);
    if (!firsts.length) return chars(s)[0] || "?";
    var b = firsts.length > 1 ? firsts[firsts.length - 1] : ((s.match(LETTERS) || [])[1] || "");
    return (firsts[0] + b).toUpperCase();
  }
  function avatar(id, size) {
    var a = el("span", { class: "av" + (size ? " av-" + size : ""), "aria-hidden": "true", text: initials(nameOf(id)) });
    var h = hue(id || "x");
    a.style.background = "hsl(" + h + ", 42%, 30%)";
    a.style.color = "hsl(" + h + ", 85%, 88%)";
    if (isOnline(id)) a.classList.add("on");
    return a;
  }
  function nameBtn(id, cls) {
    return el("button", { type: "button", class: "nm-btn" + (cls ? " " + cls : ""), text: nameOf(id), on: { click: function () { openProfile(id); } } });
  }
  function listNames(ids, max) {
    max = max || 3;
    var sorted = ids.slice().sort(function (a, b) { return (b === S.meId) - (a === S.meId); });
    var names = sorted.map(function (id) { return id === S.meId ? "jou" : nameOf(id); });
    if (names.length <= max) return names.length > 1 ? names.slice(0, -1).join(", ") + " en " + names[names.length - 1] : (names[0] || "");
    var rest = names.length - max;
    return names.slice(0, max).join(", ") + " en " + rest + " " + (rest === 1 ? "ander" : "anderen");
  }
  function tally(n) {
    var shown = Math.min(n, 25), groups = Math.ceil(shown / 5), w = Math.max(1, groups) * 20, parts = [];
    for (var g = 0; g < groups; g++) {
      var inGroup = Math.min(5, shown - g * 5), x0 = g * 20 + 2;
      for (var s = 0; s < Math.min(4, inGroup); s++) parts.push('<path d="M' + (x0 + s * 4) + ' 2v12"/>');
      if (inGroup === 5) parts.push('<path d="M' + (x0 - 2) + ' 12L' + (x0 + 15) + ' 4"/>');
    }
    return '<svg width="' + w + '" height="16" viewBox="0 0 ' + w + ' 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' + parts.join("") + "</svg>";
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // One write at a time per document.
  var chains = {};
  function q(path, fn) {
    var p = (chains[path] || Promise.resolve()).catch(noop).then(function () { return withRetry(fn); });
    chains[path] = p; return p;
  }
  function withRetry(fn) {
    return fn().catch(function (e) {
      if (e && e.code === "unavailable") return new Promise(function (r) { setTimeout(r, 400 + Math.random() * 600); }).then(fn);
      throw e;
    });
  }

  // ---------- toast ----------
  // toast(text, action, isErr). action: a function (its button says "Ongedaan maken") or
  // { label, fn } for another button. isErr: something went wrong; red, and it stays longer.
  // A newer toast never silently takes away an undo that is still on screen: that one moves to
  // a second line (#toast-prev) until its own time is up.
  var toastTimer = null, toastUndo = null, toastEnd = 0, toastMsg = "", toastLabel = "";
  var prevTimer = null, prevUndo = null;
  function hideToast() { clearTimeout(toastTimer); $("toast").hidden = true; toastUndo = null; }
  function hidePrev() { clearTimeout(prevTimer); $("toast-prev").hidden = true; prevUndo = null; }
  function keepPrev(text, fn, label, end) {
    hidePrev();
    prevUndo = fn;
    $("toast-prev-text").textContent = text;
    $("toast-prev-undo").textContent = label;
    $("toast-prev").hidden = false;
    prevTimer = setTimeout(hidePrev, Math.max(3000, end - Date.now()));
  }
  function toast(text, action, isErr) {
    var fn = typeof action === "function" ? action : (action && action.fn) || null;
    var label = (action && action.label) || "Ongedaan maken";
    if (toastUndo && !$("toast").hidden && toastUndo !== fn && toastEnd - Date.now() > 1000) keepPrev(toastMsg, toastUndo, toastLabel, toastEnd);
    var ms = isErr ? Math.min(10000, Math.max(6000, text.length * 65)) : Math.min(7000, Math.max(3500, text.length * 55));
    if (fn) ms = Math.max(ms, 7000);
    toastMsg = text; toastLabel = label; toastUndo = fn; toastEnd = Date.now() + ms;
    $("toast-text").textContent = text;
    $("toast-undo").textContent = label;
    $("toast-undo").hidden = !fn;
    $("toast").classList.toggle("is-err", !!isErr);
    placeToasts();
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }
  function errToast(text, action) { toast(text, action, true); }
  // With the keyboard open the bottom of the screen is hidden: then the toasts go to the top.
  function placeToasts() {
    var box = document.querySelector(".toasts"), vv = window.visualViewport;
    if (!box) return;
    if (vv && vv.height < window.innerHeight - 150) { box.style.top = Math.round(vv.offsetTop + 12) + "px"; box.style.bottom = "auto"; }
    else { box.style.top = ""; box.style.bottom = ""; }
  }
  if (window.visualViewport) { window.visualViewport.addEventListener("resize", placeToasts); window.visualViewport.addEventListener("scroll", placeToasts); }
  // For news nobody waits for (a registration that went out later): never pushes away an undo.
  function softToast(text, undo) { if ($("toast").hidden || !toastUndo) toast(text, undo); }
  $("toast-undo").addEventListener("click", function (ev) { ev.stopPropagation(); var fn = toastUndo; hideToast(); if (fn) fn(); });
  $("toast-prev-undo").addEventListener("click", function (ev) { ev.stopPropagation(); var fn = prevUndo; hidePrev(); if (fn) fn(); });
  // A tap on the message itself puts it away.
  $("toast").addEventListener("click", hideToast);
  $("toast-prev").addEventListener("click", hidePrev);

  // what: what failed, as the start of a sentence ("Proosten", "Naam wijzigen").
  // retry: when given, the toast gets an "Opnieuw" button.
  function writeError(e, what, retry) {
    var code = e && e.code;
    if (code === "not_found") { errToast("Dit is net weggehaald, dus dat lukte niet meer."); render(); return; }
    if (code === "invalid_argument" || code === "not_granted") {
      S.readOnly = true;
      errToast("Opslaan lukt nu niet. Tik op Opnieuw verbinden.", { label: "Opnieuw verbinden", fn: reconnect });
    } else if (code === "quota_exceeded") {
      errToast("De opslag is vol. Vraag wie de app beheert om oude registraties op te ruimen.");
    } else {
      errToast((what || "Opslaan") + " lukte niet. Check je bereik en probeer het opnieuw.", retry ? { label: "Opnieuw", fn: retry } : null);
    }
    render();
  }
  function requireMe() {
    if (canSocial()) return true;
    if (!canWriteNow()) { toast("Je kijkt mee en kunt hier niet reageren."); return false; }
    toast("Kies eerst wie je bent, bovenaan bij Tellen.");
    S.profileId = null; S.tab = "tellen"; render(); window.scrollTo(0, 0);
    return false;
  }
  // Two-tap confirm. The second tap only counts after 400 ms (a double tap is not a yes), and an
  // armed button falls back by itself after a few seconds so a stray tap later does nothing.
  // A tap anywhere else also puts it back. Everything that can be armed carries data-confirm.
  var confirmT = null;
  function arm(key, ms) {
    S.confirmKey = key; S.confirmAt = Date.now();
    clearTimeout(confirmT);
    confirmT = setTimeout(function () { if (S.confirmKey === key) { S.confirmKey = null; render(); } }, ms || 4000);
    render();
  }
  function disarm() { var was = !!S.confirmKey; S.confirmKey = null; clearTimeout(confirmT); return was; }
  function confirmed(key) {
    if (S.confirmKey !== key || Date.now() - S.confirmAt < 400) return false;
    disarm();
    return true;
  }
  function confirmBtn(key, label, fn, armedLabel) {
    if (S.confirmKey === key) return el("button", { type: "button", class: "link-btn warn", "data-confirm": "1", text: armedLabel || "Zeker? Tik nog eens", on: { click: function () { if (confirmed(key)) fn(); } } });
    return el("button", { type: "button", class: "link-btn", "data-confirm": "1", text: label, on: { click: function () { arm(key); } } });
  }
  // Bubble phase, after the button's own click, so that click is never lost to a redraw.
  document.addEventListener("click", function (ev) {
    if (!S.confirmKey) return;
    var t = ev.target;
    if (t && t.closest && t.closest("[data-confirm]")) return;
    disarm(); render();
  });

  // ---------- photos ----------
  // One <img> per photo and place, kept between redraws. Its box has the photo's shape before it has
  // loaded (older posts without a size get a portrait box), so the feed does not jump when it arrives.
  // A photo that does not load (a dip in reception) is tried again after 4, 15 and 45 s, when the
  // network comes back, when the app is opened again, and on a tap. Only retries skip the cache.
  var IMG = {};
  function retryPhoto(img) {
    var base = img.getAttribute("data-src");
    img.removeAttribute("data-broken");
    img.src = base + (base.indexOf("?") < 0 ? "?" : "&") + "r=" + Date.now();
  }
  function retryBrokenPhotos() {
    var any = false;
    Object.keys(IMG).forEach(function (k) { if (IMG[k].getAttribute("data-broken")) { retryPhoto(IMG[k]); any = true; } });
    if (any) render();
  }
  function ratioOf(w, h) { return w > 0 && h > 0 ? w + " / " + h : ""; }
  function photoNode(id, ctx, w, h) {
    var key = ctx + ":" + id, img = IMG[key], ratio = ctx === "grid" ? "" : ratioOf(w, h);
    if (!img) {
      img = new Image(); img.alt = "Foto"; img.decoding = "async"; img.loading = "lazy";
      img.className = ctx === "grid" ? "" : "post-img";
      // Inline: a CSS aspect-ratio rule would win over it.
      if (ratio) img.style.aspectRatio = ratio;
      img.setAttribute("data-src", BK.photoUrl(id));
      img.addEventListener("error", function () {
        var n = +(img.getAttribute("data-tries") || 0) + 1;
        img.setAttribute("data-tries", String(n)); img.setAttribute("data-broken", "1"); render();
        if (n <= 3) setTimeout(function () { if (img.getAttribute("data-broken")) { retryPhoto(img); render(); } }, [4000, 15000, 45000][n - 1]);
      });
      img.addEventListener("load", function () { img.removeAttribute("data-tries"); });
      img.src = img.getAttribute("data-src"); IMG[key] = img;
    }
    if (img.getAttribute("data-broken")) {
      var miss = el("span", { class: "photo-missing", text: "Foto laden mislukt. Tik om opnieuw te proberen." });
      if (ratio) miss.style.aspectRatio = ratio;
      return miss;
    }
    return img;
  }
  window.addEventListener("online", retryBrokenPhotos);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") retryBrokenPhotos(); });
  function openLightbox(id) {
    // A tap on "Foto laden mislukt" also tries the small copies again.
    var again = false;
    ["feed:" + id, "grid:" + id].forEach(function (k) { if (IMG[k] && IMG[k].getAttribute("data-broken")) { retryPhoto(IMG[k]); again = true; } });
    $("lightbox-msg").hidden = true; $("lightbox-img").hidden = false;
    $("lightbox-img").src = BK.photoUrl(id); $("lightbox").hidden = false; $("lightbox-close").focus();
    if (again) render(); else syncHistory();
  }
  function closeLightbox() { $("lightbox").hidden = true; $("lightbox-img").removeAttribute("src"); syncHistory(); }
  $("lightbox").addEventListener("click", closeLightbox);
  $("lightbox-img").addEventListener("error", function () {
    if ($("lightbox").hidden || !this.getAttribute("src")) return;
    this.hidden = true; $("lightbox-msg").hidden = false;
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("lightbox").hidden) closeLightbox(); });

  // ---------- back button ----------
  // A photo or a profile on top gets one entry in the browser history, so Android's back button and
  // the iPhone's edge swipe close it instead of leaving the app. A second back works as usual.
  // Tabs stay out of it on purpose: back on Tellen still leaves the app, and there are no long chains.
  var HKEY = "turflijstOverlay", histBack = false;
  function overlayOpen() { return !!S.profileId || !$("lightbox").hidden; }
  function hasEntry() { return !!(history.state && history.state[HKEY]); }
  function syncHistory() {
    if (histBack) return; // our own back is on its way; popstate syncs again
    try {
      if (overlayOpen() && !hasEntry()) {
        var st = {}, cur = history.state;
        if (cur && typeof cur === "object") Object.keys(cur).forEach(function (k) { st[k] = cur[k]; });
        st[HKEY] = 1;
        history.pushState(st, "");
      } else if (!overlayOpen() && hasEntry()) { histBack = true; history.back(); } // closed with a button or a tab
    } catch (e) { histBack = false; }
  }
  window.addEventListener("popstate", function () {
    if (histBack) { histBack = false; syncHistory(); return; }
    if (!$("lightbox").hidden) closeLightbox();
    else if (S.profileId) closeProfile();
  });

  // Resolves with { blob, w, h } (the size goes with the post, so its box is right before it loads), or null.
  function compress(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        try {
          var max = 1600, s = Math.min(1, max / Math.max(w, h));
          var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) { URL.revokeObjectURL(url); resolve({ blob: b || file, w: c.width, h: c.height }); }, "image/jpeg", 0.82);
        } catch (e) { URL.revokeObjectURL(url); resolve({ blob: file, w: w || 0, h: h || 0 }); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function setPhoto(blob, w, h) {
    if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
    S.photo = blob ? { blob: blob, url: URL.createObjectURL(blob), id: newId(), w: clampInt(w, 0, 4000, 0), h: clampInt(h, 0, 4000, 0) } : null;
    render();
  }
  $("photo-input").addEventListener("change", function () {
    var f = this.files && this.files[0]; this.value = "";
    if (!f) return;
    compress(f).then(function (r) {
      var b = r && r.blob;
      if (!b) { errToast("Deze foto kan niet geopend worden. Kies een JPG of PNG."); return; }
      if (["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(b.type) < 0) { errToast("Dit soort foto werkt niet. Kies een JPG of PNG."); return; }
      if (b.size > 9.5 * 1024 * 1024) { errToast("Deze foto is te groot. Kies een kleinere."); return; }
      setPhoto(b, r.w, r.h);
    });
  });
  $("photo-remove").addEventListener("click", function () { setPhoto(null); });
  $("caption").addEventListener("input", function () { S.caption = this.value; S.draftAt = nowIso(); saveDraft(); renderHeader(); });

  // ---------- normalizers ----------
  function normalizeMember(d) {
    var x = d.data() || {}, name = str(x.name, 24);
    return name ? { id: d.id, name: name, createdAt: isoOr(x.createdAt) || "", by: strOrNull(x.by), uid: strOrNull(x.uid),
      pending: !!(d.metadata && d.metadata.hasPendingWrites) } : null;
  }
  function normalizeEntry(d) {
    var x = d.data() || {};
    if (typeof x.memberId !== "string" || !isoOr(x.at)) return null;
    var likes = {}, rawL = obj(x.likes);
    Object.keys(rawL).forEach(function (k) { if (rawL[k] === true) likes[k] = true; });
    var comments = [], rawC = obj(x.comments);
    Object.keys(rawC).forEach(function (cid) {
      var c = rawC[cid];
      if (!c || typeof c !== "object" || typeof c.memberId !== "string") return;
      var text = str(c.text, 280), at = isoOr(c.at);
      if (text && at) comments.push({ id: cid, memberId: c.memberId, by: strOrNull(c.by), text: text, at: at });
    });
    comments.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    var photo = typeof x.photo === "string" && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}$/.test(x.photo) ? x.photo : null;
    return {
      id: d.id, memberId: x.memberId, by: strOrNull(x.by), counts: cleanCounts(x.counts), at: x.at,
      night: validNight(x.night) || nightKey(new Date(x.at)), caption: str(x.caption, 140), photo: photo,
      photoW: photo ? clampInt(x.photoW, 0, 4000, 0) : 0, photoH: photo ? clampInt(x.photoH, 0, 4000, 0) : 0,
      likes: likes, comments: comments, local: !!localIds[d.id], pending: !!(d.metadata && d.metadata.hasPendingWrites)
    };
  }
  function normalizeChallenge(d) {
    var x = d.data() || {}, title = str(x.title, 80), at = isoOr(x.at);
    if (!title || !at) return null;
    var c = { id: d.id, title: title, points: clampInt(x.points, 1, 100, 10), createdBy: strOrNull(x.createdBy) || "", by: strOrNull(x.by), at: at,
      night: validNight(x.night) || nightKey(new Date(at)), need: clampInt(x.need, 1, 3, 2), closed: x.closed === true, claims: [], raw: x };
    var raw = obj(x.claims);
    Object.keys(raw).forEach(function (mid) {
      var cl = raw[mid];
      if (!cl || typeof cl !== "object" || !isoOr(cl.at)) return;
      // confirmBy says from which login each confirm came. A confirm from the login that made the
      // claim, or a second one from the same login under another name, does not count.
      var clBy = strOrNull(cl.by), cf = obj(cl.confirms), cb = obj(cl.confirmBy), list = [], who = [], times = [], seen = {};
      Object.keys(cf).forEach(function (k) {
        if (k === mid) return;
        var v = cf[k], isO = !!v && typeof v === "object";
        var at = v === true ? cl.at : isoOr(v) || (isO ? isoOr(v.at) : null);
        if (at) list.push({ m: k, at: at, by: strOrNull(cb[k]) || (isO ? strOrNull(v.by) : null) });
      });
      list.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
      list.forEach(function (x) {
        if (x.by && (x.by === clBy || seen[x.by])) return;
        if (x.by) seen[x.by] = true;
        who.push(x.m); times.push(x.at);
      });
      var ok = who.length >= c.need;
      // "Niet gezien": this friend does not vouch for it (and is not asked again).
      var dw = [], rd = obj(cl.doubts);
      Object.keys(rd).forEach(function (k) { if (k !== mid && who.indexOf(k) < 0 && (rd[k] === true || isoOr(rd[k]))) dw.push(k); });
      c.claims.push({ memberId: mid, by: clBy, at: cl.at, confirms: who, confirmBy: Object.keys(seen), doubts: dw, approved: ok, approvedAt: ok ? (times[c.need - 1] || cl.at) : null, raw: cl });
    });
    c.claims.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return c;
  }
  function normalizeBet(d) {
    var x = d.data() || {}, title = str(x.title, 100), at = isoOr(x.at);
    if (!title || !at) return null;
    var o = obj(x.odds);
    var b = { id: d.id, title: title, odds: { ja: clampNum(o.ja, 1.05, 20, 2), nee: clampNum(o.nee, 1.05, 20, 2) },
      createdBy: strOrNull(x.createdBy) || "", by: strOrNull(x.by), at: at, night: validNight(x.night) || nightKey(new Date(at)),
      need: clampInt(x.need, 1, 3, 2), closedAt: isoOr(x.closedAt), void: x.void === true, voidBy: strOrNull(x.voidBy),
      stakes: [], late: [], votes: { ja: [], nee: [] }, voteOf: {}, voters: [], raw: x };
    // One vote per login: voting again under another name replaces the earlier vote.
    var rv = obj(x.votes), vl = [], seenV = {}, lastVote = null, firstVote = null;
    Object.keys(rv).forEach(function (mid) {
      var v = rv[mid];
      if (!v || typeof v !== "object" || (v.side !== "ja" && v.side !== "nee")) return;
      vl.push({ m: mid, side: v.side, at: isoOr(v.at) || "", by: strOrNull(v.by) });
      b.voters.push(mid);
      if (isoOr(v.at) && (!firstVote || Date.parse(v.at) < Date.parse(firstVote))) firstVote = v.at;
    });
    // Betting closes at the first vote (or at closedAt). A stake from a phone that had not seen
    // that yet arrives later, by the time on the phones, and does not count.
    b.cut = firstVote && (!b.closedAt || Date.parse(firstVote) < Date.parse(b.closedAt)) ? firstVote : b.closedAt;
    var rs = obj(x.stakes);
    Object.keys(rs).forEach(function (mid) {
      var s = rs[mid];
      if (!s || typeof s !== "object" || (s.side !== "ja" && s.side !== "nee")) return;
      var amt = clampInt(s.amount, 0, 100, 0), st = { memberId: mid, side: s.side, amount: amt, at: isoOr(s.at) || at };
      if (amt > 0) (b.cut && Date.parse(st.at) > Date.parse(b.cut) ? b.late : b.stakes).push(st);
    });
    vl.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    vl.forEach(function (v) {
      if (v.by) { if (seenV[v.by]) return; seenV[v.by] = true; }
      b.votes[v.side].push(v.m); b.voteOf[v.m] = v.side;
      if (v.at && (!lastVote || v.at > lastVote)) lastVote = v.at;
    });
    var vj = b.votes.ja.length, vn = b.votes.nee.length;
    b.result = b.void ? "void" : (vj >= b.need && vj > vn) ? "ja" : (vn >= b.need && vn > vj) ? "nee" : null;
    b.resultAt = lastVote || at;
    b.noVotes = !b.void && !b.result && vj + vn === 0;
    return b;
  }
  // Open for stakes: nobody has voted yet and closing time (end of the night) is not here yet.
  function betOpen(b) { return b.noVotes && !(b.closedAt && Date.now() >= Date.parse(b.closedAt)); }
  // The end of the night a moment belongs to (07:00 the next morning).
  function nightEnd(d) { var e = parseDay(nightKey(d)); e.setDate(e.getDate() + 1); e.setHours(NIGHT_CUTOFF_HOUR, 0, 0, 0); return e; }
  function normalizeEvent(d) {
    var x = d.data() || {}, title = str(x.title, 60);
    if (!title || !validNight(x.date)) return null;
    var going = {}, rg = obj(x.going);
    Object.keys(rg).forEach(function (k) { if (rg[k] === true) going[k] = true; });
    return { id: d.id, title: title, date: x.date, time: typeof x.time === "string" && /^\d{2}:\d{2}$/.test(x.time) ? x.time : "",
      createdBy: strOrNull(x.createdBy) || "", by: strOrNull(x.by), going: going, raw: x };
  }
  function cleanPoints(raw) {
    var o = {}; raw = obj(raw);
    DRINKS.forEach(function (d) { if (typeof raw[d.key] === "number" && isFinite(raw[d.key])) o[d.key] = clampInt(raw[d.key], -20, 20, DEFAULT_POINTS[d.key]); });
    return o;
  }

  // ---------- derived data ----------
  var D = { ver: -1 };
  function derived() {
    if (D.ver === S.ver) return D;
    var L = [];
    S.entries.forEach(function (e) { L.push({ m: e.memberId, night: e.night, pts: ptsOf(e.counts), drinks: total(e.counts), counts: e.counts, kind: "drink" }); });
    S.challenges.forEach(function (c) {
      c.claims.forEach(function (cl) { if (cl.approved) L.push({ m: cl.memberId, night: nightKey(new Date(cl.at)), pts: c.points, kind: "challenge" }); });
    });
    S.bets.forEach(function (b) {
      if (b.result !== "ja" && b.result !== "nee") return;
      b.stakes.forEach(function (st) {
        var win = st.side === b.result;
        L.push({ m: st.memberId, night: b.night, pts: win ? betWin(st.amount, b.odds[st.side]) : -st.amount, kind: "bet", win: win });
      });
    });
    // feed
    var F = [];
    S.entries.forEach(function (e) { F.push({ type: "entry", at: e.at, actor: e.memberId, e: e }); });
    S.challenges.forEach(function (c) {
      F.push({ type: "ch-new", at: c.at, actor: c.createdBy, c: c });
      c.claims.forEach(function (cl) { if (cl.approved) F.push({ type: "ch-done", at: cl.approvedAt, actor: cl.memberId, c: c, cl: cl }); });
    });
    S.bets.forEach(function (b) {
      F.push({ type: "bet-new", at: b.at, actor: b.createdBy, b: b });
      if (b.result === "ja" || b.result === "nee") F.push({ type: "bet-done", at: b.resultAt, actor: null, b: b });
    });
    F.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    // MVP per finished night
    var byNight = {}, cur = nightKey(new Date()), mvp = {};
    L.forEach(function (x) { var n = byNight[x.night] || (byNight[x.night] = {}); n[x.m] = (n[x.m] || 0) + x.pts; });
    Object.keys(byNight).forEach(function (night) {
      if (night === cur) return;
      var best = 0, who = [];
      Object.keys(byNight[night]).forEach(function (m) { var p = byNight[night][m]; if (p > best) { best = p; who = [m]; } else if (p === best && p > 0) who.push(m); });
      who.forEach(function (m) { mvp[m] = (mvp[m] || 0) + 1; });
    });
    D = { ver: S.ver, ledger: L, feed: F, mvp: mvp };
    return D;
  }
  function blankAgg(id) { return { id: id, pts: 0, drinks: 0, counts: zero(), regs: 0, chPts: 0, chCount: 0, betPts: 0, betCount: 0, betWins: 0 }; }
  function aggregate(L, night) {
    var map = {};
    L.forEach(function (x) {
      if (night && x.night !== night) return;
      var r = map[x.m] || (map[x.m] = blankAgg(x.m));
      r.pts += x.pts;
      if (x.kind === "drink") { r.drinks += x.drinks; r.regs++; DRINKS.forEach(function (d) { r.counts[d.key] += x.counts[d.key] || 0; }); }
      else if (x.kind === "challenge") { r.chPts += x.pts; r.chCount++; }
      else { r.betPts += x.pts; r.betCount++; if (x.win) r.betWins++; }
    });
    return map;
  }
  // A claim made from this device (under any name), or one this device already confirmed: a confirm
  // from here would not count, so we do not offer it.
  function fromThisDevice(cl) { return isMyUid(cl.by) || cl.confirmBy.some(function (u) { return isMyUid(u); }); }
  function canConfirm(cl) {
    return canSocial() && !cl.approved && cl.memberId !== S.meId && cl.confirms.indexOf(S.meId) < 0 && !!memberById(cl.memberId) && !fromThisDevice(cl);
  }
  // The "wachten op jou" badge. Not for a stopped challenge, a claim you said you did not see, or
  // anything older than a day and a half: the badge must be something you can clear.
  function pendingCounts() {
    var ch = 0, bet = 0, cutoff = Date.now() - 36 * 3600 * 1000;
    if (!canSocial()) return { ch: 0, bet: 0 };
    S.challenges.forEach(function (c) {
      if (c.closed) return;
      c.claims.forEach(function (cl) { if (canConfirm(cl) && cl.doubts.indexOf(S.meId) < 0 && Date.parse(cl.at) > cutoff) ch++; });
    });
    S.bets.forEach(function (b) { if (!b.result && !betOpen(b) && !b.voteOf[S.meId] && Date.parse(b.resultAt) > cutoff) bet++; });
    return { ch: ch, bet: bet };
  }
  function unreadFeed() {
    var seen = S.feedSeen || "", n = 0;
    derived().feed.forEach(function (it) { if (it.at > seen && (it.actor === null || it.actor !== S.meId)) n++; });
    return seen ? n : 0;
  }

  // ---------- render ----------
  function isTypingDyn() { var a = document.activeElement; return !!(a && a.getAttribute && a.getAttribute("data-dyn") === "1"); }
  function render() {
    renderHeader(); renderBanner(); renderTabs(); syncHistory();
    if (isTypingDyn()) { S.dirty = true; return; }
    S.dirty = false;
    if (S.profileId) { renderProfile(); return; }
    if (S.tab === "feed") renderFeed();
    else if (S.tab === "spel") renderSpel();
    else if (S.tab === "tellen") renderTellen();
    else if (S.tab === "ranglijst") renderBoard();
    else if (S.tab === "groep") renderGroup();
  }
  document.addEventListener("focusout", function () { setTimeout(function () { if (S.dirty && !isTypingDyn()) render(); }, 250); });

  function renderHeader() {
    var onTellen = S.tab === "tellen" && !S.profileId;
    $("top-acts").hidden = !onTellen;
    $("btn-back").hidden = !S.profileId;
    var titles = { feed: "Feed", spel: "Spel", tellen: "Turflijst", ranglijst: "Ranglijst", groep: "Groep" };
    $("brand-title").textContent = S.profileId ? nameOf(S.profileId) : titles[S.tab];
    var me = S.meId && memberById(S.meId);
    // Three parts: who you are, "avond van" and the date. The date always shows in full; when it
    // does not all fit, "avond van" goes first (fitNight), then the name gets shortened.
    $("nl-me").textContent = me && !S.profileId ? "Jij: " + me.name + " \u00b7\u00a0" : "";
    $("nl-pre").textContent = me ? "avond van\u00a0" : "Avond van\u00a0";
    $("nl-pre").hidden = !!S.profileId;
    $("night-date").textContent = S.profileId ? "Profiel" : nightLabel(nightKey(new Date()));
    $("btn-clear").hidden = !anyCount(S.counts) && !S.photo && !S.caption;
    // Never really disabled: a tap on a button that cannot register yet says why (see explainBlock).
    var b = $("btn-reg"), block = regBlock(), target = S.forId && memberById(S.forId);
    clear(b);
    if (target) { b.appendChild(el("span", { class: "reg-verb", text: "Registreer voor\u00a0" })); b.appendChild(el("span", { class: "reg-name", text: target.name })); b.appendChild(el("span", { text: "\u00a0→" })); }
    else if (block === "who") b.textContent = noMe() ? "Kies je naam" : "Kies voor wie";
    else b.textContent = "Registreren";
    b.classList.toggle("is-blocked", !!block);
    b.classList.toggle("for-other", !!target && S.forId !== S.meId);
    b.setAttribute("aria-disabled", block ? "true" : "false");
    fitNight();
  }
  // Measured only when something in the header changed, not on every tap.
  var fitKey = "";
  function fitNight() {
    var meEl = $("nl-me"), pre = $("nl-pre");
    var key = [meEl.textContent, $("night-date").textContent, $("btn-reg").textContent, $("top-acts").hidden, pre.hidden, window.innerWidth, document.body.classList.contains("gated")].join("|");
    if (key === fitKey) return;
    fitKey = key;
    pre.classList.remove("squeezed");
    if (meEl.textContent && meEl.scrollWidth > meEl.clientWidth + 1) pre.classList.add("squeezed");
  }
  // The web font came in (other letter widths): measure again.
  try { document.fonts.addEventListener("loadingdone", function () { fitKey = ""; fitNight(); }); } catch (e) {}
  function noMe() { return !S.meId || !memberById(S.meId); }
  // Why Registreer cannot go ahead right now, or null when it can.
  function regBlock() {
    if (!anyCount(S.counts) && !S.photo) return "empty";
    if (!canWriteNow()) return "offline";
    if (!S.forId || !memberById(S.forId)) return S.loaded.members ? "who" : "loading";
    return null;
  }
  function explainBlock(block) {
    if (block === "empty") toast(S.assets ? "Tel eerst je drankjes met de plusjes, of kies een foto." : "Tel eerst je drankjes met de plusjes.");
    else if (block === "offline") toast(S.readOnly || S.canWrite === false || S.signedOut ? "Opslaan lukt nu niet. Tik bovenaan op Opnieuw verbinden. Je telling blijft staan." : "Nog geen verbinding. Je telling blijft staan, probeer het zo opnieuw.");
    else if (block === "loading") toast("Even wachten, de namen worden nog geladen.");
    else {
      var who = !$("who-card").hidden;
      toast(who ? "Kies eerst wie je bent: tik hierboven op je naam." : "Kies eerst voor wie je registreert: tik hieronder op een naam.");
      flash(who ? $("who-card") : $("for-sec"));
    }
  }
  var flashT = null, flashEl = null;
  function flash(n) {
    if (flashEl) flashEl.classList.remove("flash");
    if (n.scrollIntoView) n.scrollIntoView({ block: "center" });
    void n.offsetWidth; n.classList.add("flash"); flashEl = n;
    clearTimeout(flashT); flashT = setTimeout(function () { n.classList.remove("flash"); flashEl = null; }, 1800);
  }

  // Reloading is safe: the group code stays in the address bar and the login is stored.
  // Offline it would only show the browser's error page, so then we wait instead.
  function reconnect() {
    if (navigator.onLine === false) { toast("Nog geen bereik. Probeer het opnieuw zodra je internet hebt."); return; }
    location.reload();
  }
  // The data on screen may be old: offline for a few seconds, or refreshing failing for a while, or
  // no live updates and no refresh for 90 s. The grace time keeps the banner from popping in and out
  // (and moving the buttons) on a short dip.
  function syncTrouble() {
    var h = S.sync;
    if (!h || !h.since || !S.loaded.members) return false;
    var now = Date.now();
    if (h.offline || navigator.onLine === false) return now - h.since > 5000;
    if (!h.ok) return now - h.since > 20000;
    if (!h.live) return now - (h.lastOk || 0) > 90000;
    return false;
  }
  // Who is in the app is only known while the live connection works.
  function isOnline(id) { return !!S.online[id] && !syncTrouble(); }
  var bannerKey = null;
  function renderBanner() {
    var b = $("banner"), msg = null;
    if (S.noStore) msg = ["Geen verbinding met de database. ", "Check je internet. ", true];
    else if (S.storeError) msg = ["Verbinding met de opslag is verbroken. ", "", true];
    else if (S.signedOut) msg = ["Verbinding verloren. ", "", true];
    else if (S.readOnly || S.canWrite === false) msg = ["Opslaan lukt niet. ", "", true];
    else if (S.slow && !(S.loaded.members && S.loaded.entries)) msg = ["Nog geen verbinding met de opslag. ", "Wat je ziet kan verouderd zijn."];
    else if (!S.loaded.members && S.db) msg = ["Verbinden… ", ""];
    else if (syncTrouble()) msg = S.sync.lastOk ? ["Geen verbinding · bijgewerkt om " + hhmm(S.sync.lastOk) + ". ", "Nieuwe drankjes van anderen zie je zodra je weer bereik hebt."]
      : ["Geen verbinding. ", "Wat je ziet kan verouderd zijn."];
    var w = waiting(), now = Date.now();
    // Said right away when offline, otherwise once a send failed or takes longer than a few seconds.
    var showWait = w.length > 0 && (navigator.onLine === false || w.some(function (it) { return it.fails > 0 || now - it.queuedAt > 4000; }));
    // Redrawn every few seconds while something waits: only when it changed, so a tap on its
    // button never lands on a button that was just replaced.
    var busy = !!sendingId, key = JSON.stringify([msg, showWait && w.length, busy, canWriteNow()]);
    if (key === bannerKey) return;
    bannerKey = key;
    b.hidden = !msg && !showWait; clear(b);
    if (msg) {
      var p = el("p", { class: "bl" }, [el("b", { text: msg[0] }), msg[1]]);
      if (msg[2]) p.appendChild(el("button", { type: "button", class: "link-btn", id: "banner-reconnect", text: "Opnieuw verbinden", on: { click: reconnect } }));
      b.appendChild(p);
    }
    if (showWait) {
      b.appendChild(el("p", { class: "bl", id: "outbox-line" }, [
        el("b", { text: w.length === 1 ? "1 registratie wacht op internet. " : w.length + " registraties wachten op internet. " }),
        canWriteNow() ? "Gaat vanzelf zodra je bereik hebt. " : "Ze blijven bewaard op je telefoon. ",
        el("button", { type: "button", class: "link-btn", id: "outbox-retry", "aria-disabled": busy ? "true" : "false", text: busy ? "Bezig…" : "Nu proberen", on: { click: retryOutbox } })
      ]));
    }
  }

  function setBadge(tab, n, label) {
    var b = $("badge-" + tab), btn = $("tab-" + tab);
    b.hidden = !n; b.textContent = n > 9 ? "9+" : String(n);
    btn.setAttribute("aria-label", n ? label + ", " + n + (tab === "feed" ? " nieuw" : " wachten op jou") : label);
  }
  function renderTabs() {
    var cur = S.profileId ? "profiel" : S.tab;
    ["feed", "spel", "tellen", "ranglijst", "groep", "profiel"].forEach(function (v) { $("view-" + v).hidden = v !== cur; });
    document.querySelectorAll(".tabs button").forEach(function (btn) {
      if (btn.getAttribute("data-tab") === S.tab && !S.profileId) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
    });
    var p = pendingCounts();
    setBadge("feed", S.tab === "feed" && !S.profileId ? 0 : unreadFeed(), "Feed");
    setBadge("spel", p.ch + p.bet, "Spel");
  }

  // ----- Tellen -----
  function buildCounters() {
    var box = $("counters");
    DRINKS.forEach(function (d) {
      var minus = el("button", { type: "button", "aria-label": d.label + " min één", text: "−", on: { click: function () { bump(d.key, -1); } } });
      var plus = el("button", { type: "button", "aria-label": d.label + " plus één", text: "+", on: { click: function () { bump(d.key, 1); } } });
      box.appendChild(el("div", { class: "counter" + (d.drink ? "" : " is-barf"), id: "ctr-" + d.key }, [
        el("span", { class: "name", text: d.label }),
        el("div", { class: "pill" }, [minus, el("output", { id: "out-" + d.key, "aria-live": "polite", text: "0" }), plus])
      ]));
    });
  }
  function bump(key, delta) {
    // Taps left over from an earlier night go to their own card first, not on top of tonight.
    if (checkStale()) render();
    if (!anyCount(S.counts) && delta > 0) S.draftNight = nightKey(new Date());
    S.counts[key] = Math.max(0, Math.min(MAX_PER_COUNTER, (S.counts[key] || 0) + delta));
    S.draftAt = nowIso();
    saveDraft(); renderCounters(); renderCompose(); renderHeader();
  }
  function renderCounters() {
    DRINKS.forEach(function (d) {
      var n = S.counts[d.key] || 0, c = $("ctr-" + d.key), btns = c.querySelectorAll("button");
      $("out-" + d.key).textContent = String(n);
      c.classList.toggle("has-value", n > 0);
      btns[0].disabled = n <= 0; btns[1].disabled = n >= MAX_PER_COUNTER;
    });
  }
  function renderCompose() {
    $("compose").hidden = !canWriteNow();
    $("photo-btn").hidden = !S.assets;
    var prev = $("photo-prev");
    if (S.photo) { if (prev.src !== S.photo.url) prev.src = S.photo.url; prev.hidden = false; $("photo-ic").hidden = true; }
    else { prev.hidden = true; prev.removeAttribute("src"); $("photo-ic").hidden = false; }
    $("photo-remove").hidden = !S.photo;
    var cap = $("caption"); if (document.activeElement !== cap && cap.value !== S.caption) cap.value = S.caption;
    var line = $("compose-line"); clear(line);
    var w = waiting();
    if (!anyCount(S.counts) && !S.photo && w.length) {
      // Right where you just tapped: the registration is on its way, or waiting for reception.
      var one = w[w.length - 1];
      line.textContent = w.length > 1 ? w.length + " registraties wachten op internet. Gaat vanzelf." :
        (breakdown(one.body.counts, true) || "Foto") + " voor " + nameOf(one.body.memberId) + (sendingId === one.id && !one.fails ? " wordt verstuurd…" : " wacht op internet. Gaat vanzelf.");
      return;
    }
    if (!anyCount(S.counts) && !S.photo) { line.textContent = S.assets ? "Tel je drankjes, voeg eventueel een foto toe en tik op Registreer." : "Tel je drankjes en tik op Registreer."; return; }
    // Counting for someone else is said right next to the counters, so it is hard to miss.
    if (S.forId && memberById(S.forId) && S.forId !== S.meId) line.appendChild(el("b", { class: "for-tag", text: "Voor " + nameOf(S.forId) }));
    if (anyCount(S.counts)) { line.appendChild(document.createTextNode(breakdown(S.counts, true) + " · ")); line.appendChild(el("b", { text: fmtPts(ptsOf(S.counts)) })); }
    else line.appendChild(document.createTextNode("Alleen een foto, zonder drankjes."));
    if (regBlock() === "who") line.appendChild(document.createTextNode(noMe() ? " · kies eerst je naam" : " · kies hieronder voor wie"));
  }
  function memberChip(m, pressed, onClick) {
    var kids = [m.name];
    if (m.id === S.meId) kids.push(el("span", { class: "me", text: "(jij)" }));
    return el("button", { type: "button", class: "chip", "aria-pressed": pressed ? "true" : "false", on: { click: onClick } }, kids);
  }
  // A name under "Wie ben jij?". A free name is one tap. A name in use on another device ("bezet")
  // asks "Ben jij X? Tik nog eens" first, then moves the name to this device.
  function whoChip(m) {
    var taken = takenByOther(m), key = "take:" + m.id, armed = taken && S.confirmKey === key;
    var kids = armed ? ["Ben jij " + m.name + "? Tik nog eens"] : [m.name];
    if (taken && !armed) kids.push(el("span", { class: "me", text: "(bezet)" }));
    return el("button", { type: "button", class: "chip" + (taken ? " taken" : "") + (armed ? " armed" : "") + (S.whoHl === m.id ? " hl" : ""),
      "data-mid": m.id, "data-confirm": taken ? "1" : null, on: { click: function () {
        // The names may just have popped in under a finger that was aiming for a counter.
        if (Date.now() - S.whoShownAt < 600) return;
        if (!taken) setMe(m.id);
        else if (!armed) arm(key);
        else if (confirmed(key)) takeOver(m);
      } } }, kids);
  }
  function renderWho() {
    var card = $("who-card"), wasShown = !card.hidden;
    var needWho = !S.meId || !memberById(S.meId);
    // Show the card while names are still loading too (no jump when they arrive), unless this
    // device already has a name that will most likely show up.
    var showWho = !!S.db && needWho && (S.loaded.members || !S.meId);
    card.hidden = !showWho;
    if (!showWho) return;
    var wc = $("who-chips"), hadChips = wc.childNodes.length > 0, loading = !S.loaded.members;
    var full = S.members.length >= MAX_MEMBERS, canAdd = !full && canWriteNow();
    var anyTaken = S.members.some(takenByOther);
    var t;
    if (loading) t = "Namen laden…";
    else if (!S.members.length) t = canAdd ? "Er staan nog geen namen in de groep. Voeg jezelf als eerste toe." : "Er staan nog geen namen in de groep.";
    else {
      t = "Kies je naam, dan registreer en reageer je als jezelf.";
      if (anyTaken) t += " Staat er (bezet) bij jouw naam? Tik erop om hem naar dit toestel te halen.";
      if (canAdd) t += " Sta je er niet tussen? Voeg jezelf toe.";
      else if (full && canWriteNow()) t += " Sta je er niet tussen? De groep is vol: haal bij Groep eerst een ongebruikte naam weg.";
    }
    $("who-text").textContent = t;
    clear(wc);
    S.members.forEach(function (m) { wc.appendChild(whoChip(m)); });
    wc.hidden = !loading && !S.members.length;
    if ((!wasShown || !hadChips) && S.members.length) S.whoShownAt = Date.now();
    var armedId = S.confirmKey && S.confirmKey.indexOf("take:") === 0 ? S.confirmKey.slice(5) : null;
    $("who-note").hidden = !(armedId && memberById(armedId));
    $("who-add").hidden = !loading && !canAdd;
    $("who-add-btn").disabled = loading;
  }
  // A tally from an earlier night that was never registered: register it on that night, or throw it away.
  function renderStale() {
    var box = $("stale-box"); clear(box);
    box.hidden = !S.stale.length;
    S.stale.forEach(function (it) {
      var who = memberById(it.forId) && it.forId !== S.meId ? it.forId : null;
      box.appendChild(el("div", { class: "card stale" }, [
        el("h2", { text: "Nog niet geregistreerd" }),
        el("p", null, [(it.night ? "Van " + nightLabel(it.night) : "Van een eerdere avond") + ": ", el("b", { text: breakdown(it.counts, true) }),
          " · " + fmtPts(ptsOf(it.counts)) + (who ? " (voor " + nameOf(who) + ")" : "") + (it.caption ? " · “" + it.caption + "”" : "")]),
        el("div", { class: "stale-acts" }, [
          el("button", { type: "button", class: "btn-sm", text: it.night ? "Registreer voor die avond" : "Registreer voor vanavond",
            on: { click: function () { registerStale(it); } } }),
          el("button", { type: "button", class: "link-btn", text: "Weggooien", on: { click: function () { dropStale(it); } } })
        ])
      ]));
    });
  }
  function renderTellen() {
    renderStale(); renderCounters(); renderCompose();
    var nk = nightKey(new Date());
    renderWho();
    var fc = $("for-chips"); clear(fc);
    S.members.slice().sort(function (a, b) { return (b.id === S.meId) - (a.id === S.meId); })
      .forEach(function (m) { fc.appendChild(memberChip(m, m.id === S.forId, function () { S.forId = m.id; saveDraft(); render(); })); });
    if (!S.members.length) fc.appendChild(el("span", { class: "empty", text: S.loaded.members || !S.db ? "Nog geen namen. Voeg ze toe bij Groep." : "Namen laden…" }));

    var tl = $("tonight-line"); clear(tl);
    var agg = aggregate(derived().ledger, nk), group = 0, barf = 0;
    Object.keys(agg).forEach(function (k) { group += agg[k].drinks; barf += agg[k].counts.barfjes; });
    if (S.forId && memberById(S.forId)) {
      var mine = agg[S.forId] || blankAgg(S.forId);
      tl.appendChild(el("span", null, [nameOf(S.forId) + " vanavond: ", el("b", { text: mine.drinks + " " + drinksWord(mine.drinks) + " · " + mine.pts + " pnt" })]));
    }
    tl.appendChild(el("span", null, ["Groep: ", el("b", { text: group + " " + drinksWord(group) }), barf ? " · " + barf + " " + (barf === 1 ? "barfje" : "barfjes") : ""]));

    var log = $("log"); clear(log);
    var recent = S.entries.filter(function (e) { return e.night === nk; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 8);
    if (!recent.length) log.appendChild(el("p", { class: "empty", text: S.loaded.entries || !S.db ? "Nog niks geregistreerd vanavond." : "Registraties laden…" }));
    recent.forEach(function (e) {
      var what = breakdown(e.counts, true) || (e.photo || e.withPhoto ? "foto" : "");
      log.appendChild(el("div", { class: "log-row" + (e.queued ? " queued" : "") }, [
        el("time", { text: timeOf(e.at) }),
        el("div", { class: "what" }, [nameBtn(e.memberId, "inline"), " ", el("span", { text: what }), e.queued ? pendTag(e) : null]),
        canDeleteEntry(e) ? confirmBtn("entry:" + e.id, "Verwijder", function () { removeEntry(e); }, "Ja, verwijder") : el("span")
      ]));
    });
  }
  // On a registration that is not on the server yet.
  function pendTag(e) {
    var it = outboxItem(e.id), going = !!it && sendingId === e.id && !it.fails;
    return el("span", { class: "pend-tag", text: going ? "versturen…" : "nog niet verstuurd" });
  }
  function canDeleteEntry(e) {
    if (!canWriteNow()) return false;
    if (isMyUid(e.by) || (!S.uid && e.local)) return true;
    // A recent one on your own name, also when it was made on your old phone or by a friend.
    return !!S.meId && e.memberId === S.meId && !!memberById(S.meId) && Date.now() - new Date(e.at).getTime() < 24 * 3600 * 1000;
  }

  // ----- Feed -----
  // A redraw (someone else's post, a proost, who is online) never moves what you are reading: the
  // first post under the header stays exactly where it was. When you are not at the top, new posts
  // above it show as a "↑ N nieuw" button instead, and only count as seen once you have been at the top.
  function feedKey(it) {
    return it.type + ":" + (it.e ? it.e.id : it.cl ? it.c.id + ":" + it.cl.memberId : it.c ? it.c.id : it.b.id);
  }
  function feedAtTop() { return window.scrollY < 120; }
  function topEdge() { var t = document.querySelector(".top"); return t ? t.getBoundingClientRect().bottom : 0; }
  function feedAnchor() {
    if (window.scrollY < 1) return null;
    var nodes = $("feed").children, edge = topEdge();
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      if (r.bottom > edge + 8) return r.top < window.innerHeight && nodes[i].getAttribute("data-k") ? { k: nodes[i].getAttribute("data-k"), top: r.top } : null;
    }
    return null;
  }
  function keepAnchor(a) {
    if (!a) return;
    var nodes = $("feed").children;
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute("data-k") === a.k) {
      var dy = nodes[i].getBoundingClientRect().top - a.top;
      if (Math.abs(dy) >= 1) window.scrollBy(0, dy);
      return;
    }
  }
  // topKeys: what was in the feed the last time you were at the top. By item, not by time, so a
  // friend whose phone clock is ahead does not hide what is new.
  var topKeys = null;
  function markFeedSeen() {
    var f = derived().feed;
    if (f.length && (!S.feedSeen || f[0].at > S.feedSeen)) { S.feedSeen = f[0].at; safeSet(KEYS.seen, S.feedSeen); }
    topKeys = {}; f.forEach(function (it) { topKeys[feedKey(it)] = true; });
  }
  function newAbove() {
    var n = 0;
    if (topKeys) derived().feed.forEach(function (it) { if (!topKeys[feedKey(it)] && (it.actor === null || it.actor !== S.meId)) n++; });
    return n;
  }
  function renderNewPill() {
    var n = S.tab === "feed" && !S.profileId && !feedAtTop() ? newAbove() : 0, pill = $("feed-new");
    pill.hidden = !n;
    if (n) { pill.textContent = "\u2191 " + n + " nieuw"; pill.style.top = Math.round(topEdge() + 8) + "px"; }
  }
  $("feed-new").addEventListener("click", function () {
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
  });
  var scrollT = null;
  window.addEventListener("scroll", function () {
    // (Not right after the tap that showed it: focusing a bar can scroll it into view.)
    if (tipOff && Date.now() - tipOff.at > 400) { var f = tipOff; tipOff = null; f.off(); }
    if (scrollT) return;
    scrollT = setTimeout(function () {
      scrollT = null;
      if (S.tab !== "feed" || S.profileId) return;
      if (feedAtTop() && (newAbove() || unreadFeed())) { markFeedSeen(); renderTabs(); }
      renderNewPill();
    }, 100);
  }, { passive: true });
  function renderFeed() {
    var anchor = feedAnchor();
    var os = $("online-strip"); clear(os);
    var ids = Object.keys(S.online).filter(function (id) { return memberById(id) && isOnline(id); });
    os.hidden = !(S.room && ids.length);
    if (!os.hidden) {
      os.appendChild(el("span", { class: "label", text: "Nu in de app · " + ids.length }));
      var row = el("div", { class: "chips" });
      ids.sort(function (a, b) { return (b === S.meId) - (a === S.meId); }).forEach(function (id) {
        row.appendChild(el("button", { type: "button", class: "chip chip-av", on: { click: function () { openProfile(id); } } }, [avatar(id, "s"), nameOf(id) + (id === S.meId ? " (jij)" : "")]));
      });
      os.appendChild(row);
    }
    $("btn-plan").hidden = !canSocial() || !$("event-form").hidden;
    renderEvents();
    renderNightCard();
    var d = derived(), list = $("feed"); clear(list);
    if (!d.feed.length) {
      list.appendChild(el("div", { class: "card" }, [el("h2", { text: "Nog niks in de feed" }), el("p", { text: S.loaded.entries || !S.db ? "Registreer je eerste drankje bij Tellen, eventueel met een foto. Uitdagingen en voorspellingen verschijnen hier ook." : "Feed laden…" })]));
    }
    d.feed.slice(0, S.feedLimit).forEach(function (it) { var n = feedItem(it); n.setAttribute("data-k", feedKey(it)); list.appendChild(n); });
    $("feed-more").hidden = d.feed.length <= S.feedLimit;
    keepAnchor(anchor);
    // The very first time everything counts as seen.
    if (feedAtTop() || !S.feedSeen) markFeedSeen();
    renderNewPill();
  }
  function feedItem(it) {
    if (it.type === "entry") return postCard(it.e);
    var ic, parts, action = null;
    if (it.type === "ch-new") {
      ic = ICON.flag;
      parts = [el("p", null, [nameBtn(it.c.createdBy, "inline"), " daagt de groep uit"]), el("p", { class: "q", text: it.c.title })];
      action = { label: "Bekijk · +" + it.c.points + " pnt", fn: function () { goSpel("uitdagingen"); } };
    } else if (it.type === "ch-done") {
      ic = ICON.trophy;
      parts = [el("p", null, [nameBtn(it.cl.memberId, "inline"), " heeft de uitdaging gehaald"]), el("p", { class: "q", text: it.c.title })];
      action = { label: "+" + it.c.points + " pnt", fn: null };
    } else if (it.type === "bet-new") {
      ic = ICON.ball;
      parts = [el("p", null, [nameBtn(it.b.createdBy, "inline"), " voorspelt"]), el("p", { class: "q", text: it.b.title })];
      action = { label: betOpen(it.b) ? "Inzetten · Ja ×" + fmtOdds(it.b.odds.ja) + " · Nee ×" + fmtOdds(it.b.odds.nee) : "Bekijk", fn: function () { goSpel("voorspellingen"); } };
    } else {
      ic = ICON.ball;
      var b = it.b, winners = b.stakes.filter(function (s) { return s.side === b.result; }).map(function (s) { return s.memberId; });
      parts = [el("p", { class: "q", text: b.title }), el("p", { text: (b.result === "ja" ? "Het gebeurde." : "Het gebeurde niet.") + (winners.length ? " Gewonnen: " + listNames(winners, 4) + "." : " Niemand had het goed.") })];
      action = { label: "Uitslag bekijken", fn: function () { goSpel("voorspellingen"); } };
    }
    var meta = el("div", { class: "notice-meta" }, [el("span", { text: ago(it.at) })]);
    if (action) meta.appendChild(action.fn ? el("button", { type: "button", class: "link-btn", text: action.label, on: { click: action.fn } }) : el("span", { class: "state ok", text: action.label }));
    return el("div", { class: "notice" }, [el("span", { class: "ic", html: ic }), el("div", { class: "notice-body" }, parts.concat([meta]))]);
  }
  function postCard(e) {
    var card = el("article", { class: "post" });
    var via = memberByUid(e.by);
    var timeText = ago(e.at) + (via && via.id !== e.memberId ? " · via " + via.name : "");
    var pts = ptsOf(e.counts);
    card.appendChild(el("div", { class: "post-head" }, [
      avatar(e.memberId),
      el("div", { class: "post-who" }, [nameBtn(e.memberId), el("span", { class: "post-time" }, [timeText, e.queued ? pendTag(e) : null])]),
      anyCount(e.counts) ? el("span", { class: "post-pts" + (pts < 0 ? " neg" : ""), text: fmtPts(pts) }) : null
    ]));
    if (e.photo) {
      var ph = el("button", { type: "button", class: "post-photo", "aria-label": "Foto van " + nameOf(e.memberId) + " groot bekijken", on: { click: function () { openLightbox(e.photo); } } });
      ph.appendChild(photoNode(e.photo, "feed", e.photoW, e.photoH));
      card.appendChild(ph);
    }
    var body = el("div", { class: "post-body" });
    if (e.caption) body.appendChild(el("p", { class: "post-cap", text: e.caption }));
    var bd = breakdown(e.counts, true); if (bd) body.appendChild(el("p", { class: "post-drinks", text: bd }));
    if (body.childNodes.length) card.appendChild(body);

    var likers = Object.keys(e.likes).filter(function (k) { return memberById(k); });
    var liked = !!(S.meId && e.likes[S.meId]);
    var likeBtn = el("button", { type: "button", class: "act" + (liked ? " on" : ""), "aria-pressed": String(liked), "aria-label": "Proost" + (likers.length ? ", " + likers.length : ""), on: { click: function () { toggleLike(e.id, likeBtn); } } },
      [el("span", { html: ICON.cheers }), el("span", { text: likers.length ? String(likers.length) : "Proost" })]);
    var acts = el("div", { class: "post-acts" }, [likeBtn,
      el("button", { type: "button", class: "act", "aria-label": "Reageren" + (e.comments.length ? ", " + e.comments.length + " reacties" : ""), on: { click: function () {
        if (e.queued) { notYet(); return; }
        S.openComments[e.id] = true;
        render();
        // Focused inside the tap itself: only then does an iPhone bring up the keyboard straight away.
        var ci = $("cmt-" + e.id); if (ci) ci.focus();
      } } }, [el("span", { html: ICON.chat }), el("span", { text: e.comments.length ? String(e.comments.length) : "Reageer" })])
    ]);
    if (canDeleteEntry(e)) acts.appendChild(el("span", { class: "push" }, [confirmBtn("entry:" + e.id, "Verwijder", function () { removeEntry(e); }, "Ja, verwijder")]));
    card.appendChild(acts);
    if (likers.length) card.appendChild(el("p", { class: "post-likes", text: "Proost van " + listNames(likers) }));

    var open = !!S.openComments[e.id], shown = open ? e.comments : e.comments.slice(-2);
    if (e.comments.length > 2 && !open) card.appendChild(el("button", { type: "button", class: "link-btn more", text: "Alle " + e.comments.length + " reacties", on: { click: function () { S.openComments[e.id] = true; render(); } } }));
    if (shown.length) {
      var cl = el("div", { class: "comments" });
      shown.forEach(function (c) {
        var mine = canWriteNow() && (isMyUid(c.by) || (!S.uid && c.memberId === S.meId));
        cl.appendChild(el("div", { class: "cmt" }, [
          el("span", { class: "cmt-text" }, [nameBtn(c.memberId, "inline"), c.text]),
          el("time", { text: ago(c.at).replace(" geleden", "") }),
          mine ? el("button", { type: "button", class: "link-btn cmt-del", "aria-label": "Reactie verwijderen", text: "×", on: { click: function () { removeComment(e.id, c); } } }) : null
        ]));
      });
      card.appendChild(cl);
    }
    if (open && canSocial()) {
      var inp = el("input", { class: "field", id: "cmt-" + e.id, type: "text", maxlength: "280", placeholder: "Reageer als " + nameOf(S.meId) + "…", "aria-label": "Reactie", autocomplete: "off", "data-dyn": "1" });
      inp.value = S.commentDrafts[e.id] || "";
      inp.addEventListener("input", function () { S.commentDrafts[e.id] = inp.value; });
      var form = el("form", { class: "cmt-form", on: { submit: function (ev) { ev.preventDefault(); addComment(e.id, inp.value); } } },
        [inp, el("button", { type: "submit", class: "btn-sm", text: "Plaats" })]);
      card.appendChild(form);
    } else if (open && !canSocial() && canWriteNow()) {
      card.appendChild(el("p", { class: "hint", style: "padding:8px 14px 0", text: "Kies eerst wie je bent bij Tellen om te reageren." }));
    }
    return card;
  }
  function renderNightCard() {
    var box = $("night-card"); clear(box);
    var nk = nightKey(new Date()), agg = aggregate(derived().ledger, nk);
    var rows = Object.keys(agg).map(function (k) { return agg[k]; }).filter(function (r) { return memberById(r.id); });
    if (!rows.length) return;
    rows.sort(function (a, b) { return b.pts - a.pts || b.drinks - a.drinks; });
    var drinks = rows.reduce(function (s, r) { return s + r.drinks; }, 0);
    var pod = el("div", { class: "podium" });
    rows.slice(0, 3).forEach(function (r, i) {
      pod.appendChild(el("div", { class: "pod" }, [el("span", { class: "r", text: String(i + 1) }), avatar(r.id, "s"), el("span", { class: "nm", text: nameOf(r.id) }), el("span", { class: "p", text: r.pts + " pnt" })]));
    });
    box.appendChild(el("button", { type: "button", class: "night-card", on: { click: function () { S.tab = "ranglijst"; S.board = "vanavond"; render(); window.scrollTo(0, 0); } } }, [
      el("div", { class: "night-top" }, [el("b", { text: "Vanavond" }), el("span", { text: drinks + " " + drinksWord(drinks) + " · " + rows.length + " " + (rows.length === 1 ? "persoon" : "mensen") + " · ranglijst →" })]),
      pod
    ]));
  }

  // ----- Agenda -----
  function eventStart(ev) { var d = parseDay(ev.date); if (ev.time) { var t = ev.time.split(":"); d.setHours(+t[0], +t[1]); } return d; }
  function countdown(ev) {
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((parseDay(ev.date) - today) / 86400000);
    if (days >= 2) return { n: String(days), u: "dagen" };
    if (days === 1) return { n: "1", u: "dag" };
    // Yesterday's party after midnight: the night is still going (until 07:00).
    if (days < 0) return { n: "Nu", u: "bezig" };
    if (ev.time) {
      var mins = Math.round((eventStart(ev) - now) / 60000);
      if (mins >= 60) return { n: String(Math.floor(mins / 60)), u: "uur" };
      if (mins > 0) return { n: String(mins), u: "min" };
    }
    return { n: "Nu", u: "vandaag" };
  }
  function cdLabel(cd) { return cd.n !== "Nu" ? "Over " + cd.n + " " + cd.u : cd.u === "bezig" ? "Nu bezig" : "Vandaag"; }
  function renderEvents() {
    var box = $("events"); clear(box);
    // Shown until the night it is on has ended (07:00 the next morning), not until midnight.
    var tonight = parseDay(nightKey(new Date()));
    var up = S.events.filter(function (ev) { return parseDay(ev.date) >= tonight; })
      .sort(function (a, b) { return eventStart(a) - eventStart(b); }).slice(0, 4);
    if (!up.length) { box.appendChild(el("p", { class: "hint", text: canSocial() ? "Nog niks gepland. Plan het volgende feest met + Plan iets." : "Nog niks gepland." })); return; }
    up.forEach(function (ev) {
      var cd = countdown(ev), going = Object.keys(ev.going).filter(function (k) { return memberById(k); });
      var am = !!(S.meId && ev.going[S.meId]);
      var when = parseDay(ev.date).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }) + (ev.time ? " · " + ev.time : "");
      var acts = el("div", { class: "ev-acts" });
      if (canSocial()) acts.appendChild(el("button", { type: "button", class: "btn-sm ghost", "aria-pressed": String(am), text: am ? "Ik ga ✓" : "Ik ga", on: { click: function () { toggleGoing(ev); } } }));
      if (canSocial() && (ev.createdBy === S.meId || isMyUid(ev.by))) acts.appendChild(confirmBtn("ev:" + ev.id, "Verwijder", function () { deleteDoc("events/" + ev.id, "Afspraak verwijderd.", ev.raw); }, "Ja, verwijder"));
      box.appendChild(el("div", { class: "event" }, [
        el("div", { class: "cd", role: "img", "aria-label": cdLabel(cd) }, [el("b", { text: cd.n, "aria-hidden": "true" }), el("span", { text: cd.u, "aria-hidden": "true" })]),
        el("div", { class: "ev-body" }, [el("b", { text: ev.title }), el("span", { text: when }), el("span", { text: going.length ? going.length + " gaan: " + listNames(going, 3) : "Nog niemand aangemeld" })]),
        acts
      ]));
    });
  }

  // ----- Spel -----
  function goSpel(which) { S.profileId = null; S.tab = "spel"; S.spelTab = which; render(); window.scrollTo(0, 0); }
  function renderSpel() {
    var p = pendingCounts();
    $("seg-ch").setAttribute("aria-pressed", String(S.spelTab === "uitdagingen"));
    $("seg-bet").setAttribute("aria-pressed", String(S.spelTab === "voorspellingen"));
    $("seg-ch-n").hidden = !p.ch; $("seg-ch-n").textContent = String(p.ch);
    $("seg-bet-n").hidden = !p.bet; $("seg-bet-n").textContent = String(p.bet);
    $("spel-ch").hidden = S.spelTab !== "uitdagingen";
    $("spel-bet").hidden = S.spelTab !== "voorspellingen";
    $("ch-form").hidden = !canSocial();
    $("bet-form").hidden = !canSocial();
    var need = needNow();
    $("ch-rule").textContent = "Gedaan? Tik op ‘Ik heb het gedaan’. Als " + (need === 1 ? "iemand anders" : need + " anderen") + " op ‘Ik zag het’ " + (need === 1 ? "tikt" : "tikken") + ", krijg je de punten.";
    if (S.spelTab === "uitdagingen") {
      var list = $("ch-list"); clear(list);
      var open = S.challenges.filter(function (c) { return !c.closed; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      var done = S.challenges.filter(function (c) { return c.closed; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 15);
      if (!open.length && !done.length) list.appendChild(el("p", { class: "hint", text: canSocial() ? "Nog geen uitdagingen. Plaats de eerste hierboven." : "Nog geen uitdagingen." }));
      open.forEach(function (c) { list.appendChild(challengeCard(c)); });
      if (done.length) { list.appendChild(el("span", { class: "label", text: "Gestopt" })); done.forEach(function (c) { list.appendChild(challengeCard(c)); }); }
    } else {
      var bl = $("bet-list"); clear(bl);
      var active = S.bets.filter(function (b) { return !b.result; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      var past = S.bets.filter(function (b) { return !!b.result; }).sort(function (a, b) { return a.resultAt < b.resultAt ? 1 : -1; }).slice(0, 15);
      if (!active.length && !past.length) bl.appendChild(el("p", { class: "hint", text: canSocial() ? "Nog geen voorspellingen. Plaats de eerste hierboven." : "Nog geen voorspellingen." }));
      active.forEach(function (b) { bl.appendChild(betCard(b)); });
      if (past.length) { bl.appendChild(el("span", { class: "label", text: "Afgerond" })); past.forEach(function (b) { bl.appendChild(betCard(b)); }); }
    }
  }
  function confirmsWord(n) { return n + " " + (n === 1 ? "bevestiging gaat" : "bevestigingen gaan") + " verloren"; }
  function challengeCard(c) {
    var card = el("article", { class: "game" }), social = canSocial();
    var isCreator = social && (c.createdBy === S.meId || isMyUid(c.by));
    card.appendChild(el("div", { class: "game-top" }, [el("div", { class: "game-title", text: c.title }), el("span", { class: "pts-badge", text: "+" + c.points })]));
    card.appendChild(el("div", { class: "game-meta" }, ["Van ", nameBtn(c.createdBy, "inline"), " · " + ago(c.at) + (c.closed ? " · gestopt" : "")]));
    var myClaim = null, claims = el("div", { class: "claims" }), ownHere = false;
    c.claims.forEach(function (cl) {
      if (cl.memberId === S.meId) myClaim = cl;
      var right = el("div", { class: "claim-right" }), who = nameOf(cl.memberId), state;
      if (cl.approved) state = el("span", { class: "state ok", text: "Gehaald ✓" });
      else {
        state = el("span", { class: "state", text: cl.confirms.length + "/" + c.need + " bevestigd" + (cl.doubts.length ? " · " + cl.doubts.length + " niet gezien" : "") });
        if (canConfirm(cl)) {
          right.appendChild(el("button", { type: "button", class: "btn-sm", "aria-label": "Ik zag " + who + " het doen", text: "Ik zag het", on: { click: function () { confirmClaim(c, cl.memberId); } } }));
          if (cl.doubts.indexOf(S.meId) < 0) right.appendChild(el("button", { type: "button", class: "link-btn", "aria-label": "Niet gezien dat " + who + " het deed", text: "Niet gezien", on: { click: function () { doubtClaim(c, cl.memberId); } } }));
        } else if (social && cl.confirms.indexOf(S.meId) >= 0) {
          right.appendChild(el("button", { type: "button", class: "link-btn", "aria-label": "Je bevestiging voor " + who + " intrekken", text: "Intrekken", on: { click: function () { unconfirmClaim(c, cl.memberId); } } }));
        } else if (social && cl.memberId !== S.meId && fromThisDevice(cl)) ownHere = true;
      }
      // Whoever placed the challenge can take a wrong claim off again, also one that already got its points.
      if (isCreator && cl.memberId !== S.meId) right.appendChild(confirmBtn("chrej:" + c.id + ":" + cl.memberId, "Afwijzen", function () { rejectClaim(c, cl); },
        cl.approved ? "Afwijzen? " + who + " verliest de punten" : "Afwijzen? Tik nog eens"));
      claims.appendChild(el("div", { class: "claim" }, [avatar(cl.memberId, "s"), el("div", { class: "claim-who" }, [nameBtn(cl.memberId), state]), right]));
    });
    if (c.claims.length) card.appendChild(claims);
    else card.appendChild(el("p", { class: "hint", text: c.closed ? "Niemand heeft deze uitdaging gehaald." : "Nog niemand heeft het gedaan." }));
    if (ownHere) card.appendChild(el("p", { class: "hint", text: "Gedaan of bevestigd op deze telefoon? Dan moet iemand anders het bevestigen, op zijn eigen telefoon." }));
    var acts = el("div", { class: "game-acts" });
    if (social) {
      if (!c.closed && !myClaim) acts.appendChild(el("button", { type: "button", class: "btn-sm", text: "Ik heb het gedaan", on: { click: function () { claimChallenge(c); } } }));
      if (myClaim && !myClaim.approved) acts.appendChild(confirmBtn("chwd:" + c.id, "Toch niet gedaan", function () { withdrawClaim(c); },
        myClaim.confirms.length ? "Intrekken? " + confirmsWord(myClaim.confirms.length) : "Intrekken? Tik nog eens"));
      if (isCreator && !c.closed) acts.appendChild(confirmBtn("chclose:" + c.id, "Uitdaging stoppen", function () { closeChallenge(c); }, "Stoppen? Daarna kan niemand meer meedoen"));
      if (isCreator && !c.claims.length) acts.appendChild(confirmBtn("chdel:" + c.id, "Verwijder", function () { deleteDoc("challenges/" + c.id, "Uitdaging verwijderd.", c.raw); }, "Ja, verwijder"));
    }
    if (acts.childNodes.length) card.appendChild(acts);
    return card;
  }
  function sideWord(side) { return side === "ja" ? "Ja" : "Nee"; }
  function betCard(b) {
    var card = el("article", { class: "game" }), social = canSocial(), open = betOpen(b);
    var isCreator = social && (b.createdBy === S.meId || isMyUid(b.by));
    var my = null; b.stakes.forEach(function (s) { if (s.memberId === S.meId) my = s; });
    var late = null; b.late.forEach(function (s) { if (s.memberId === S.meId) late = s; });
    var sel = S.stakeSel[b.id] || (my ? my.amount : 10), canStake = open && social;
    var when = open && b.closedAt ? " · inzetten tot " + hhmm(Date.parse(b.closedAt)) : !b.result && !open ? " · inzet gesloten" : "";
    card.appendChild(el("div", { class: "game-meta" }, ["Voorspelling van ", nameBtn(b.createdBy, "inline"), " · " + ago(b.at) + when]));
    card.appendChild(el("div", { class: "game-title big", text: b.title }));
    var odds = el("div", { class: "odds" });
    ["ja", "nee"].forEach(function (side) {
      var st = b.stakes.filter(function (s) { return s.side === side; });
      var pool = st.reduce(function (s, x) { return s + x.amount; }, 0);
      var cls = "odd" + (my && my.side === side ? " mine" : "") + (b.result === side ? " win" : "");
      // While you can still bet: what the chosen stake would win, right on the button.
      var kids = [
        el("span", { class: "side", text: sideWord(side) + (b.result === side ? " ✓" : "") }),
        el("span", { class: "mult", text: "×" + fmtOdds(b.odds[side]) + (canStake ? " · +" + betWin(sel, b.odds[side]) : "") }),
        el("span", { class: "who", text: st.length ? listNames(st.map(function (s) { return s.memberId; }), 3) + " · " + pool + " pnt" : "Nog niemand" })
      ];
      if (canStake) odds.appendChild(el("button", { type: "button", class: cls, "aria-pressed": String(!!(my && my.side === side)),
        "aria-label": sel + " pnt op " + sideWord(side) + ", goed geraden is +" + betWin(sel, b.odds[side]), on: { click: function () { placeStake(b, side); } } }, kids));
      else odds.appendChild(el("div", { class: cls }, kids));
    });
    card.appendChild(odds);
    if (canStake) {
      var row = el("div", { class: "stakes" }, [el("span", { class: "label", text: "Inzet" })]);
      STAKES.forEach(function (a) {
        row.appendChild(el("button", { type: "button", class: "chip chip-sm", "aria-pressed": String(sel === a), text: a + " pnt", on: { click: function () {
          S.stakeSel[b.id] = a;
          if (my && my.amount !== a) placeStake(b, my.side); else render();
        } } }));
      });
      card.appendChild(row);
    }
    if (my && !b.result) {
      card.appendChild(el("p", { class: "hint" }, ["Jij: " + my.amount + " pnt op " + sideWord(my.side) + ". Goed is +" + betWin(my.amount, b.odds[my.side]) + ", fout is −" + my.amount + ". ",
        open ? el("button", { type: "button", class: "link-btn", text: "Inzet intrekken", on: { click: function () { withdrawStake(b); } } }) : null]));
    } else if (canStake) {
      card.appendChild(el("p", { class: "hint", text: "Kies een inzet en tik op Ja of Nee om in te zetten. Achter de + staat wat je wint." }));
    }
    if (late && !my && b.result !== "void") card.appendChild(el("p", { class: "hint warn", text: "Je inzet kwam binnen toen de inzet al gesloten was. Die telt niet mee." }));
    var vj = b.votes.ja.length, vn = b.votes.nee.length, mine = b.voteOf[S.meId];
    if (b.result === "void") {
      card.appendChild(el("p", { class: "hint", text: "Geschrapt" + (b.voidBy && memberById(b.voidBy) ? " door " + nameOf(b.voidBy) : "") + ". Niemand wint of verliest punten." }));
    } else if (b.result) {
      var res = el("div", { class: "result" }, [el("b", { text: "Uitslag: " + (b.result === "ja" ? "het gebeurde" : "het gebeurde niet") })]);
      var line = el("span");
      b.stakes.map(function (s) { var w = s.side === b.result; return { id: s.memberId, g: w ? betWin(s.amount, b.odds[s.side]) : -s.amount }; })
        .sort(function (x, y) { return y.g - x.g; })
        .forEach(function (x, i) {
          if (i) line.appendChild(document.createTextNode(" · "));
          line.appendChild(document.createTextNode(nameOf(x.id) + " "));
          line.appendChild(el("span", { class: "gain " + (x.g >= 0 ? "up" : "down"), text: fmtDelta(x.g) }));
        });
      if (!b.stakes.length) line.textContent = "Niemand had ingezet.";
      res.appendChild(line);
      card.appendChild(res);
    } else {
      var vote = el("div", { class: "vote" }), shown = S.voteOpen[b.id];
      var voteBtn = function (side, text) {
        return el("button", { type: "button", class: "btn-sm ghost", "aria-pressed": String(mine === side), text: text, on: { click: function () {
          if (Date.now() - (S.voteOpen[b.id] || 0) < 400) return; // the second half of the tap that opened this
          voteOutcome(b, side);
        } } });
      };
      var btns = [voteBtn("ja", "Ja, het gebeurde"), voteBtn("nee", "Nee, het gebeurde niet")];
      // Still open for stakes: giving the result is one step away from the Ja/Nee bets, and says what it does.
      if (open && !mine) {
        if (!social) vote.appendChild(el("span", { class: "hint", text: "Nog niemand heeft de uitslag doorgegeven." }));
        else if (!shown) vote.appendChild(el("button", { type: "button", class: "link-btn vote-open", text: "Uitslag bekend? Geef hem door", on: { click: function () { S.voteOpen[b.id] = Date.now(); render(); } } }));
        else {
          vote.appendChild(el("span", { class: "hint warn", text: "Let op: na jouw stem kan niemand meer inzetten. Na " + b.need + " " + (b.need === 1 ? "stem" : "gelijke stemmen") + " staat de uitslag vast." }));
          vote.appendChild(el("div", { class: "vote-btns" }, btns.concat([el("button", { type: "button", class: "link-btn", text: "Toch niet", on: { click: function () { delete S.voteOpen[b.id]; render(); } } })])));
        }
      } else {
        vote.appendChild(el("span", { class: "hint", text: "Inzet gesloten. Wat is de uitslag? Ja " + vj + "/" + b.need + " · Nee " + vn + "/" + b.need }));
        if (social) {
          if (mine) btns.push(el("button", { type: "button", class: "link-btn", text: "Stem intrekken", on: { click: function () { withdrawVote(b); } } }));
          vote.appendChild(el("div", { class: "vote-btns" }, btns));
        }
      }
      card.appendChild(vote);
    }
    var acts = el("div", { class: "game-acts" });
    // Schrappen voids everyone's stake. Not for a creator whose own stake is being voted down.
    var ownStake = b.stakes.some(function (s) { return s.memberId === S.meId || s.memberId === b.createdBy; });
    if (isCreator && !b.result && (vj + vn === 0 || !ownStake)) acts.appendChild(confirmBtn("betvoid:" + b.id, "Voorspelling schrappen", function () { voidBet(b); }, "Voor iedereen schrappen? Niemand wint of verliest punten"));
    // A wrong result can be taken back for a short while: everyone votes again, stakes stay as they were.
    if (isCreator && b.result && b.result !== "void" && Date.now() - Date.parse(b.resultAt) < 15 * 60000) acts.appendChild(confirmBtn("betreset:" + b.id, "Uitslag terugdraaien", function () { resetBet(b); }, "Terugdraaien? Iedereen stemt dan opnieuw"));
    if (isCreator && !b.stakes.length && !b.late.length && !vj && !vn) acts.appendChild(confirmBtn("betdel:" + b.id, "Verwijder", function () { deleteDoc("bets/" + b.id, "Voorspelling verwijderd.", b.raw); }, "Ja, verwijder"));
    if (acts.childNodes.length) card.appendChild(acts);
    return card;
  }

  // ----- Ranglijst -----
  function renderBoard() {
    $("seg-vanavond").setAttribute("aria-pressed", String(S.board === "vanavond"));
    $("seg-altijd").setAttribute("aria-pressed", String(S.board === "altijd"));
    $("seg-punten").setAttribute("aria-pressed", String(S.boardMode === "punten"));
    $("seg-drankjes").setAttribute("aria-pressed", String(S.boardMode === "drankjes"));
    renderTrend(S.board === "altijd");
    // A points change rewrites every past night too: say so for a day, so nobody is surprised.
    var pm = S.pointsMeta, pw = pm && memberByUid(pm.by), recent = !!(pm && pm.updatedAt && Date.now() - Date.parse(pm.updatedAt) < 24 * 3600 * 1000);
    $("board-points").hidden = !recent;
    if (recent) $("board-points").textContent = "De puntentelling is " + ago(pm.updatedAt) + " gewijzigd" + (pw ? " door " + (pw.id === S.meId ? "jou" : pw.name) : "") + ". Dat geldt ook voor vorige avonden.";
    var night = S.board === "vanavond" ? nightKey(new Date()) : null;
    var agg = aggregate(derived().ledger, night), byPts = S.boardMode === "punten";
    var rows = S.members.map(function (m) { return agg[m.id] || blankAgg(m.id); });
    rows.sort(function (a, b) {
      return byPts ? (b.pts - a.pts || b.drinks - a.drinks || nameOf(a.id).localeCompare(nameOf(b.id)))
                   : (b.drinks - a.drinks || a.counts.barfjes - b.counts.barfjes || nameOf(a.id).localeCompare(nameOf(b.id)));
    });
    var sumDrinks = 0, sumBarf = 0, active = 0;
    rows.forEach(function (r) { sumDrinks += r.drinks; sumBarf += r.counts.barfjes; if (r.regs || r.chCount || r.betCount) active++; });
    var st = $("stats"); clear(st);
    st.appendChild(el("div", { class: "stat" }, [el("b", { text: String(sumDrinks) }), el("span", { text: "drankjes samen" })]));
    st.appendChild(el("div", { class: "stat" }, [el("b", { text: active + "/" + S.members.length }), el("span", { text: night ? "mensen bezig" : "mensen geteld" })]));
    st.appendChild(el("div", { class: "stat barf" }, [el("b", { text: String(sumBarf) }), el("span", { text: sumBarf === 1 ? "barfje" : "barfjes" })]));
    var bd = $("board"); clear(bd);
    if (!rows.length) { bd.appendChild(el("div", { class: "row" }, [el("span"), el("span"), el("span", { class: "empty", text: "Nog geen namen in de groep." }), el("span")])); return; }
    var rank = 0, prev = null;
    rows.forEach(function (r, i) {
      var val = byPts ? r.pts : r.drinks, has = byPts ? (r.regs || r.chCount || r.betCount) : r.drinks > 0;
      if (val !== prev) { rank = i + 1; prev = val; }
      var bdKids = [];
      if (byPts) {
        var parts = [];
        if (r.drinks) parts.push(r.drinks + " " + drinksWord(r.drinks));
        if (r.chCount) parts.push("uitdagingen +" + r.chPts);
        if (r.betCount) parts.push("voorspellingen " + fmtDelta(r.betPts));
        if (r.counts.barfjes) parts.push(r.counts.barfjes + " " + (r.counts.barfjes === 1 ? "barfje" : "barfjes"));
        bdKids.push(parts.join(" · ") || "nog niks");
      } else {
        var t = breakdown(r.counts, false);
        bdKids.push(t || "nog niks");
        if (r.counts.barfjes) bdKids.push(el("span", { class: "bf", text: (t ? " · " : "") + r.counts.barfjes + " " + (r.counts.barfjes === 1 ? "barfje" : "barfjes") }));
      }
      var nmKids = [nameOf(r.id)]; if (r.id === S.meId) nmKids.push(el("small", { text: "jij" }));
      var score = el("div", { class: "score" }, [el("b", { class: val < 0 ? "neg" : null, text: String(val) })]);
      if (byPts) score.appendChild(el("small", { text: "pnt" }));
      else if (r.drinks) score.appendChild(el("span", { html: tally(r.drinks) }));
      bd.appendChild(el("button", { type: "button", class: "row" + (rank === 1 && has && val > 0 ? " first" : ""), on: { click: function () { openProfile(r.id); } } }, [
        el("span", { class: "rank", text: has ? String(rank) : "–" }),
        avatar(r.id),
        el("div", { class: "who" }, [el("span", { class: "nm" }, nmKids), el("span", { class: "bd" }, bdKids)]),
        score
      ]));
    });
  }

  // ----- Groep -----
  // Points per drink: − / + steppers (no keyboard, so a minus works on every phone). The change
  // is a draft until Opslaan is tapped twice, after the screen has said what it changes for whom.
  function buildPointsForm() {
    var g = $("points-grid");
    DRINKS.forEach(function (d) {
      var minus = el("button", { type: "button", "aria-label": d.label + ": een punt minder", text: "−", on: { click: function () { stepPoints(d.key, -1); } } });
      var plus = el("button", { type: "button", "aria-label": d.label + ": een punt meer", text: "+", on: { click: function () { stepPoints(d.key, 1); } } });
      g.appendChild(el("div", { class: "pt" + (d.drink ? "" : " is-barf") }, [el("span", { class: "pt-name", text: d.label }),
        el("div", { class: "pill pill-sm", id: "ptc-" + d.key }, [minus, el("output", { id: "pt-" + d.key, "aria-live": "polite" }), plus])]));
    });
  }
  function pointsNow() { var o = {}; DRINKS.forEach(function (d) { o[d.key] = pv(d.key); }); return o; }
  function pointsChanged() { return S.pointsDraft ? DRINKS.filter(function (d) { return S.pointsDraft[d.key] !== pv(d.key); }) : []; }
  function resetPoints() { S.pointsDirty = false; S.pointsDraft = null; S.pointsConflict = false; if (S.confirmKey === "points") disarm(); }
  function stepPoints(k, delta) {
    if (!canWriteNow()) return;
    if (!S.pointsDraft) S.pointsDraft = pointsNow();
    S.pointsDraft[k] = Math.max(-20, Math.min(20, S.pointsDraft[k] + delta));
    S.pointsDirty = true;
    if (!pointsChanged().length) resetPoints();
    syncPointsForm();
  }
  function syncPointsForm() {
    var draft = S.pointsDraft || pointsNow(), changed = pointsChanged(), armed = S.confirmKey === "points" && changed.length > 0, ok = canWriteNow();
    DRINKS.forEach(function (d) {
      var v = draft[d.key], o = $("pt-" + d.key), bs = $("ptc-" + d.key).querySelectorAll("button");
      o.textContent = v ? fmtDelta(v) : "0";
      o.classList.toggle("neg", v < 0); o.classList.toggle("changed", v !== pv(d.key));
      bs[0].disabled = !ok || v <= -20; bs[1].disabled = !ok || v >= 20;
    });
    var save = $("points-save");
    save.disabled = !ok || !changed.length;
    save.textContent = armed ? "Ja, opslaan voor iedereen" : "Opslaan";
    save.classList.toggle("is-armed", armed);
    $("points-cancel").hidden = !changed.length;
    $("points-confirm").hidden = !armed;
    if (armed) $("points-confirm").textContent = changed.map(function (d) { return d.label + " " + (fmtDelta(pv(d.key)) || "0") + " → " + (fmtDelta(draft[d.key]) || "0"); }).join(", ") +
      ". Dit verandert de ranglijst van iedereen, ook van vorige avonden. Tik nog eens om op te slaan.";
    $("points-conflict").hidden = !(S.pointsConflict && changed.length);
    var m = S.pointsMeta, who = m && memberByUid(m.by);
    $("points-meta").hidden = !(m && m.updatedAt);
    if (m && m.updatedAt) $("points-meta").textContent = "Laatst gewijzigd door " + (who ? (who.id === S.meId ? "jou" : who.name) : "iemand") + ", " + ago(m.updatedAt) + ".";
  }
  // How often each name occurs anywhere: drinks, comments, proosts, challenges, bets, plans.
  function memberActivity() {
    var a = {};
    function inc(id) { if (id) a[id] = (a[id] || 0) + 1; }
    S.entries.forEach(function (e) { inc(e.memberId); e.comments.forEach(function (c) { inc(c.memberId); }); Object.keys(e.likes).forEach(inc); });
    S.challenges.forEach(function (c) { inc(c.createdBy); c.claims.forEach(function (cl) { inc(cl.memberId); cl.confirms.forEach(inc); cl.doubts.forEach(inc); }); });
    S.bets.forEach(function (b) { inc(b.createdBy); b.stakes.concat(b.late).forEach(function (st) { inc(st.memberId); }); b.voters.forEach(inc); });
    S.events.forEach(function (ev) { inc(ev.createdBy); Object.keys(ev.going).forEach(inc); });
    return a;
  }
  function renderGroup() {
    var n = S.members.length;
    $("members-label").textContent = "Groep · " + n + "/" + MAX_MEMBERS;
    var regs = {}; S.entries.forEach(function (e) { regs[e.memberId] = (regs[e.memberId] || 0) + 1; });
    // Deleting is only offered on fresh data, and only for a name nobody has done anything with.
    var act = memberActivity(), fresh = S.loaded.members && S.loaded.entries, hasMe = !!(S.meId && memberById(S.meId));
    var box = $("members"); clear(box);
    if (!n) box.appendChild(el("div", { class: "member" }, [el("span", { class: "empty", text: S.loaded.members || !S.db ? "Nog geen namen. Voeg de eerste hieronder toe." : "Namen laden…" })]));
    S.members.forEach(function (m) {
      var count = regs[m.id] || 0;
      if (S.editing === m.id) {
        var inp = el("input", { class: "field", type: "text", id: "rename-" + m.id, maxlength: "24", "aria-label": "Nieuwe naam voor " + m.name, "data-dyn": "1" });
        inp.value = S.editValue;
        inp.addEventListener("input", function () { S.editValue = inp.value; });
        box.appendChild(el("form", { class: "member", on: { submit: function (ev) { ev.preventDefault(); renameMember(m, inp.value); } } }, [inp,
          el("div", { class: "acts" }, [el("button", { type: "submit", class: "link-btn", text: "Opslaan" }), el("button", { type: "button", class: "link-btn", text: "Annuleren", on: { click: function () { S.editing = null; render(); } } })])]));
        if (S.focusEdit) { S.focusEdit = false; setTimeout(function () { inp.focus(); inp.select(); }, 0); }
        return;
      }
      var acts = [], taken = takenByOther(m);
      if (m.id === S.meId) acts.push(el("span", { class: "tag-me", text: "Jij" }));
      else if (taken) { if (canWriteNow()) acts.push(confirmBtn("take:" + m.id, "Dit ben ik", function () { takeOver(m); }, "Ben jij " + m.name + "? Tik nog eens")); }
      // Already someone on this device: switching asks once more, so a stray tap does not make you someone else.
      else if (hasMe) acts.push(confirmBtn("me:" + m.id, "Dit ben ik", function () { setMe(m.id); }, "Wissel naar " + m.name + "? Tik nog eens"));
      else acts.push(el("button", { type: "button", class: "link-btn", text: "Dit ben ik", on: { click: function () { setMe(m.id); } } }));
      if (canWriteNow()) {
        acts.push(el("button", { type: "button", class: "link-btn", text: "Naam wijzigen", on: { click: function () { S.editing = m.id; S.editValue = m.name; S.focusEdit = true; disarm(); render(); } } }));
        if (taken) acts.push(confirmBtn("free:" + m.id, "Vrijgeven", function () { freeName(m); }, "Zeker? " + m.name + " moet dan opnieuw kiezen"));
        if (fresh && !count && !act[m.id] && !taken) acts.push(confirmBtn("rm:" + m.id, "Verwijder", function () { removeMember(m); }, "Ja, verwijder"));
      }
      var sub = count + (count === 1 ? " registratie" : " registraties") + (taken ? " · in gebruik op een ander toestel" : "");
      box.appendChild(el("div", { class: "member" }, [
        avatar(m.id),
        el("div", { class: "who" }, [nameBtn(m.id), el("span", { class: "bd", text: sub })]),
        el("div", { class: "acts" }, acts)
      ]));
    });
    $("add-member").hidden = n >= MAX_MEMBERS || !canWriteNow();
    $("add-hint").textContent = n >= MAX_MEMBERS
      ? "De groep is vol (15 namen). Verwijder eerst een naam waar nog niks mee gedaan is."
      : "Maximaal 15 namen. Iedereen kan voor iedereen registreren, handig als iemands telefoon leeg is. Een naam waar al iets mee gedaan is (drankjes, punten, reacties) kun je hernoemen maar niet verwijderen.";
    var link = BK && BK.inviteLink ? BK.inviteLink() : "";
    $("invite-card").hidden = !link;
    if (link) {
      if ($("invite-link").value !== link) $("invite-link").value = link;
      var gi = BK.group(), host = location.hostname;
      $("invite-code").textContent = gi && gi.code ? "Groepscode: " + BK.parseCode(gi.code) : "";
      // A Vercel preview address sits behind a Vercel login, and its storage differs from the real site.
      $("invite-warn").hidden = !(link.indexOf(location.origin) === 0 && /\.vercel\.app$/.test(host) && /-git-/.test(host));
      $("invite-share").hidden = !navigator.share;
    }
    $("points-form").hidden = !S.db;
    syncPointsForm();
  }

  // ----- Profiel -----
  function openProfile(id) {
    if (!memberById(id)) return;
    if (!S.profileId) { S.prevTab = S.tab; S.prevScroll = window.scrollY; }
    S.profileId = id; disarm(); window.scrollTo(0, 0); render();
  }
  // Back where you were: the same tab, scrolled to the same place.
  function closeProfile() { S.profileId = null; S.tab = S.prevTab || "tellen"; render(); window.scrollTo(0, S.prevScroll || 0); }
  function renderProfile() {
    var id = S.profileId, box = $("view-profiel"); clear(box);
    if (!memberById(id)) { box.appendChild(el("p", { class: "empty", text: "Deze persoon staat niet meer in de groep." })); return; }
    var d = derived(), all = aggregate(d.ledger, null)[id] || blankAgg(id);
    var mine = S.entries.filter(function (e) { return e.memberId === id; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var nights = {}; mine.forEach(function (e) { nights[e.night] = (nights[e.night] || 0) + total(e.counts); });
    var best = null; Object.keys(nights).forEach(function (n) { if (!best || nights[n] > nights[best]) best = n; });
    var fav = null; DRINKS.forEach(function (dk) { if (dk.drink && all.counts[dk.key] > 0 && (!fav || all.counts[dk.key] > all.counts[fav.key])) fav = dk; });

    var tags = el("div", { class: "prof-tags" });
    if (id === S.meId) tags.appendChild(el("span", { class: "tag-me", text: "Jij" }));
    if (isOnline(id)) tags.appendChild(el("span", { class: "online-tag", text: "Nu in de app" }));
    box.appendChild(el("div", { class: "prof-head" }, [avatar(id, "l"), el("div", null, [el("h2", { text: nameOf(id) }), tags])]));

    function stat(v, l, cls, small) { return el("div", { class: "stat" + (cls ? " " + cls : "") }, [el("b", { class: small ? "small" : null, text: String(v) }), el("span", { text: l })]); }
    var grid = el("div", { class: "stats" }, [
      stat(all.pts, "punten"), stat(all.drinks, drinksWord(all.drinks)), stat(Object.keys(nights).length, "avonden uit"),
      stat(d.mvp[id] || 0, "avonden als #1"), stat(best ? nights[best] : 0, best ? "beste avond · " + nightLabel(best) : "beste avond"), stat(all.counts.barfjes, all.counts.barfjes === 1 ? "barfje" : "barfjes", "barf"),
      stat(all.chCount, "uitdagingen gehaald" + (all.chPts ? " · +" + all.chPts : "")), stat(all.betCount ? all.betWins + "/" + all.betCount : "0", "voorspellingen goed" + (all.betCount ? " · " + fmtDelta(all.betPts) : "")), stat(fav ? fav.label : "–", fav ? "favoriet · " + all.counts[fav.key] : "favoriet", null, true)
    ]);
    box.appendChild(grid);
    var nc = nightChart(id); if (nc) box.appendChild(nc);

    var maxC = 0; DRINKS.forEach(function (dk) { maxC = Math.max(maxC, all.counts[dk.key]); });
    if (maxC > 0) {
      var bars = el("div", { class: "bars" });
      DRINKS.forEach(function (dk) {
        var v = all.counts[dk.key], fill = el("div", { class: "bar-fill" + (dk.drink ? "" : " barf") });
        fill.style.width = (maxC ? (v / maxC) * 100 : 0) + "%";
        bars.appendChild(el("div", { class: "bar-row" }, [el("span", { text: dk.label }), el("div", { class: "bar-track" }, [fill]), el("span", { text: String(v) })]));
      });
      box.appendChild(el("section", { class: "sec" }, [el("span", { class: "label", text: "Alle drankjes" }), bars]));
    }

    var photos = mine.filter(function (e) { return e.photo; }).slice(0, 30);
    if (photos.length) {
      var g = el("div", { class: "grid3" });
      photos.forEach(function (e) {
        var b = el("button", { type: "button", "aria-label": "Foto van " + ago(e.at) + " groot bekijken", on: { click: function () { openLightbox(e.photo); } } });
        b.appendChild(photoNode(e.photo, "grid"));
        g.appendChild(b);
      });
      box.appendChild(el("section", { class: "sec" }, [el("span", { class: "label", text: "Foto's · " + photos.length }), g]));
    }

    var log = el("div", { class: "log" });
    mine.slice(0, 10).forEach(function (e) {
      log.appendChild(el("div", { class: "log-row" }, [
        el("time", { text: timeOf(e.at) }),
        el("div", { class: "what" }, [el("span", { text: nightLabel(e.night) + " · " + (breakdown(e.counts, true) || "foto") + (e.caption ? " · “" + e.caption + "”" : "") })]),
        el("span", { class: "post-pts" + (ptsOf(e.counts) < 0 ? " neg" : ""), text: anyCount(e.counts) ? fmtPts(ptsOf(e.counts)) : "" })
      ]));
    });
    if (!mine.length) log.appendChild(el("p", { class: "empty", text: "Nog niks geregistreerd." }));
    box.appendChild(el("section", { class: "sec" }, [el("span", { class: "label", text: "Laatste registraties" }), log]));
  }

  // ---------- charts ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k])); });
    return n;
  }
  function svText(x, y, text, cls, anchor) { var t = sv("text", { x: x, y: y, class: cls, "text-anchor": anchor || "start" }); t.textContent = text; return t; }
  function niceTicks(lo, hi) {
    if (hi - lo < 1) hi = lo + 1;
    var raw = (hi - lo) / 4, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / p;
    var step = Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p);
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (var v = a; v <= b + 1e-9; v += step) out.push(Math.round(v));
    return out;
  }
  function chartWidth(host) { var w = host && host.clientWidth ? host.clientWidth : 360; return Math.max(260, Math.min(640, Math.round(w - 28))); }
  function shortNight(key) { return parseDay(key).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }); }
  function labelIdx(n) { var s = {}; [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1].forEach(function (i) { s[i] = true; }); return Object.keys(s).map(Number).sort(function (a, b) { return a - b; }); }
  function clip(s, n) { var c = chars(s); return c.length > n ? c.slice(0, n - 1).join("") + "…" : s; }
  function placeTip(card, svg, tip, xSvg, W) {
    var r = svg.getBoundingClientRect(), cr = card.getBoundingClientRect(), scale = r.width / W;
    var left = (r.left - cr.left) + xSvg * scale;
    tip.hidden = false;
    var tw = tip.offsetWidth, l = left + 12;
    if (l + tw > card.clientWidth - 4) l = left - tw - 12;
    if (l < 4) l = 4;
    tip.style.left = l + "px"; tip.style.top = (r.top - cr.top + 4) + "px";
  }
  // The chart whose tip is open: { off, svg, at }. On a phone the tip shows on a tap and goes away on a tap
  // elsewhere, when a swipe on the chart turns into scrolling (pointercancel), and on any scroll.
  var tipOff = null;
  document.addEventListener("pointerdown", function (ev) {
    if (tipOff && !(ev.target && tipOff.svg.contains(ev.target))) { var f = tipOff; tipOff = null; f.off(); }
  }, true);
  function tipRow(cls, value, label) { return el("div", { class: "t-r" }, [el("span", { class: "k " + cls }), el("b", { text: String(value) }), el("span", { text: label })]); }
  function tableBtn(key) {
    return el("button", { type: "button", class: "link-btn tbl-btn", "aria-expanded": String(!!S.tables[key]), text: S.tables[key] ? "Verberg tabel" : "Toon als tabel",
      on: { click: function () { S.tables[key] = !S.tables[key]; render(); } } });
  }
  function dataTable(head, rows) {
    var tb = el("tbody");
    rows.forEach(function (cells) { tb.appendChild(el("tr", null, cells.map(function (c, i) { return el("td", { class: i ? "n" : null, text: String(c) }); }))); });
    return el("div", { class: "tbl-wrap" }, [el("table", { class: "tbl" }, [el("thead", null, [el("tr", null, head.map(function (h, i) { return el("th", { class: i ? "n" : null, text: h }); }))]), tb])]);
  }

  // Cumulative points per night for everyone, the last 12 nights.
  function trendData() {
    var byNight = {};
    derived().ledger.forEach(function (x) { var b = byNight[x.night] || (byNight[x.night] = {}); b[x.m] = (b[x.m] || 0) + x.pts; });
    var nights = Object.keys(byNight).sort(), from = Math.max(0, nights.length - 12), cum = {}, series = {};
    S.members.forEach(function (m) { cum[m.id] = 0; series[m.id] = []; });
    nights.forEach(function (nk, i) {
      S.members.forEach(function (m) { cum[m.id] += byNight[nk][m.id] || 0; if (i >= from) series[m.id].push(cum[m.id]); });
    });
    return { nights: nights.slice(from), series: series };
  }
  function renderTrend(show) {
    var sec = $("trend-sec"); clear(sec);
    sec.hidden = !show;
    if (!show) return;
    var td = trendData(), nights = td.nights, n = nights.length;
    sec.appendChild(el("span", { class: "label", text: "Verloop · punten opgeteld per avond" }));
    if (n < 2 || !S.members.length) { sec.appendChild(el("p", { class: "hint", text: "Na de tweede avond zie je hier hoe iedereen ervoor staat." })); return; }
    function at(id, i) { var s = td.series[id]; return s ? s[i] : 0; }
    function leaderAt(i) { var lead = null; S.members.forEach(function (m) { if (lead === null || at(m.id, i) > at(lead, i)) lead = m.id; }); return lead; }
    var meOk = !!(S.meId && memberById(S.meId));
    var others = S.members.filter(function (m) { return m.id !== S.meId; });
    var cmp = S.compareId && memberById(S.compareId) && S.compareId !== S.meId ? S.compareId : null;
    if (!cmp && others.length) cmp = others.slice().sort(function (a, b) { return at(b.id, n - 1) - at(a.id, n - 1); })[0].id;
    var hi = [];
    if (meOk) hi.push({ id: S.meId, cls: "s1", label: "Jij" });
    if (cmp) hi.push({ id: cmp, cls: "s2", label: nameOf(cmp) });
    var hiIds = {}; hi.forEach(function (h) { hiIds[h.id] = true; });

    var card = el("div", { class: "chart" });
    if (others.length) {
      var chips = el("div", { class: "chips", role: "group", "aria-label": "Vergelijk met" });
      others.forEach(function (m) {
        chips.appendChild(el("button", { type: "button", class: "chip chip-sm", "aria-pressed": String(m.id === cmp), text: m.name, on: { click: function () { S.compareId = m.id; render(); } } }));
      });
      card.appendChild(el("div", { class: "sec" }, [el("span", { class: "label", text: meOk ? "Vergelijk jezelf met" : "Uitlichten" }), chips]));
    }
    var leg = el("div", { class: "legend" });
    hi.forEach(function (h) { leg.appendChild(el("span", null, [el("i", { class: "key " + h.cls }), h.label])); });
    if (S.members.length > hi.length) leg.appendChild(el("span", null, [el("i", { class: "key ctx" }), "Rest van de groep"]));
    card.appendChild(leg);

    var W = chartWidth(sec), H = 220, pl = 30, pr = 78, pt = 12, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    var lo = 0, top = 0;
    S.members.forEach(function (m) { td.series[m.id].forEach(function (v) { if (v < lo) lo = v; if (v > top) top = v; }); });
    var ticks = niceTicks(lo, top), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function X(i) { return pl + (i * iw) / (n - 1); }
    function Y(v) { return pt + ih - ((v - y0) / (y1 - y0)) * ih; }
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "img", tabindex: "0", "aria-label": "Verloop van de punten over de laatste " + n + " avonden. Gebruik de pijltjestoetsen om per avond de stand te zien." });
    ticks.forEach(function (t) {
      svg.appendChild(sv("line", { x1: pl, x2: W - pr, y1: Y(t), y2: Y(t), class: t === 0 ? "ch-base" : "ch-grid" }));
      svg.appendChild(svText(pl - 6, Y(t) + 4, String(t), "ch-tick", "end"));
    });
    labelIdx(n).forEach(function (i) { svg.appendChild(svText(X(i), H - 6, shortNight(nights[i]), "ch-tick", i === 0 ? "start" : i === n - 1 ? "end" : "middle")); });
    function pts(id) { return td.series[id].map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" "); }
    S.members.forEach(function (m) { if (!hiIds[m.id]) svg.appendChild(sv("polyline", { points: pts(m.id), class: "ch-ctx" })); });
    hi.forEach(function (h) { svg.appendChild(sv("polyline", { points: pts(h.id), class: "ch-line " + h.cls })); });
    var ends = hi.map(function (h) { return { h: h, v: at(h.id, n - 1), y: Y(at(h.id, n - 1)) }; });
    var collide = ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 15;
    ends.forEach(function (e) {
      svg.appendChild(sv("circle", { cx: X(n - 1), cy: e.y, r: 4, class: "ch-dot " + e.h.cls }));
      if (!collide) svg.appendChild(svText(X(n - 1) + 9, e.y + 4, clip(e.h.label, 7) + " " + e.v, "ch-label"));
    });
    var cross = sv("line", { y1: pt, y2: pt + ih, class: "ch-cross", visibility: "hidden" });
    svg.appendChild(cross);
    var hov = hi.map(function (h) { var c = sv("circle", { r: 4, class: "ch-dot " + h.cls, visibility: "hidden" }); svg.appendChild(c); return c; });
    svg.appendChild(sv("rect", { x: pl - 12, y: 0, width: iw + 24, height: H, fill: "transparent" }));
    card.appendChild(svg);
    var tip = el("div", { class: "tip", hidden: true });
    card.appendChild(tip);
    var cur = -1;
    function show(i) {
      cur = i; var x = X(i);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      hi.forEach(function (h, k) { hov[k].setAttribute("cx", x); hov[k].setAttribute("cy", Y(at(h.id, i))); hov[k].setAttribute("visibility", "visible"); });
      clear(tip);
      tip.appendChild(el("div", { class: "t-h", text: nightLabel(nights[i]) }));
      hi.forEach(function (h) { tip.appendChild(tipRow(h.cls, at(h.id, i), h.label)); });
      var lead = leaderAt(i);
      if (lead && !hiIds[lead]) tip.appendChild(tipRow("ctx", at(lead, i), nameOf(lead) + " (koploper)"));
      placeTip(card, svg, tip, x, W);
      tipOff = { off: hide, svg: svg, at: Date.now() };
    }
    function hide() {
      cur = -1; tip.hidden = true; cross.setAttribute("visibility", "hidden"); hov.forEach(function (c) { c.setAttribute("visibility", "hidden"); });
      if (tipOff && tipOff.off === hide) tipOff = null;
    }
    function idxAt(ev) {
      var r = svg.getBoundingClientRect(), xs = (ev.clientX - r.left) * (W / r.width);
      return Math.max(0, Math.min(n - 1, Math.round(((xs - pl) / iw) * (n - 1))));
    }
    svg.addEventListener("pointermove", function (ev) { show(idxAt(ev)); });
    svg.addEventListener("pointerdown", function (ev) { show(idxAt(ev)); });
    svg.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") hide(); });
    svg.addEventListener("pointercancel", hide);
    svg.addEventListener("focus", function () { show(cur < 0 ? n - 1 : cur); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowLeft") { ev.preventDefault(); show(Math.max(0, (cur < 0 ? n - 1 : cur) - 1)); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); show(Math.min(n - 1, (cur < 0 ? 0 : cur) + 1)); }
      else if (ev.key === "Escape") hide();
    });
    card.appendChild(tableBtn("trend"));
    if (S.tables.trend) {
      card.appendChild(dataTable(["Avond"].concat(hi.map(function (h) { return h.label; })).concat(["Koploper"]),
        nights.map(function (nk, i) { var lead = leaderAt(i); return [nightLabel(nk)].concat(hi.map(function (h) { return at(h.id, i); })).concat([nameOf(lead) + " · " + at(lead, i)]); }).reverse()));
    }
    sec.appendChild(card);
  }

  function barPath(x, w, yb, yv, r) {
    var h = Math.abs(yb - yv);
    if (h < 0.5) return "";
    r = Math.min(r, h, w / 2);
    var up = yv < yb, e = up ? yv + r : yv - r;
    return "M" + x + "," + yb + " V" + e + " Q" + x + "," + yv + " " + (x + r) + "," + yv + " H" + (x + w - r) + " Q" + (x + w) + "," + yv + " " + (x + w) + "," + e + " V" + yb + " Z";
  }
  // Points per night for one person, the last 12 nights they were out.
  function nightChart(id) {
    var by = {}, dr = {};
    derived().ledger.forEach(function (x) {
      if (x.m !== id) return;
      by[x.night] = (by[x.night] || 0) + x.pts;
      if (x.kind === "drink") dr[x.night] = (dr[x.night] || 0) + x.drinks;
    });
    var rows = Object.keys(by).sort().slice(-12).map(function (nk) { return { night: nk, pts: by[nk], drinks: dr[nk] || 0 }; });
    if (rows.length < 2) return null;
    var n = rows.length, W = chartWidth($("view-profiel")), H = 180, pl = 28, pr = 6, pt = 20, pb = 26, iw = W - pl - pr, ih = H - pt - pb;
    var lo = 0, top = 0; rows.forEach(function (r) { lo = Math.min(lo, r.pts); top = Math.max(top, r.pts); });
    var ticks = niceTicks(lo, top), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function Y(v) { return pt + ih - ((v - y0) / (y1 - y0)) * ih; }
    var band = iw / n, bw = Math.min(24, band * 0.62), best = 0;
    rows.forEach(function (r, i) { if (r.pts > rows[best].pts) best = i; });
    var card = el("div", { class: "chart" });
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "Punten per avond van " + nameOf(id) });
    ticks.forEach(function (t) {
      svg.appendChild(sv("line", { x1: pl, x2: W - pr, y1: Y(t), y2: Y(t), class: t === 0 ? "ch-base" : "ch-grid" }));
      svg.appendChild(svText(pl - 6, Y(t) + 4, String(t), "ch-tick", "end"));
    });
    var tip = el("div", { class: "tip", hidden: true });
    // One lifted bar at a time (on an iPhone a tapped bar does not always lose focus).
    var curBar = null;
    function offAll() { if (curBar) curBar.classList.remove("lift"); curBar = null; tip.hidden = true; if (tipOff && tipOff.off === offAll) tipOff = null; }
    svg.addEventListener("pointercancel", offAll);
    var lab = {}; labelIdx(n).forEach(function (i) { lab[i] = true; });
    rows.forEach(function (r, i) {
      var x0 = pl + band * i, cx = x0 + band / 2, yb = Y(0), yv = Y(r.pts);
      var bar = sv("path", { d: barPath(cx - bw / 2, bw, yb, yv, 4), class: "ch-bar" });
      svg.appendChild(bar);
      if (i === best && r.pts > 0) svg.appendChild(svText(cx, yv - 6, String(r.pts), "ch-label", "middle"));
      if (lab[i]) svg.appendChild(svText(cx, H - 6, shortNight(r.night), "ch-tick", "middle"));
      var hit = sv("rect", { x: x0, y: pt, width: band, height: ih, class: "ch-hit", tabindex: "0", role: "img",
        "aria-label": nightLabel(r.night) + ": " + r.pts + " punten, " + r.drinks + " " + drinksWord(r.drinks) });
      function on() {
        if (curBar && curBar !== bar) curBar.classList.remove("lift");
        curBar = bar; bar.classList.add("lift"); clear(tip);
        tip.appendChild(el("div", { class: "t-h", text: nightLabel(r.night) }));
        tip.appendChild(tipRow("s1", r.pts, "punten"));
        tip.appendChild(tipRow("none", r.drinks, drinksWord(r.drinks)));
        placeTip(card, svg, tip, cx, W);
        tipOff = { off: offAll, svg: svg, at: Date.now() };
      }
      hit.addEventListener("pointerenter", function (ev) { if (ev.pointerType === "mouse") on(); });
      hit.addEventListener("pointerdown", on);
      hit.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") offAll(); });
      hit.addEventListener("focus", on);
      hit.addEventListener("blur", function () { if (curBar === bar) offAll(); });
      svg.appendChild(hit);
    });
    card.appendChild(svg);
    card.appendChild(tip);
    card.appendChild(tableBtn("nights"));
    if (S.tables.nights) card.appendChild(dataTable(["Avond", "Punten", "Drankjes"], rows.slice().reverse().map(function (r) { return [nightLabel(r.night), r.pts, r.drinks]; })));
    return el("section", { class: "sec" }, [el("span", { class: "label", text: "Punten per avond · laatste " + n }), card]);
  }

  // ---------- actions ----------
  function findName(name, exceptId) {
    var k = name.toLowerCase();
    for (var i = 0; i < S.members.length; i++) if (S.members[i].id !== exceptId && S.members[i].name.toLowerCase() === k) return S.members[i];
    return null;
  }
  // Letters only, so "Sem 2", "sem." and "Semmie" all look like "Sem".
  function nameKey(s) { return String(s || "").toLowerCase().replace(/[^a-z\u00df-\u024f]+/g, ""); }
  function nearName(name) {
    var k = nameKey(name);
    if (k.length < 2) return null;
    for (var i = 0; i < S.members.length; i++) {
      var mk = nameKey(S.members[i].name);
      if (mk.length >= 2 && (k.indexOf(mk) === 0 || mk.indexOf(k) === 0)) return S.members[i];
    }
    return null;
  }
  function validName(raw, exceptId) {
    var name = str(raw, 24);
    if (!name) { toast("Vul een naam in."); return null; }
    var dup = findName(name, exceptId);
    if (dup) { toast(dup.name + " staat al in de groep."); return null; }
    return name;
  }
  // "Wie ben jij?" with a typed name. Someone whose name is already there (maybe "bezet" because
  // it is still on his old phone) is sent to his own chip instead of making "Sem2".
  function whoAdd(raw) {
    var name = str(raw, 24);
    if (!name) { toast("Vul je naam in."); return Promise.resolve(); }
    var dup = findName(name);
    if (dup) { pointTo(dup, dup.name + " staat er al. Tik hierboven op je naam."); return Promise.resolve(); }
    var near = nearName(name);
    if (near && S.nearOk !== name.toLowerCase()) {
      S.nearOk = name.toLowerCase();
      pointTo(near, "Bedoel je " + near.name + "? Tik dan hierboven op je naam. Ben je iemand anders, tik nog eens op Dit ben ik.");
      return Promise.resolve();
    }
    return addMember(name, true);
  }
  function pointTo(m, msg) {
    if ($("who-add-name")) $("who-add-name").blur();
    S.whoHl = m.id;
    toast(msg);
    if (takenByOther(m)) arm("take:" + m.id, 8000); else render();
    setTimeout(function () { if (S.whoHl === m.id) { S.whoHl = null; render(); } }, 8000);
    [].forEach.call($("who-chips").childNodes, function (c) {
      if (c.getAttribute && c.getAttribute("data-mid") === m.id && c.scrollIntoView) c.scrollIntoView({ block: "nearest", inline: "center" });
    });
  }
  // A failed write with its own message; the special cases (refused, gone, full) as everywhere else.
  function failed(e, msg) {
    var c = e && e.code;
    if (c === "not_found" || c === "invalid_argument" || c === "not_granted" || c === "quota_exceeded") { writeError(e, ""); return; }
    errToast(msg); render();
  }
  function addMember(raw, makeMe) {
    if (!canWriteNow()) return Promise.resolve();
    if (S.members.length >= MAX_MEMBERS) { toast("De groep is vol (15 namen)."); return Promise.resolve(); }
    var name = validName(raw); if (!name) return Promise.resolve();
    var ref = S.db.collection("members").doc();
    return withRetry(function () { return ref.set({ name: name, createdAt: nowIso(), by: S.uid || null, uid: makeMe ? (S.uid || null) : null }); })
      .then(function () {
        if (makeMe) setMe(ref.id, true, true);
        toast(makeMe ? "Je staat erin als " + name + "." : name + " is toegevoegd.");
        return true;
      })
      .catch(function (e) { writeError(e, "Naam toevoegen"); });
  }
  function renameMember(m, raw) {
    var name = validName(raw, m.id); if (!name) return;
    if (name === m.name) { S.editing = null; render(); return; }
    q("members/" + m.id, function () { return S.db.doc("members/" + m.id).update({ name: name }); })
      .then(function () { S.editing = null; if (document.activeElement) document.activeElement.blur(); toast("Naam gewijzigd in " + name + "."); render(); })
      .catch(function (e) { writeError(e, "Naam wijzigen"); });
  }
  // Only offered for a name nobody has done anything with. Undo puts it back with the same id.
  function removeMember(m) {
    // The list may have changed since the button was drawn.
    m = memberById(m.id); if (!m) { render(); return; }
    if (takenByOther(m) || memberActivity()[m.id]) { toast(m.name + " is net in gebruik genomen. Verwijderen kan niet meer."); render(); return; }
    var snap = { name: m.name, createdAt: m.createdAt || nowIso(), by: m.by || null, uid: m.uid || null }, wasMe = S.meId === m.id;
    if (wasMe) knownMe = null; // we know: no "Je naam is uit de groep gehaald" here
    q("members/" + m.id, function () { return S.db.doc("members/" + m.id).delete(); })
      .then(function () {
        if (wasMe) setMe(null, false, true);
        toast(m.name + " is verwijderd.", function () {
          q("members/" + m.id, function () { return S.db.doc("members/" + m.id).set(snap); })
            .then(function () { if (wasMe && !S.meId) setMe(m.id, true, true); toast(m.name + " is terug."); })
            .catch(function (e) { failed(e, m.name + " terugzetten is niet gelukt. Check je bereik en voeg de naam opnieuw toe."); });
        });
      })
      .catch(function (e) { writeError(e, "Naam verwijderen"); });
  }
  // Unlink a name from the device that has it, so its owner can pick it again.
  function freeName(m) {
    m = memberById(m.id);
    if (!m || !takenByOther(m)) { render(); return; }
    var prevUid = m.uid;
    q("members/" + m.id, function () { return S.db.doc("members/" + m.id).update({ uid: null }); })
      .then(function () {
        toast(m.name + " is vrijgegeven. Wie " + m.name + " is, tikt zijn naam opnieuw aan.", function () {
          var cur = memberById(m.id);
          if (!cur || cur.uid) { toast(m.name + " is intussen al opnieuw gekozen."); return; }
          q("members/" + m.id, function () { return S.db.doc("members/" + m.id).update({ uid: prevUid }); })
            .then(function () { toast(m.name + " is weer gekoppeld."); })
            .catch(function (e) { failed(e, "Terugzetten is niet gelukt. Check je bereik."); });
        });
      })
      .catch(function (e) { failed(e, "Vrijgeven is niet gelukt. Check je bereik en probeer het opnieuw."); });
  }
  // "Ben jij X?" confirmed on a name that is in use on another device: move it to this device.
  // The other device notices and says so (see checkMe).
  function takeOver(m) {
    if (!canWriteNow() || !S.uid) { toast("Overnemen lukt nu niet. Tik bovenaan op Opnieuw verbinden."); return; }
    var prev = S.meId;
    q("members/" + m.id, function () { return S.db.doc("members/" + m.id).update({ uid: S.uid }); })
      .then(function () {
        setMe(m.id, true, true);
        toast("Je bent nu " + m.name + " op dit toestel.", function () { undoMe(prev); });
      })
      .catch(function (e) { failed(e, "Overnemen is niet gelukt. Check je bereik en tik nog eens op je naam."); });
  }
  function undoMe(prev) {
    setMe(prev && memberById(prev) ? prev : null, false, true);
    toast(S.meId ? "Je bent weer " + nameOf(S.meId) + "." : "Kies je naam opnieuw.");
  }
  function claim(id) {
    claimTryAt = Date.now(); claimBusy = true;
    q("members/" + id, function () { return S.db.doc("members/" + id).update({ uid: S.uid }); })
      .catch(noop).then(function () { claimBusy = false; });
  }
  // quiet: no "Je bent nu X" toast (the caller shows its own, or this is an undo).
  function setMe(id, skipClaim, quiet) {
    var prev = S.meId;
    S.meId = id; if (id) S.forId = id;
    safeSet(KEYS.me, id || ""); saveDraft();
    if (id !== prev) { claimedId = null; safeSet(KEYS.claimed, ""); }
    if (S.db && S.uid) {
      var pm = prev && memberById(prev);
      if (pm && isMyUid(pm.uid) && prev !== id && canWriteNow()) q("members/" + prev, function () { return S.db.doc("members/" + prev).update({ uid: null }); }).catch(noop);
      var nm = id && memberById(id);
      if (!skipClaim && nm && !nm.uid && canWriteNow()) claim(id);
    }
    pushPresence(); render();
    if (!quiet && id && id !== prev && memberById(id)) toast("Je bent nu " + nameOf(id) + ".", function () { undoMe(prev); });
  }
  // ----- the draft: what is counted here but not registered yet -----
  // Kept with the night it belongs to (set on the first tap), the time of the last tap and who it is
  // for. (pending: the entry id of a save from an older version of the app that got no answer; the
  // next registration reuses it, so nothing is doubled.)
  function saveDraft() {
    var has = anyCount(S.counts);
    safeSet(KEYS.draft, JSON.stringify({ v: 2, counts: S.counts, night: has ? S.draftNight : null, at: S.draftAt,
      forId: has ? S.forId : null, caption: S.caption || "", pending: S.pending ? { id: S.pending.id } : null }));
  }
  function saveStale() { safeSet(KEYS.stale, JSON.stringify(S.stale.map(function (it) { return { id: it.id, counts: it.counts, night: it.night, at: it.at, forId: it.forId, caption: it.caption }; }))); }
  function entryId() { return S.db ? S.db.collection("entries").doc().id : (newId() + newId()).slice(0, 20); }
  // From another night and no tap for two hours: no longer part of tonight. A night counted until
  // 06:50 and registered at 07:15 still belongs to that night.
  function isStale(night, at, now) {
    if (night && night === nightKey(now)) return false;
    var t = at ? Date.parse(at) : NaN;
    return !(t && now - t <= STALE_MS);
  }
  // Moves the tally in the counter to its own card when it is from an earlier night. True when it did.
  function checkStale() {
    if (!anyCount(S.counts) || !isStale(S.draftNight, S.draftAt, new Date())) return false;
    S.stale.push({ id: S.pending ? S.pending.id : entryId(), counts: cleanCounts(S.counts), night: S.draftNight, at: S.draftAt, forId: S.forId, caption: str(S.caption, 140) });
    saveStale();
    S.counts = zero(); S.draftNight = null; S.draftAt = null; S.pending = null;
    S.caption = ""; $("caption").value = "";
    if (!noMe()) S.forId = S.meId;
    saveDraft();
    return true;
  }
  function loadDraft() {
    var raw = null, list = null;
    try { raw = JSON.parse(safeGet(KEYS.draft) || "null"); } catch (e) {}
    try { list = JSON.parse(safeGet(KEYS.stale) || "[]"); } catch (e) {}
    S.stale = (Array.isArray(list) ? list : []).map(function (x) {
      x = obj(x); var c = cleanCounts(x.counts);
      return anyCount(c) && typeof x.id === "string" && x.id ? { id: x.id.slice(0, 40), counts: c, night: validNight(x.night), at: isoOr(x.at), forId: strOrNull(x.forId), caption: str(x.caption, 140) } : null;
    }).filter(Boolean);
    // Before v2 the draft was only the counts, without a night: treat those as from an earlier night.
    var d = raw && raw.v === 2 ? raw : { counts: raw }, counts = cleanCounts(obj(d.counts));
    var night = validNight(d.night), at = isoOr(d.at), pend = obj(d.pending), pid = typeof pend.id === "string" && pend.id ? pend.id.slice(0, 40) : null;
    var caption = typeof d.caption === "string" ? d.caption.slice(0, 140) : "";
    if (anyCount(counts) && isStale(night, at, new Date())) {
      S.stale.push({ id: pid || entryId(), counts: counts, night: night, at: at, forId: strOrNull(d.forId), caption: str(caption, 140) });
      saveStale(); saveDraft();
      return;
    }
    if (!anyCount(counts) && !(at && Date.now() - Date.parse(at) <= STALE_MS)) caption = "";
    S.counts = counts; S.draftNight = anyCount(counts) ? night : null; S.draftAt = at;
    S.caption = caption; $("caption").value = caption;
    // Counting for a friend survives a reload (iOS throws away a tab in the background).
    if (anyCount(counts) && strOrNull(d.forId)) S.forId = d.forId;
    if (pid) S.pending = { id: pid };
  }
  function resetCompose() {
    S.counts = zero(); S.draftNight = null; S.draftAt = null; S.pending = null;
    S.caption = ""; $("caption").value = "";
    if (S.photo) { URL.revokeObjectURL(S.photo.url); S.photo = null; }
    saveDraft();
  }
  // Takes off only what was saved: what was tapped, typed or picked meanwhile stays.
  function takeOff(job) {
    DRINKS.forEach(function (d) { S.counts[d.key] = Math.max(0, (S.counts[d.key] || 0) - (job.counts[d.key] || 0)); });
    if (str(S.caption, 140) === job.caption) { S.caption = ""; $("caption").value = ""; }
    if (job.photo && S.photo === job.photo) { URL.revokeObjectURL(job.photo.url); S.photo = null; }
    if (!anyCount(S.counts)) { S.draftNight = null; S.draftAt = null; }
  }
  // Undo: adds the counts back to whatever is in the counter now, and the caption and photo
  // only where there is none yet, so nothing tapped since is overwritten.
  function putBack(job) {
    if (!anyCount(S.counts) && anyCount(job.counts)) S.draftNight = job.night || nightKey(new Date());
    DRINKS.forEach(function (d) { S.counts[d.key] = Math.min(MAX_PER_COUNTER, (S.counts[d.key] || 0) + (job.counts[d.key] || 0)); });
    S.draftAt = nowIso();
    if (!str(S.caption, 140) && job.caption) { S.caption = job.caption; $("caption").value = job.caption; }
    if (memberById(job.forId)) S.forId = job.forId;
    if (job.pending && !S.pending) S.pending = job.pending;
    saveDraft();
    if (!S.photo && job.photo) setPhoto(job.photo.blob, job.photo.w, job.photo.h); else render();
  }
  // ---------- outbox: registrations that are not on the server yet ----------
  // A registration goes in here the moment Registreer is tapped, with its own id, its time and its
  // night, and leaves only once the server has it. It is kept in localStorage, so no reception, a
  // closed tab or an iPhone that throws the app away loses nothing (the photo too, when it fits).
  // Sending it again can never double it: create() never overwrites. Taking back one that may
  // already have arrived turns it into a "del", which goes out the same way.
  var PHOTO_ROOM = 2500000, BACKOFF = [3000, 15000, 30000, 60000, 120000];
  // itemToast: the registration the toast on screen is about. loudUntil: a "Nu proberen" tap wants to hear back.
  var sendingId = null, outboxT = null, notes = {}, blobs = {}, itemToast = null, loudUntil = 0;
  function curGrp() { var g = BK && BK.group ? BK.group() : null; return (g && g.id) || null; }
  function ours(it) { var g = curGrp(); return !it.grp || !g || it.grp === g; }
  function outboxItem(id) { for (var i = 0; i < S.outbox.length; i++) if (S.outbox[i].id === id) return S.outbox[i]; return null; }
  function waiting() { return S.outbox.filter(function (it) { return it.kind === "set" && !it.cancel && ours(it); }); }
  function saveOutbox() {
    function dump() { return JSON.stringify(S.outbox.map(function (it) { var o = {}; Object.keys(it).forEach(function (k) { if (k !== "cancel" && k !== "volatile") o[k] = it[k]; }); return o; })); }
    if (trySet(KEYS.outbox, dump())) return true;
    // Storage full: keep the registrations; their photos then only live while the app stays open.
    S.outbox.forEach(function (it) { if (it.photoData) { it.photoData = null; it.volatile = true; } });
    return trySet(KEYS.outbox, dump());
  }
  function loadOutbox() {
    var raw = null;
    try { raw = JSON.parse(safeGet(KEYS.outbox) || "[]"); } catch (e) {}
    S.outbox = (Array.isArray(raw) ? raw : []).map(function (x) {
      x = obj(x);
      if (typeof x.id !== "string" || !x.id || x.id.length > 40) return null;
      var it = { id: x.id, grp: strOrNull(x.grp), kind: x.kind === "del" ? "del" : "set", tries: clampInt(x.tries, 0, 1e6, 0), fails: clampInt(x.fails, 0, 1e6, 0),
        queuedAt: clampNum(x.queuedAt, 0, 9e15, Date.now()), nextAt: 0, asset: typeof x.asset === "string" && x.asset ? x.asset : null };
      if (it.kind === "del") return it;
      var b = obj(x.body);
      if (typeof b.memberId !== "string" || !isoOr(b.at) || !validNight(b.night)) return null;
      it.body = { memberId: b.memberId, by: strOrNull(b.by), counts: cleanCounts(b.counts), at: b.at, night: b.night, likes: {}, comments: {} };
      if (str(b.caption, 140)) it.body.caption = str(b.caption, 140);
      if (clampInt(b.photoW, 0, 4000, 0) && clampInt(b.photoH, 0, 4000, 0)) { it.body.photoW = clampInt(b.photoW, 0, 4000, 0); it.body.photoH = clampInt(b.photoH, 0, 4000, 0); }
      it.photo = !!x.photo;
      it.photoData = typeof x.photoData === "string" && x.photoData.indexOf("data:image/") === 0 ? x.photoData : null;
      it.photoNote = typeof x.photoNote === "string" ? x.photoNote.slice(0, 30) : "";
      return it;
    }).filter(Boolean);
  }
  function queue(id, body, blob, asset) {
    var old = outboxItem(id);
    if (old) S.outbox.splice(S.outbox.indexOf(old), 1);
    var it = { id: id, grp: curGrp(), kind: "set", body: body, tries: 0, fails: 0, queuedAt: Date.now(), nextAt: 0, asset: asset || null,
      photo: !!(blob || asset), photoData: null, photoNote: "" };
    S.outbox.push(it);
    if (blob && !asset) { blobs[id] = blob; keepPhoto(it, blob); }
    saveOutbox(); mergeQueued();
    return it;
  }
  function delOf(it) { return { id: it.id, grp: it.grp, kind: "del", tries: 0, fails: 0, queuedAt: Date.now(), nextAt: 0, asset: it.asset || null }; }
  // The photo as text in localStorage, next to its registration, when there is room for it.
  function keepPhoto(it, blob) {
    if (typeof FileReader !== "function") { it.volatile = true; return; }
    var r = new FileReader();
    r.onload = function () {
      if (S.outbox.indexOf(it) < 0 || it.asset) return;
      var data = String(r.result || ""), used = 0;
      S.outbox.forEach(function (x) { if (x !== it && x.photoData) used += x.photoData.length; });
      if (data.indexOf("data:image/") === 0 && used + data.length <= PHOTO_ROOM) {
        it.photoData = data; it.volatile = false;
        if (saveOutbox() && it.photoData) return;
      }
      it.photoData = null; it.volatile = true; saveOutbox();
    };
    r.onerror = function () { it.volatile = true; };
    r.readAsDataURL(blob);
  }
  function dataBlob(s) {
    try {
      var m = /^data:([^;,]+);base64,(.*)$/.exec(s || "");
      if (!m) return null;
      var bin = atob(m[2]), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return new Blob([a], { type: m[1] });
    } catch (e) { return null; }
  }
  function dropPhoto(it, why) { it.photo = false; it.photoData = null; it.photoNote = why; delete blobs[it.id]; saveOutbox(); }
  // Uploads the photo once (a retry reuses the stored asset). No answer: try again later. A photo
  // that can never go (too big, wrong type, storage full, or refused three times): the drinks go
  // without it, and the toast says so.
  function photoFor(it) {
    if (!it.photo) return Promise.resolve(null);
    if (it.asset) return Promise.resolve(it.asset);
    var blob = blobs[it.id] || dataBlob(it.photoData);
    if (!blob || !S.assets) { dropPhoto(it, "lost"); return Promise.resolve(null); }
    return S.assets.upload(blob, { type: blob.type || "image/jpeg" }).then(function (a) {
      it.asset = a.id; it.photoData = null; delete blobs[it.id]; saveOutbox();
      return a.id;
    }, function (e) {
      var c = (e && e.code) || "unavailable";
      if (c === "too_large" || c === "unsupported_type" || c === "quota_or_state") { dropPhoto(it, c); return null; }
      if (c !== "unavailable" && c !== "rate_limited" && (it.photoFails = (it.photoFails || 0) + 1) >= 3) { dropPhoto(it, "failed"); return null; }
      throw { code: "unavailable", message: "foto: " + c };
    });
  }
  function photoNoteText(why) {
    if (!why) return "";
    if (why === "too_large") return " De foto was te groot en is niet meegestuurd.";
    if (why === "unsupported_type") return " Dit soort foto werkt niet en is niet meegestuurd.";
    if (why === "quota_or_state") return " De opslag voor foto's is vol, dus de foto is niet meegestuurd.";
    if (why === "lost") return " De foto kon niet op je telefoon bewaard worden en is niet meegestuurd.";
    return " De foto lukte niet en is niet meegestuurd.";
  }
  // One at a time, oldest first. now: also the ones that are waiting for their next try (a tap,
  // the network or the app coming back). Resolves with the error that stopped it, or null.
  function flushOutbox(now) {
    clearTimeout(outboxT); outboxT = null;
    if (sendingId || !S.db || !canWriteNow()) return Promise.resolve(null);
    var t = Date.now(), it = null;
    for (var i = 0; i < S.outbox.length && !it; i++) { var x = S.outbox[i]; if (ours(x) && !x.cancel && (now || x.nextAt <= t)) it = x; }
    if (!it) { planFlush(); return Promise.resolve(null); }
    sendingId = it.id; render();
    return Promise.resolve().then(function () { return sendOne(it); }).then(null, function (e) { return e || { code: "unavailable" }; }).then(function (e) {
      sendingId = null;
      if (!e) return flushOutbox(now);
      planFlush(); render();
      return e;
    });
  }
  function planFlush() {
    clearTimeout(outboxT); outboxT = null;
    var next = Infinity;
    S.outbox.forEach(function (x) { if (ours(x)) next = Math.min(next, x.nextAt || 0); });
    if (next < Infinity) outboxT = setTimeout(function () { flushOutbox(false); }, Math.max(1000, next - Date.now()));
  }
  function sendOne(it) {
    it.tries++;
    var path = "entries/" + it.id, p;
    if (it.kind === "del") p = S.db.doc(path).delete();
    else p = photoFor(it).then(function (asset) {
      var body = JSON.parse(JSON.stringify(it.body));
      if (asset) body.photo = asset;
      return S.db.doc(path).create(body);
    });
    return p.then(function () {
      var at = S.outbox.indexOf(it);
      if (at < 0) return null; // taken back and put back meanwhile: the new one goes by itself
      if (it.cancel) S.outbox.splice(at, 1, delOf(it)); else S.outbox.splice(at, 1);
      if (it.kind === "del" && it.asset && S.assets) S.assets.delete(it.asset).catch(noop);
      saveOutbox(); mergeQueued();
      if (it.kind === "set" && !it.cancel) sent(it);
      render();
      return null;
    }, function (e) {
      var at = S.outbox.indexOf(it);
      if (at < 0) return null;
      // Taken back while it was on its way: it may have arrived anyway, so delete it to be sure.
      if (it.cancel) { S.outbox.splice(at, 1, delOf(it)); saveOutbox(); mergeQueued(); return null; }
      it.fails++; it.nextAt = Date.now() + BACKOFF[Math.min(it.fails, BACKOFF.length) - 1];
      var c = e && e.code;
      if (c === "invalid_argument" || c === "not_granted") S.readOnly = true;
      saveOutbox();
      if (it.kind === "set") notSent(it, e);
      return e || { code: "unavailable" };
    });
  }
  function cancelItem(it) {
    if (sendingId === it.id) it.cancel = true;
    else {
      var at = S.outbox.indexOf(it);
      if (at < 0) return;
      // Tried before: that try may have arrived after all.
      if (it.tries || it.asset) S.outbox.splice(at, 1, delOf(it)); else S.outbox.splice(at, 1);
    }
    delete blobs[it.id]; delete notes[it.id];
    saveOutbox(); mergeQueued();
    flushOutbox(true);
  }
  function whenText(b) { return b.night === nightKey(new Date()) ? "" : " (avond van " + nightLabel(b.night) + ")"; }
  function undoFor(it, n) { return n ? function () { undoRegister(it.id, it.asset, n.restore, n.undoMsg); } : null; }
  function sent(it) {
    var n = notes[it.id], b = it.body;
    delete notes[it.id];
    if (!S.uid) localIds[it.id] = true;
    var what = (breakdown(b.counts, true) || "foto") + "." + photoNoteText(it.photoNote);
    var loud = (n && n.fresh) || it.photoNote || Date.now() < loudUntil || (itemToast === it.id && !$("toast").hidden);
    if (n && n.fresh) toast("Geregistreerd voor " + nameOf(b.memberId) + whenText(b) + ": " + what + (n.back ? " Je turft nu weer voor jezelf." : ""), undoFor(it, n));
    else (loud ? toast : softToast)("Toch nog opgeslagen voor " + nameOf(b.memberId) + whenText(b) + ": " + what, undoFor(it, n));
    itemToast = it.id;
  }
  // Only said for the try right after the tap; after that the banner says what is waiting.
  function notSent(it, e) {
    var n = notes[it.id];
    if (!n || !n.fresh) return;
    n.fresh = false;
    var c = e && e.code;
    if (c === "invalid_argument" || c === "not_granted") errToast("Opslaan lukt nu niet. Je registratie blijft bewaard op je telefoon. Tik op Opnieuw verbinden.", { label: "Opnieuw verbinden", fn: reconnect });
    else if (c === "quota_exceeded") errToast("De opslag is vol. Je registratie blijft bewaard op je telefoon. Vraag wie de app beheert om op te ruimen.");
    else toast("Geen bereik. Je registratie is bewaard en gaat vanzelf zodra je bereik hebt." + (it.photo && it.volatile && !it.asset ? " Laat de app open, dan gaat de foto mee." : ""), undoFor(it, n));
    itemToast = it.id;
  }
  // The server copy of one that is still waiting here arrived (an earlier try got through after
  // all): done, no need to send it again.
  function settleOutbox() {
    (S.entriesSrv || []).forEach(function (e) {
      var it = e.pending ? null : outboxItem(e.id);
      if (!it || it.kind !== "set" || it.cancel || sendingId === it.id) return;
      S.outbox.splice(S.outbox.indexOf(it), 1);
      if (e.photo) it.asset = e.photo;
      saveOutbox(); sent(it);
    });
  }
  // What the lists show: the server's registrations plus the ones still waiting here, minus the
  // ones taken back that the server does not know about yet.
  function mergeQueued() {
    var hide = {}, mine = {}, have = {}, list = [];
    S.outbox.forEach(function (it) { if (!ours(it)) return; if (it.kind === "del" || it.cancel) hide[it.id] = true; else mine[it.id] = it; });
    (S.entriesSrv || []).forEach(function (e) {
      if (hide[e.id]) return;
      e.queued = !!mine[e.id]; have[e.id] = true; list.push(e);
    });
    Object.keys(mine).forEach(function (id) {
      if (have[id]) return;
      var b = mine[id].body;
      list.push({ id: id, memberId: b.memberId, by: b.by, counts: b.counts, at: b.at, night: b.night, caption: b.caption || "", photo: null,
        likes: {}, comments: [], local: true, queued: true, withPhoto: mine[id].photo });
    });
    S.entries = list; S.ver++;
  }
  function retryOutbox() {
    if (sendingId) return;
    if (navigator.onLine === false) { toast("Nog geen bereik. Je registraties gaan vanzelf zodra je internet hebt."); return; }
    if (!canWriteNow()) { reconnect(); return; }
    loudUntil = Date.now() + 30000;
    flushOutbox(true).then(function (e) {
      if (e) toast("Lukt nog niet. Je registraties blijven bewaard en we proberen het vanzelf opnieuw.");
    });
  }
  function notYet() { toast("Even geduld: deze registratie is nog niet verstuurd."); }

  // Registers what is in the counter now: into the outbox, the counter empties right away (only of
  // what was registered), and it goes out by itself, now or as soon as there is reception.
  function register() {
    var block = regBlock();
    // The second tap of a double tap finds the counter just emptied: nothing to say.
    if (block === "empty" && Date.now() - S.lastRegAt < 1500) return;
    if (block) { explainBlock(block); return; }
    if (checkStale()) { render(); window.scrollTo(0, 0); toast("Deze telling is van een eerdere avond. Kies bovenaan wat je ermee wilt."); return; }
    var photo = S.photo && S.assets ? S.photo : null;
    var job = { counts: cleanCounts(S.counts), forId: S.forId, caption: str(S.caption, 140), photo: photo,
      night: anyCount(S.counts) && S.draftNight ? S.draftNight : nightKey(new Date()) };
    // The time and night are those of the tap, also when it only goes out tomorrow morning.
    var id = (S.pending && S.pending.id) || entryId();
    var body = { memberId: job.forId, by: S.uid || null, counts: job.counts, at: nowIso(), night: job.night, likes: {}, comments: {} };
    if (job.caption) body.caption = job.caption;
    if (photo && photo.w && photo.h) { body.photoW = photo.w; body.photoH = photo.h; }
    S.pending = null;
    takeOff(job);
    // Counted for a friend: the next round is for yourself again.
    var back = false;
    if (job.forId !== S.meId && S.forId === job.forId) { back = !noMe(); S.forId = back ? S.meId : null; }
    saveDraft();
    S.lastRegAt = Date.now();
    queue(id, body, photo ? photo.blob : null);
    notes[id] = { fresh: true, back: back, restore: function () { putBack(job); }, undoMsg: "Teruggedraaid. De drankjes staan weer in je teller." };
    render();
    flushOutbox(true);
  }
  // Undo of your own registration. Still waiting here: taken out (and deleted, if a try may have
  // arrived). Already on the server: deleted through the outbox too, so it also works offline.
  function undoRegister(id, asset, restore, msg) {
    var it = outboxItem(id);
    if (it && it.kind === "set") cancelItem(it);
    else {
      if (it) S.outbox.splice(S.outbox.indexOf(it), 1);
      S.outbox.push({ id: id, grp: curGrp(), kind: "del", tries: 0, fails: 0, queuedAt: Date.now(), nextAt: 0, asset: asset || null });
      saveOutbox(); mergeQueued(); flushOutbox(true);
    }
    if (restore) restore();
    toast(msg); render();
  }
  function registerStale(it) {
    if (!canWriteNow()) { explainBlock("offline"); return; }
    var who = memberById(it.forId) ? it.forId : noMe() ? null : S.meId;
    if (!who) { explainBlock(S.loaded.members ? "who" : "loading"); return; }
    var i = S.stale.indexOf(it);
    if (i < 0) return;
    var night = it.night || nightKey(new Date());
    var body = { memberId: who, by: S.uid || null, counts: it.counts, at: it.night && it.at ? it.at : nowIso(), night: night, likes: {}, comments: {} };
    if (it.caption) body.caption = it.caption;
    S.stale.splice(i, 1); saveStale();
    queue(it.id, body, null);
    notes[it.id] = { fresh: true, back: false, undoMsg: "Teruggedraaid. De telling staat weer bovenaan bij Tellen.",
      restore: function () { S.stale.splice(Math.max(0, Math.min(i, S.stale.length)), 0, it); saveStale(); } };
    render();
    flushOutbox(true);
  }
  function dropStale(it) {
    var i = S.stale.indexOf(it); if (i < 0) return;
    S.stale.splice(i, 1); saveStale(); render();
    toast("Weggegooid: " + breakdown(it.counts, true) + ".", function () { S.stale.splice(Math.min(i, S.stale.length), 0, it); saveStale(); render(); });
  }
  function entryBody(e) {
    var comments = {};
    e.comments.forEach(function (c) { comments[c.id] = { memberId: c.memberId, by: c.by, text: c.text, at: c.at }; });
    var b = { memberId: e.memberId, by: e.by, counts: e.counts, at: e.at, night: e.night, likes: e.likes, comments: comments };
    if (e.caption) b.caption = e.caption;
    if (e.photo) { b.photo = e.photo; if (e.photoW && e.photoH) { b.photoW = e.photoW; b.photoH = e.photoH; } }
    return b;
  }
  // Undo puts it back with the same id, likes and comments. The photo is removed only once undo
  // is no longer possible (a closed tab in between leaves at worst one unused photo in storage).
  function removeEntry(e) {
    var it = outboxItem(e.id);
    if (it && it.kind === "set") {
      var copy = { body: it.body, blob: blobs[it.id] || dataBlob(it.photoData), asset: it.asset };
      cancelItem(it);
      toast("Registratie van " + nameOf(e.memberId) + " verwijderd.", function () {
        queue(e.id, copy.body, copy.blob, copy.asset); flushOutbox(true);
        toast("Registratie teruggezet."); render();
      });
      render();
      return;
    }
    var path = "entries/" + e.id, body = entryBody(e), photoT = null;
    q(path, function () { return S.db.doc(path).delete(); })
      .then(function () {
        if (e.photo && S.assets) photoT = setTimeout(function () { S.assets.delete(e.photo).catch(noop); }, 15000);
        toast("Registratie van " + nameOf(e.memberId) + " verwijderd.", function () {
          clearTimeout(photoT);
          q(path, function () { return S.db.doc(path).set(body); })
            .then(function () { if (e.local) localIds[e.id] = true; toast("Registratie teruggezet."); render(); })
            .catch(function (err) { failed(err, "Terugzetten is niet gelukt. Check je bereik."); });
        });
      })
      .catch(function (err) { writeError(err, "Registratie verwijderen"); });
  }
  function findEntry(id) { for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) return S.entries[i]; return null; }
  function upd(path, patch) { return q(path, function () { return S.db.doc(path).update(patch); }); }
  function findById(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function toggleLike(entryId, btn) {
    if (!requireMe()) return;
    var e = findEntry(entryId); if (!e) return;
    if (e.queued) { notYet(); return; }
    var liked = !!e.likes[S.meId], patch = { likes: {} };
    patch.likes[S.meId] = !liked;
    if (!liked && btn) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
    upd("entries/" + entryId, patch).catch(function (err) { writeError(err, "Proosten", function () { toggleLike(entryId); }); });
  }
  function addComment(entryId, raw) {
    if (!requireMe()) return;
    var text = str(raw, 280); if (!text) return;
    var cid = newId(), patch = { comments: {} };
    patch.comments[cid] = { memberId: S.meId, by: S.uid || null, text: text, at: nowIso() };
    S.commentDrafts[entryId] = "";
    // The keyboard closes: the comment shows at once (the feed is not redrawn under a field you are
    // typing in), and a toast is not hidden behind the keyboard.
    var inp = $("cmt-" + entryId); if (inp) { inp.value = ""; inp.blur(); }
    upd("entries/" + entryId, patch)
      .catch(function (err) {
        S.commentDrafts[entryId] = text;
        var i = $("cmt-" + entryId); if (i && !i.value) i.value = text; // the text comes back in the field
        writeError(err, "Reageren", function () { addComment(entryId, text); });
      });
  }
  // One tap, then a toast to undo it (the comment comes back as it was).
  function removeComment(entryId, c) {
    var path = "entries/" + entryId, patch = { comments: {} }; patch.comments[c.id] = null;
    upd(path, patch).then(function () {
      toast("Reactie verwijderd.", function () {
        var back = { comments: {} }; back.comments[c.id] = { memberId: c.memberId, by: c.by || null, text: c.text, at: c.at };
        upd(path, back).then(function () { toast("Reactie teruggezet."); }).catch(function (err) { writeError(err, "Terugzetten"); });
      });
    }).catch(function (err) { writeError(err, "Reactie verwijderen"); });
  }
  // raw: the document as it was, so the toast can put it back.
  function deleteDoc(path, msg, raw) {
    q(path, function () { return S.db.doc(path).delete(); }).then(function () {
      toast(msg, raw ? function () {
        q(path, function () { return S.db.doc(path).set(raw); }).then(function () { toast("Teruggezet."); }).catch(function (e) { writeError(e, "Terugzetten"); });
      } : null);
    }).catch(function (e) { writeError(e, "Verwijderen"); });
  }
  function claimOf(c, mid) { var r = null; c.claims.forEach(function (x) { if (x.memberId === mid) r = x; }); return r; }
  // The newest copy of a challenge and of one claim on it: the screen may be a few seconds old.
  function liveClaim(c, mid) { var cur = findById(S.challenges, c.id); return cur ? claimOf(cur, mid) : null; }
  function claimChallenge(c) {
    if (!requireMe()) return;
    var cur = findById(S.challenges, c.id);
    if (!cur) { render(); return; }
    if (cur.closed) { toast("Deze uitdaging is gestopt. Meedoen kan niet meer."); render(); return; }
    if (claimOf(cur, S.meId)) return; // the second tap of a double tap
    var patch = { claims: {} }; patch.claims[S.meId] = { at: nowIso(), by: S.uid || null, confirms: {} };
    upd("challenges/" + c.id, patch)
      .then(function () { toast(cur.need === 1 ? "Top! Nu moet nog iemand anders op ‘Ik zag het’ tikken." : "Top! Nu moeten nog " + cur.need + " anderen op ‘Ik zag het’ tikken."); })
      .catch(function (e) { writeError(e, "Meedoen", function () { claimChallenge(c); }); });
  }
  function putClaimBack(c, mid, keep, msg) {
    var back = { claims: {} }; back.claims[mid] = keep;
    upd("challenges/" + c.id, back).then(function () { toast(msg); }).catch(function (e) { writeError(e, "Terugzetten"); });
  }
  function withdrawClaim(c) {
    var mine = liveClaim(c, S.meId), me = S.meId;
    if (!mine) { render(); return; }
    if (mine.approved) { toast("Je hebt de punten al gekregen. Intrekken kan niet meer."); render(); return; }
    var patch = { claims: {} }; patch.claims[me] = null;
    upd("challenges/" + c.id, patch).then(function () {
      toast("Ingetrokken: je staat niet meer bij deze uitdaging.", function () { putClaimBack(c, me, mine.raw, "Teruggezet, met de bevestigingen die je had."); });
    }).catch(function (e) { writeError(e, "Intrekken"); });
  }
  function confirmClaim(c, mid) {
    if (!requireMe() || mid === S.meId) return;
    var cl = liveClaim(c, mid), me = S.meId;
    if (!cl) { toast(nameOf(mid) + " heeft het net ingetrokken."); render(); return; }
    if (cl.confirms.indexOf(me) >= 0) return;
    if (fromThisDevice(cl)) { toast("Dit is op deze telefoon gedaan of al bevestigd. Iemand anders moet het bevestigen."); return; }
    // The time stays in confirms (as before); confirmBy says which login confirmed.
    var patch = { claims: {} }; patch.claims[mid] = { confirms: {}, confirmBy: {} };
    patch.claims[mid].confirms[me] = nowIso(); patch.claims[mid].confirmBy[me] = S.uid || null;
    if (cl.doubts.indexOf(me) >= 0) { patch.claims[mid].doubts = {}; patch.claims[mid].doubts[me] = null; }
    upd("challenges/" + c.id, patch)
      .then(function () { toast("Bevestigd: je zag " + nameOf(mid) + " het doen.", function () { unconfirmClaim(c, mid, me); }); })
      .catch(function (e) { writeError(e, "Bevestigen", function () { confirmClaim(c, mid); }); });
  }
  // Takes back your own "Ik zag het" (from the toast, or later with Intrekken).
  function unconfirmClaim(c, mid, me) {
    me = me || S.meId;
    if (!liveClaim(c, mid)) { render(); return; }
    var patch = { claims: {} }; patch.claims[mid] = { confirms: {}, confirmBy: {} };
    patch.claims[mid].confirms[me] = null; patch.claims[mid].confirmBy[me] = null;
    upd("challenges/" + c.id, patch).then(function () { toast("Je bevestiging voor " + nameOf(mid) + " is ingetrokken."); }).catch(function (e) { writeError(e, "Intrekken"); });
  }
  // "Niet gezien": you do not vouch for it, and it no longer waits for you in the Spel badge.
  function doubtClaim(c, mid) {
    if (!requireMe() || !liveClaim(c, mid)) { render(); return; }
    var me = S.meId, patch = { claims: {} }; patch.claims[mid] = { doubts: {} }; patch.claims[mid].doubts[me] = nowIso();
    upd("challenges/" + c.id, patch).then(function () {
      toast("Oké, niet gezien. Je hoeft deze niet meer te bevestigen.", function () {
        var back = { claims: {} }; back.claims[mid] = { doubts: {} }; back.claims[mid].doubts[me] = null;
        upd("challenges/" + c.id, back).catch(function (e) { writeError(e, "Terugzetten"); });
      });
    }).catch(function (e) { writeError(e, "Opslaan", function () { doubtClaim(c, mid); }); });
  }
  function rejectClaim(c, cl) {
    var now = liveClaim(c, cl.memberId), mid = cl.memberId;
    if (!now) { render(); return; }
    var patch = { claims: {} }; patch.claims[mid] = null;
    upd("challenges/" + c.id, patch).then(function () {
      toast("Afgewezen: " + nameOf(mid) + " staat niet meer bij deze uitdaging.", function () { putClaimBack(c, mid, now.raw, "Teruggezet."); });
    }).catch(function (e) { writeError(e, "Afwijzen"); });
  }
  function closeChallenge(c) {
    var path = "challenges/" + c.id;
    upd(path, { closed: true }).then(function () {
      toast("Uitdaging gestopt. Niemand kan nog meedoen.", function () {
        upd(path, { closed: false }).then(function () { toast("De uitdaging loopt weer."); }).catch(function (e) { writeError(e, "Terugzetten"); });
      });
    }).catch(function (e) { writeError(e, "Stoppen"); });
  }
  // Stakes are checked against the newest copy: one tapped on a screen that had not seen the first
  // vote yet is refused here (and if it gets through anyway, normalizeBet does not count it).
  function placeStake(b, side) {
    if (!requireMe()) return;
    var cur = findById(S.bets, b.id);
    if (!cur || !betOpen(cur)) { errToast("Te laat: de inzet is al gesloten."); render(); return; }
    var amount = S.stakeSel[b.id] || 10, patch = { stakes: {} };
    patch.stakes[S.meId] = { side: side, amount: amount, at: nowIso() };
    upd("bets/" + b.id, patch).catch(function (e) { writeError(e, "Inzetten", function () { placeStake(b, side); }); });
  }
  function withdrawStake(b) {
    var cur = findById(S.bets, b.id);
    if (!cur || !betOpen(cur)) { errToast("De inzet is al gesloten. Intrekken kan niet meer."); render(); return; }
    var patch = { stakes: {} }; patch.stakes[S.meId] = null;
    upd("bets/" + b.id, patch).catch(function (e) { writeError(e, "Inzet intrekken"); });
  }
  function voteOutcome(b, side) {
    if (!requireMe()) return;
    var cur = findById(S.bets, b.id);
    if (!cur || cur.result) { toast(cur && cur.result === "void" ? "Deze voorspelling is geschrapt." : "De uitslag staat al vast."); render(); return; }
    if (cur.voteOf[S.meId] === side) return;
    var closes = betOpen(cur), patch = { votes: {} };
    delete S.voteOpen[b.id];
    patch.votes[S.meId] = { side: side, at: nowIso(), by: S.uid || null };
    upd("bets/" + b.id, patch)
      .then(function () { toast("Gestemd: " + (side === "ja" ? "het gebeurde" : "het gebeurde niet") + "." + (closes ? " Inzetten kan nu niet meer." : ""), function () { withdrawVote(b, true); }); })
      .catch(function (e) { writeError(e, "Stemmen", function () { voteOutcome(b, side); }); });
  }
  // Without votes left the bet is open for stakes again (until closing time).
  function withdrawVote(b, quietCheck) {
    var cur = findById(S.bets, b.id), me = S.meId;
    if (!cur || cur.result === "void" || (!quietCheck && cur.result)) { render(); return; }
    var patch = { votes: {} }; patch.votes[me] = null;
    upd("bets/" + b.id, patch).then(function () {
      var now = findById(S.bets, b.id);
      toast("Je stem is ingetrokken." + (now && betOpen(now) ? " Inzetten kan weer." : ""));
    }).catch(function (e) { writeError(e, "Stem intrekken"); });
  }
  function voidBet(b) {
    var cur = findById(S.bets, b.id), path = "bets/" + b.id;
    if (!cur || cur.result) { toast("De uitslag staat al vast. Schrappen kan niet meer."); render(); return; }
    upd(path, { void: true, voidBy: S.meId, voidAt: nowIso() }).then(function () {
      toast("Voorspelling geschrapt. Niemand wint of verliest punten.", function () {
        upd(path, { void: false, voidBy: null, voidAt: null }).then(function () { toast("De voorspelling loopt weer."); }).catch(function (e) { writeError(e, "Terugzetten"); });
      });
    }).catch(function (e) { writeError(e, "Schrappen"); });
  }
  // A wrong result: the votes go, betting stays closed (from the moment it closed), everyone votes again.
  function resetBet(b) {
    var cur = findById(S.bets, b.id), path = "bets/" + b.id;
    if (!cur || !cur.result || cur.result === "void") { render(); return; }
    var rv = obj(cur.raw.votes), patch = { votes: {}, closedAt: cur.cut || nowIso() }, back = { votes: {}, closedAt: cur.closedAt || null };
    cur.voters.forEach(function (m) { patch.votes[m] = null; back.votes[m] = rv[m]; });
    upd(path, patch).then(function () {
      toast("Uitslag teruggedraaid. Iedereen kan opnieuw stemmen, de inzetten blijven staan.", function () {
        upd(path, back).then(function () { toast("Uitslag teruggezet."); }).catch(function (e) { writeError(e, "Terugzetten"); });
      });
    }).catch(function (e) { writeError(e, "Terugdraaien"); });
  }
  function toggleGoing(ev) {
    if (!requireMe()) return;
    var patch = { going: {} }; patch.going[S.meId] = !ev.going[S.meId];
    upd("events/" + ev.id, patch).catch(function (e) { writeError(e, "Aanmelden"); });
  }

  // ---------- wiring ----------
  buildCounters(); buildPointsForm();
  (function buildOdds() {
    var box = $("bet-odds");
    ODDS.forEach(function (o, i) {
      var inp = el("input", { type: "radio", name: "bet-odds", value: o.key });
      if (i === 1) inp.checked = true;
      box.appendChild(el("label", null, [inp, el("span", { text: o.label + " · Ja ×" + fmtOdds(o.ja) + " · Nee ×" + fmtOdds(o.nee) })]));
    });
  })();
  $("btn-clear").addEventListener("click", function () {
    var job = { counts: cleanCounts(S.counts), caption: str(S.caption, 140), photo: S.photo, forId: S.forId, night: S.draftNight, pending: S.pending };
    resetCompose(); render();
    toast("Teller gewist.", function () { putBack(job); toast("Teller teruggezet."); });
  });
  $("btn-reg").addEventListener("click", register);
  $("btn-back").addEventListener("click", closeProfile);
  document.querySelectorAll(".tabs button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = btn.getAttribute("data-tab");
      // Away from Groep: a points change that was not saved is dropped, and that is said.
      if (S.tab === "groep" && next !== "groep" && pointsChanged().length) toast("Je wijziging in de puntentelling is niet opgeslagen.");
      if (next !== "groep") resetPoints();
      S.tab = next; safeSet(KEYS.tab, S.tab); S.profileId = null; S.editing = null; disarm();
      if (S.tab === "feed") S.feedLimit = FEED_PAGE;
      window.scrollTo(0, 0); render();
    });
  });
  $("seg-vanavond").addEventListener("click", function () { S.board = "vanavond"; render(); });
  $("seg-altijd").addEventListener("click", function () { S.board = "altijd"; render(); });
  $("seg-punten").addEventListener("click", function () { S.boardMode = "punten"; render(); });
  $("seg-drankjes").addEventListener("click", function () { S.boardMode = "drankjes"; render(); });
  $("seg-ch").addEventListener("click", function () { S.spelTab = "uitdagingen"; render(); });
  $("seg-bet").addEventListener("click", function () { S.spelTab = "voorspellingen"; render(); });
  $("feed-more").addEventListener("click", function () { S.feedLimit += FEED_PAGE; render(); });
  $("add-member").addEventListener("submit", function (ev) {
    ev.preventDefault(); var input = $("add-member-name");
    addMember(input.value, false).then(function (ok) { if (ok) input.value = ""; });
  });
  $("who-add").addEventListener("submit", function (ev) {
    ev.preventDefault(); var input = $("who-add-name");
    whoAdd(input.value).then(function (ok) { if (ok) input.value = ""; });
  });
  // Plaatsen (uitdaging, voorspelling, afspraak): one tap is one item, also on a slow or lost
  // answer. The button says Bezig… meanwhile, and trying again after a failure reuses the same id
  // (create never overwrites, so claims or bets made on it meanwhile stay). Changing the form
  // makes it a new item.
  function submitOnce(form, coll, build, done, what) {
    if (form._busy || !requireMe()) return;
    var data = build();
    if (!data) return;
    var btn = form.querySelector('button[type="submit"]'), label = btn ? btn.textContent : "";
    form._busy = true;
    if (btn) { btn.disabled = true; btn.textContent = "Bezig…"; }
    form._pid = form._pid || S.db.collection(coll).doc().id;
    var ref = S.db.doc(coll + "/" + form._pid);
    withRetry(function () { return ref.create(data); })
      .then(function () { form._pid = null; done(); }, function (e) { writeError(e, what); })
      .then(function () { form._busy = false; if (btn) { btn.disabled = false; btn.textContent = label; } });
  }
  ["ch-form", "bet-form", "event-form"].forEach(function (id) { $(id).addEventListener("input", function () { this._pid = null; }); });
  $("ch-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    submitOnce(this, "challenges", function () {
      var title = str($("ch-title").value, 80); if (!title) { toast("Beschrijf de uitdaging."); return null; }
      var ptsEl = document.querySelector('input[name="ch-pts"]:checked'), pts = clampInt(ptsEl ? ptsEl.value : 10, 1, 100, 10);
      var now = new Date();
      return { title: title, points: pts, createdBy: S.meId, by: S.uid || null, at: now.toISOString(), night: nightKey(now), need: needNow(), closed: false, claims: {} };
    }, function () { $("ch-title").value = ""; toast("Uitdaging geplaatst."); }, "Uitdaging plaatsen");
  });
  $("bet-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    submitOnce(this, "bets", function () {
      var title = str($("bet-title").value, 100); if (!title) { toast("Schrijf op wat je voorspelt."); return null; }
      var oEl = document.querySelector('input[name="bet-odds"]:checked'), o = ODDS[1];
      ODDS.forEach(function (x) { if (oEl && x.key === oEl.value) o = x; });
      var now = new Date();
      // Betting closes at the end of the night (or at the first vote). In a group of three or more,
      // one person can never settle a bet alone.
      var need = S.members.length >= 3 ? Math.max(2, needNow()) : needNow();
      return { title: title, oddsKey: o.key, odds: { ja: o.ja, nee: o.nee }, createdBy: S.meId, by: S.uid || null, at: now.toISOString(), night: nightKey(now), need: need, closedAt: nightEnd(now).toISOString(), void: false, stakes: {}, votes: {} };
    }, function () { $("bet-title").value = ""; toast("Voorspelling geplaatst. Zet zelf ook in."); }, "Voorspelling plaatsen");
  });
  $("btn-plan").addEventListener("click", function () {
    if (!requireMe()) return;
    var now = new Date();
    $("ev-date").min = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    if (!$("ev-date").value) $("ev-date").value = $("ev-date").min;
    $("event-form").hidden = false; $("btn-plan").hidden = true; $("ev-title").focus();
  });
  $("ev-cancel").addEventListener("click", function () { $("event-form").hidden = true; render(); });
  $("event-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var title = "";
    submitOnce(this, "events", function () {
      var date = $("ev-date").value, time = $("ev-time").value;
      title = str($("ev-title").value, 60);
      if (!title) { toast("Geef de afspraak een naam."); return null; }
      if (!validNight(date)) { toast("Kies een datum."); return null; }
      var going = {}; going[S.meId] = true;
      return { title: title, date: date, time: /^\d{2}:\d{2}$/.test(time) ? time : "", createdBy: S.meId, by: S.uid || null, at: nowIso(), going: going };
    }, function () { $("ev-title").value = ""; $("ev-time").value = ""; $("event-form").hidden = true; toast("Gepland: " + title + "."); render(); }, "Plannen");
  });
  // Opslaan: the first tap says what changes for everyone, the second (after 400 ms) saves.
  function savePoints(values) {
    return q("config/points", function () { return S.db.doc("config/points").set({ values: values, updatedAt: nowIso(), by: S.uid || null }); });
  }
  $("points-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!canWriteNow()) return;
    var changed = pointsChanged();
    if (!changed.length) { resetPoints(); syncPointsForm(); return; }
    if (S.confirmKey !== "points") { arm("points", 8000); return; }
    if (!confirmed("points")) return;
    // Only the drinks changed here; the rest as they are now (someone else may have changed those).
    var values = pointsNow(), prev = pointsNow(), draft = S.pointsDraft;
    changed.forEach(function (d) { values[d.key] = draft[d.key]; });
    resetPoints(); render();
    savePoints(values)
      .then(function () {
        toast("Puntentelling opgeslagen. Geldt nu voor iedereen, ook voor vorige avonden.", function () {
          savePoints(prev).then(function () { toast("Puntentelling teruggezet."); }).catch(function (e) { writeError(e, "Terugzetten"); });
        });
      })
      .catch(function (e) { S.pointsDraft = draft; S.pointsDirty = true; writeError(e, "Punten opslaan"); });
  });
  $("points-cancel").addEventListener("click", function () { resetPoints(); syncPointsForm(); });
  // A tab left open into the next evening moves the old tally to its own card.
  setInterval(function () { checkStale(); render(); }, 60000);
  // The "Geen verbinding" and "wacht op internet" lines show after a grace time.
  setInterval(function () { if (S.outbox.length || (S.sync && S.sync.since)) renderBanner(); }, 2000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && checkStale()) render(); });

  // ---------- data ----------
  window.addEventListener("turflijst-auth-ok", function () { if (S.readOnly || S.signedOut) { S.readOnly = false; S.signedOut = false; render(); flushOutbox(true); } });
  // Reception back, or the app back on screen: send what is waiting right away.
  window.addEventListener("online", function () { flushOutbox(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") flushOutbox(true); });
  window.addEventListener("turflijst-signed-out", function () { S.signedOut = true; render(); });
  // This device lost its login and got a new one: put the new login on our own name again,
  // so it does not show as "bezet" and stays ours.
  var reclaiming = {};
  function reclaimMe() {
    var me = S.meId && memberById(S.meId);
    if (!me || !me.uid || me.uid === S.uid || !isMyUid(me.uid) || !canWriteNow() || reclaiming[me.id]) return;
    reclaiming[me.id] = true;
    q("members/" + me.id, function () { return S.db.doc("members/" + me.id).update({ uid: S.uid }); })
      .catch(noop).then(function () { delete reclaiming[me.id]; });
  }
  // After every change to the names: is our own name still ours? Never drop it without saying so.
  function dropMe(msg) {
    S.meId = null; safeSet(KEYS.me, "");
    claimedId = null; safeSet(KEYS.claimed, "");
    pushPresence(); toast(msg);
  }
  function checkMe() {
    if (!S.meId) return;
    var me = memberById(S.meId);
    if (!me) {
      // Deleted (maybe by mistake: if it is put back, we are that name again by ourselves).
      if (S.loaded.members && knownMe === S.meId) { knownMe = null; toast("Je naam is uit de groep gehaald. Kies je naam opnieuw of voeg jezelf toe."); }
      return;
    }
    knownMe = me.id;
    if (takenByOther(me)) { dropMe(me.name + " is nu op een ander toestel gekozen. Ben jij " + me.name + "? Tik bij Tellen op je naam om hem terug te halen."); return; }
    if (me.pending || !S.uid || !S.loaded.members) return;
    if (isMyUid(me.uid)) {
      if (claimedId !== me.id) { claimedId = me.id; safeSet(KEYS.claimed, me.id); }
      reclaimMe();
      return;
    }
    // No login on our name. Had the server already put ours on it? Then someone unlinked it.
    if (claimedId === me.id) { dropMe(me.name + " is losgekoppeld van dit toestel. Ben jij " + me.name + "? Tik bij Tellen op je naam."); return; }
    // Otherwise our claim never arrived (no reception when we picked the name): try again.
    if (canWriteNow() && !claimBusy && Date.now() - claimTryAt > 15000) claim(me.id);
  }
  function retryClaimSoon() { claimTryAt = 0; }
  window.addEventListener("online", retryClaimSoon);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") retryClaimSoon(); });
  function pushPresence() { if (S.room) S.room.presence({ memberId: S.meId || null }).catch(noop); }
  function connect(db) {
    var timer = setTimeout(function () { S.slow = true; render(); }, 10000);
    function settle() { if (S.loaded.members && S.loaded.entries) { clearTimeout(timer); S.slow = false; } }
    function fail(e) { clearTimeout(timer); S.storeError = (e && e.code) || "unavailable"; render(); }
    function sub(name, norm, sortFn, after) {
      db.collection(name).onSnapshot(function (snap) {
        var list = snap.docs.map(norm).filter(Boolean);
        if (sortFn) list.sort(sortFn);
        S[name] = list; S.ver++;
        if (!snap.metadata.fromCache && S.loaded.hasOwnProperty(name)) S.loaded[name] = true;
        if (after) after();
        settle(); render();
      }, fail);
    }
    sub("members", normalizeMember, function (a, b) { return (a.createdAt || "").localeCompare(b.createdAt || "") || a.name.localeCompare(b.name); }, function () {
      checkMe();
      if (S.forId && !memberById(S.forId) && S.loaded.members) S.forId = memberById(S.meId) ? S.meId : null;
      if (!S.forId && S.meId && memberById(S.meId)) S.forId = S.meId;
    });
    sub("entries", normalizeEntry, null, function () { S.entriesSrv = S.entries; settleOutbox(); mergeQueued(); });
    sub("challenges", normalizeChallenge);
    sub("bets", normalizeBet);
    sub("events", normalizeEvent);
    db.doc("config/points").onSnapshot(function (snap) {
      var x = snap.exists ? snap.data() || {} : {}, before = JSON.stringify(pointsNow());
      S.points = cleanPoints(x.values);
      S.pointsMeta = isoOr(x.updatedAt) ? { by: strOrNull(x.by), updatedAt: x.updatedAt } : null;
      // Someone else changed the points while you were editing: say so instead of overwriting it later.
      if (S.pointsDirty && JSON.stringify(pointsNow()) !== before) S.pointsConflict = true;
      if (!pointsChanged().length) resetPoints();
      S.ver++; syncPointsForm(); render();
    }, noop);
    if (db.onStatus) db.onStatus(function (h) {
      var back = !!S.sync && !S.sync.live && h.live;
      S.sync = h;
      // The live connection is back, so is the network: send what is waiting.
      if (back) flushOutbox(true); else if (h.ok && !h.offline) flushOutbox(false);
      render();
    });
    mergeQueued();
    flushOutbox(true);
  }

  // ---------- start ----------
  // Messages for the screen before the app opens. Friends see the first ones; the last ones are
  // for whoever set the app up, and say so.
  var GATE_MSG = {
    network: "Geen verbinding. Check je internet of wifi, we proberen het vanzelf opnieuw. Er gaat niets verloren.",
    busy: "Er loggen nu veel mensen tegelijk in. Wacht een minuutje, dan proberen we het opnieuw.",
    load: "De app kon niet helemaal laden. Check je internet en probeer het opnieuw.",
    auth: "Inloggen lukt nu niet. Laat dit zien aan wie de app beheert: in Supabase staan anonieme logins uit (Authentication, Sign In / Providers).",
    config: "De app is nog niet gekoppeld aan een database. Vul de Supabase-gegevens in config.js in.",
    key: "De sleutel in config.js klopt niet. Kopieer de publishable key uit Supabase (Project Settings, API Keys) en controleer of de Project URL bij hetzelfde project hoort.",
    secretkey: "In config.js staat de geheime sleutel (secret of service_role). Die hoort nooit op de site. Zet er de publishable key in (begint met sb_publishable_) en maak in Supabase meteen een nieuwe secret key aan: de oude is uitgelekt."
  };
  var OWNER_ONLY = ["config", "key", "secretkey"];
  var JOIN_MSG = {
    wrong: "Deze code kennen we niet. Check of je hem goed hebt overgetypt, of vraag iemand uit de groep om de uitnodigingslink.",
    network: "Geen verbinding. Check je internet en tik nog een keer op Meedoen.",
    toomany: "Te vaak een verkeerde code geprobeerd. Wacht 10 minuten.",
    badlink: "Deze uitnodigingslink werkt niet (meer). Vraag in de groepsapp om een nieuwe link of de groepscode.",
    badstored: "De groepscode die we hadden bewaard werkt niet meer. Vraag in de groepsapp om de nieuwe code of link.",
    empty: "Vul de groepscode in, of plak de hele uitnodigingslink."
  };
  var AUTO_RETRY = { network: 20000, load: 20000, busy: 60000 };
  var gateKind = null, booted = false, startGen = 0, slowT = null, lastTry = 0, joinTry = 0;
  function standalone() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }
  function gateErr(text) { var e = $("gate-error"); e.textContent = text || ""; e.hidden = !text; }
  function showGate(kind, info) {
    gateKind = kind;
    document.body.classList.toggle("gated", kind !== null);
    $("gate").hidden = kind === null;
    if (kind === null) return;
    info = info || {};
    $("gate-loading").hidden = kind !== "loading";
    $("gate-slow").hidden = true;
    $("gate-code").hidden = kind !== "code";
    $("gate-msg").hidden = kind === "loading" || kind === "code";
    if (kind === "code") {
      // In the home-screen app the invite link opens Safari, not this app: ask to paste it here.
      $("gate-hint").textContent = standalone()
        ? "Je opent Turflijst vanaf je beginscherm. Plak hier de uitnodigingslink uit de groepsapp, of typ de groepscode."
        : "Typ de groepscode die je van je vrienden kreeg, of plak de uitnodigingslink. Hoofdletters maken niet uit.";
      if (info.badCode) $("gate-input").value = info.badCode;
      gateErr(info.tooMany ? (typeof info.tooMany === "string" ? info.tooMany : JOIN_MSG.toomany) : info.badCode ? JOIN_MSG[info.fromLink ? "badlink" : "badstored"] : "");
      setTimeout(function () { $("gate-input").focus(); }, 0);
      return;
    }
    if (kind === "loading") return;
    var text = GATE_MSG[kind] || GATE_MSG.network;
    if (kind === "network" && navigator.onLine !== false) text += " Werkt je internet wel en blijft dit zo? Laat het de beheerder van de app weten.";
    $("gate-msg-text").textContent = text;
    $("gate-retry").hidden = OWNER_ONLY.indexOf(kind) >= 0;
  }
  // One start attempt. Safe to repeat: no page reload (that would fail offline and, in the
  // home-screen app, leave you on a browser error page), and only the newest attempt counts.
  function attempt() {
    if (booted) return;
    var gen = ++startGen;
    lastTry = Date.now();
    showGate("loading");
    clearTimeout(slowT);
    slowT = setTimeout(function () { if (gen === startGen && gateKind === "loading") $("gate-slow").hidden = false; }, 12000);
    var p;
    try { p = Promise.resolve(BK.start()); } catch (e) { p = Promise.reject(e); }
    p.then(null, function (e) { return { error: "network", detail: e && e.message }; }).then(function (res) {
      if (booted || gen !== startGen || !res || res.stale) return;
      clearTimeout(slowT);
      if (res.ok) boot();
      else if (res.needCode) showGate("code", res);
      else showGate(GATE_MSG[res.error] ? res.error : "network");
    });
  }
  function retryNow() {
    if (navigator.onLine === false) { toast("Nog geen bereik. Zodra je internet hebt, proberen we het vanzelf opnieuw."); return; }
    if (!BK) { location.reload(); return; }
    attempt();
  }
  function autoRetry(force) {
    if (booted || !BK || !AUTO_RETRY[gateKind] || document.visibilityState === "hidden" || navigator.onLine === false) return;
    if (force || Date.now() - lastTry >= AUTO_RETRY[gateKind]) attempt();
  }
  window.addEventListener("online", function () { autoRetry(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") autoRetry(gateKind !== "busy"); });
  setInterval(function () { autoRetry(false); }, 5000);
  $("gate-retry").addEventListener("click", retryNow);
  $("gate-slow-retry").addEventListener("click", retryNow);

  function joinDone(res) {
    var b = $("gate-submit");
    b.disabled = false; b.textContent = "Meedoen";
    if (res === "ok") { boot(); return; }
    gateErr((res === "toomany" && BK.joinMessage && BK.joinMessage()) || JOIN_MSG[res] || JOIN_MSG.network);
  }
  $("gate-code").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var b = $("gate-submit");
    if (b.disabled || booted) return;
    var code = BK.parseCode($("gate-input").value);
    if (!code) { gateErr(JOIN_MSG.empty); $("gate-input").focus(); return; }
    gateErr("");
    if (navigator.onLine === false) { joinDone("network"); return; }
    var t = ++joinTry;
    b.disabled = true; b.textContent = "Bezig…";
    // Bad reception: give up waiting after 15 s and say so. The code stays in the field, so
    // trying again is one tap. A late success still opens the app.
    var timer = setTimeout(function () { if (t === joinTry) { joinTry++; joinDone("network"); } }, 15000);
    BK.join(code).then(null, function () { return "network"; }).then(function (res) {
      if (booted) return;
      if (t !== joinTry) { if (res === "ok") boot(); return; }
      clearTimeout(timer); joinTry++;
      joinDone(res);
    });
  });
  $("gate-input").addEventListener("input", function () { gateErr(""); });
  $("invite-copy").addEventListener("click", function () {
    var inp = $("invite-link"), link = inp.value;
    var done = function () { toast("Link gekopieerd. Stuur hem naar de groep."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { inp.select(); toast("Selecteer en kopieer de link hierboven."); });
    else { inp.select(); toast("Selecteer en kopieer de link hierboven."); }
  });
  $("invite-share").addEventListener("click", function () {
    if (!navigator.share) return;
    navigator.share({ title: "Turflijst", text: "Doe mee met onze Turflijst", url: $("invite-link").value }).catch(noop);
  });

  var lastW = window.innerWidth, resizeT = null;
  window.addEventListener("resize", function () {
    if (Math.abs(window.innerWidth - lastW) < 2) return;
    lastW = window.innerWidth; clearTimeout(resizeT); resizeT = setTimeout(render, 150);
  });

  // Offline the app (also from the home screen) still opens and says "Geen verbinding", instead of
  // the browser's error page. sw.js always asks the network first, so a new version is never held back.
  function registerSw() {
    try { if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(noop); } catch (e) {}
  }
  if (document.readyState === "complete") registerSw(); else window.addEventListener("load", registerSw);

  function start() {
    // Reloaded while a photo or profile was open: that history entry is no longer ours to close.
    try {
      if (hasEntry()) { var hs = {}; Object.keys(history.state).forEach(function (k) { if (k !== HKEY) hs[k] = history.state[k]; }); history.replaceState(hs, ""); }
    } catch (e) {}
    var t = safeGet(KEYS.tab);
    if (["feed", "spel", "tellen", "ranglijst", "groep"].indexOf(t) >= 0) S.tab = t;
    S.feedSeen = safeGet(KEYS.seen) || "";
    S.meId = safeGet(KEYS.me) || null; S.forId = S.meId;
    claimedId = S.meId && safeGet(KEYS.claimed) === S.meId ? S.meId : null;
    loadDraft();
    loadOutbox();
    syncPointsForm();
    render();
    if (!BK) { showGate("load"); return; }
    attempt();
  }
  function boot() {
    if (booted) return;
    booted = true; clearTimeout(slowT);
    S.pastUids = BK.pastUids ? BK.pastUids() : [];
    showGate(null);
    Promise.all([BK.use("db"), BK.use("user"), BK.use("assets"), BK.use("room")]).then(function (res) {
      var db = res[0], user = res[1], room = res[3];
      if (!db || !user) { S.noStore = true; render(); return; }
      S.db = db; S.user = user; S.assets = res[2] || null;
      return user.id().then(function (uid) {
        S.uid = uid || null; S.canWrite = true;
        connect(db); render();
        if (room) {
          S.room = room;
          room.onPeers(function (ch) {
            var on = {};
            ch.peers.forEach(function (p) { var m = p.presence && p.presence.memberId; if (typeof m === "string") on[m] = true; });
            S.online = on; render();
          });
          pushPresence();
        }
      });
    }).catch(function () { S.noStore = true; render(); });
  }
  start();
})();
