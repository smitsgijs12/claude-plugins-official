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
  var KEYS = { draft: "turflijst-draft", me: "turflijst-me", seen: "turflijst-feed-seen", tab: "turflijst-tab" };
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
    canWrite: null, readOnly: false, noStore: false,
    members: [], entries: [], challenges: [], bets: [], events: [], points: {},
    loaded: { members: false, entries: false }, slow: false, storeError: "", ver: 0,
    meId: null, forId: null, counts: zero(), caption: "", photo: null,
    tab: "tellen", board: "vanavond", boardMode: "punten", spelTab: "uitdagingen",
    profileId: null, prevTab: "tellen", feedLimit: FEED_PAGE, feedSeen: "",
    busy: false, busyText: "", editing: null, editValue: "", focusEdit: false, confirmKey: null,
    openComments: {}, commentDrafts: {}, focusComment: null, stakeSel: {}, online: {},
    pointsDirty: false, dirty: false, compareId: null, tables: { trend: false, nights: false }
  };
  var localIds = {};

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
  function nightKey(date) {
    var d = new Date(date.getTime() - NIGHT_CUTOFF_HOUR * 3600 * 1000);
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
  function clampInt(v, lo, hi, dflt) { var n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }
  function clampNum(v, lo, hi, dflt) { var n = Number(v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }
  function str(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : ""; }
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
  function takenByOther(m) { return !!(m && m.uid && S.uid && m.uid !== S.uid); }
  function canWriteNow() { return !!S.db && !S.readOnly && S.canWrite !== false; }
  function canSocial() { return canWriteNow() && !!S.meId && !!memberById(S.meId); }
  function nowIso() { return new Date().toISOString(); }
  function needNow() { return S.members.length >= 4 ? 2 : 1; }
  function pv(k) { var v = S.points[k]; return typeof v === "number" && isFinite(v) ? v : DEFAULT_POINTS[k]; }
  function ptsOf(counts) { var s = 0; DRINKS.forEach(function (d) { s += (counts[d.key] || 0) * pv(d.key); }); return s; }
  function fmtDelta(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
  function fmtPts(n) { return fmtDelta(n) + " pnt"; }
  function fmtOdds(x) { return String(Math.round(x * 100) / 100).replace(".", ","); }
  function hue(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 360; }
  function initials(name) {
    var p = String(name || "?").trim().split(/\s+/);
    var a = (p[0] || "?").charAt(0), b = p.length > 1 ? p[p.length - 1].charAt(0) : (p[0] || "").charAt(1);
    return (a + (b || "")).toUpperCase();
  }
  function avatar(id, size) {
    var a = el("span", { class: "av" + (size ? " av-" + size : ""), "aria-hidden": "true", text: initials(nameOf(id)) });
    var h = hue(id || "x");
    a.style.background = "hsl(" + h + ", 42%, 30%)";
    a.style.color = "hsl(" + h + ", 85%, 88%)";
    if (S.online[id]) a.classList.add("on");
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
  var toastTimer = null, toastUndo = null;
  function toast(text, undo) {
    $("toast-text").textContent = text;
    toastUndo = undo || null;
    $("toast-undo").hidden = !undo;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $("toast").hidden = true; toastUndo = null; }, undo ? 7000 : 3500);
  }
  $("toast-undo").addEventListener("click", function () { var fn = toastUndo; $("toast").hidden = true; toastUndo = null; if (fn) fn(); });

  function writeError(e, what) {
    var code = e && e.code;
    if (code === "not_found") { toast("Dit bestaat niet meer."); render(); return; }
    if (code === "invalid_argument" || code === "not_granted") {
      S.readOnly = true;
      toast("Opslaan is geweigerd. Open de uitnodigingslink opnieuw om weer mee te doen.");
    } else if (code === "quota_exceeded") {
      toast("De opslag is vol. Verwijder oude registraties of vraag om een opschoning.");
    } else {
      toast("Niet gelukt om te " + what + ". Controleer je verbinding en probeer het opnieuw.");
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
  function confirmBtn(key, label, fn) {
    if (S.confirmKey === key) return el("button", { type: "button", class: "link-btn warn", text: "Zeker weten?", on: { click: function () { S.confirmKey = null; fn(); } } });
    return el("button", { type: "button", class: "link-btn", text: label, on: { click: function () { S.confirmKey = key; render(); } } });
  }

  // ---------- photos ----------
  var IMG = {};
  function photoNode(id, ctx) {
    var key = ctx + ":" + id, img = IMG[key];
    if (!img) {
      img = new Image(); img.alt = "Foto"; img.decoding = "async"; img.loading = "lazy";
      img.className = ctx === "grid" ? "" : "post-img";
      img.addEventListener("error", function () { img.setAttribute("data-broken", "1"); render(); });
      img.src = BK.photoUrl(id); IMG[key] = img;
    }
    if (img.getAttribute("data-broken")) return el("span", { class: "photo-missing", text: "Foto niet beschikbaar" });
    return img;
  }
  function openLightbox(id) { $("lightbox-img").src = BK.photoUrl(id); $("lightbox").hidden = false; $("lightbox-close").focus(); }
  function closeLightbox() { $("lightbox").hidden = true; $("lightbox-img").removeAttribute("src"); }
  $("lightbox").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("lightbox").hidden) closeLightbox(); });

  function compress(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var max = 1600, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
          var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) { URL.revokeObjectURL(url); resolve(b || file); }, "image/jpeg", 0.82);
        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function setPhoto(blob) {
    if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
    S.photo = blob ? { blob: blob, url: URL.createObjectURL(blob) } : null;
    render();
  }
  $("photo-input").addEventListener("change", function () {
    var f = this.files && this.files[0]; this.value = "";
    if (!f) return;
    compress(f).then(function (b) {
      if (!b) { toast("Deze foto kan niet geopend worden. Kies een JPG of PNG."); return; }
      if (["image/jpeg", "image/png", "image/webp", "image/gif"].indexOf(b.type) < 0) { toast("Dit fotoformaat werkt niet. Kies een JPG of PNG."); return; }
      if (b.size > 9.5 * 1024 * 1024) { toast("Deze foto is te groot."); return; }
      setPhoto(b);
    });
  });
  $("photo-remove").addEventListener("click", function () { setPhoto(null); });
  $("caption").addEventListener("input", function () { S.caption = this.value; renderHeader(); });

  // ---------- normalizers ----------
  function normalizeMember(d) {
    var x = d.data() || {}, name = str(x.name, 24);
    return name ? { id: d.id, name: name, createdAt: isoOr(x.createdAt) || "", uid: strOrNull(x.uid) } : null;
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
      likes: likes, comments: comments, local: !!localIds[d.id]
    };
  }
  function normalizeChallenge(d) {
    var x = d.data() || {}, title = str(x.title, 80), at = isoOr(x.at);
    if (!title || !at) return null;
    var c = { id: d.id, title: title, points: clampInt(x.points, 1, 100, 10), createdBy: strOrNull(x.createdBy) || "", by: strOrNull(x.by), at: at,
      night: validNight(x.night) || nightKey(new Date(at)), need: clampInt(x.need, 1, 3, 2), closed: x.closed === true, claims: [] };
    var raw = obj(x.claims);
    Object.keys(raw).forEach(function (mid) {
      var cl = raw[mid];
      if (!cl || typeof cl !== "object" || !isoOr(cl.at)) return;
      var cf = obj(cl.confirms), who = [], times = [];
      Object.keys(cf).forEach(function (k) {
        if (k === mid) return;
        var v = cf[k];
        if (v === true || isoOr(v)) { who.push(k); times.push(isoOr(v) || cl.at); }
      });
      times.sort();
      var ok = who.length >= c.need;
      c.claims.push({ memberId: mid, at: cl.at, confirms: who, approved: ok, approvedAt: ok ? (times[c.need - 1] || cl.at) : null });
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
      need: clampInt(x.need, 1, 3, 2), closedAt: isoOr(x.closedAt), void: x.void === true, stakes: [], votes: { ja: [], nee: [] }, voteOf: {} };
    var rs = obj(x.stakes);
    Object.keys(rs).forEach(function (mid) {
      var s = rs[mid];
      if (!s || typeof s !== "object" || (s.side !== "ja" && s.side !== "nee")) return;
      var amt = clampInt(s.amount, 0, 100, 0);
      if (amt > 0) b.stakes.push({ memberId: mid, side: s.side, amount: amt, at: isoOr(s.at) || at });
    });
    var rv = obj(x.votes), lastVote = null;
    Object.keys(rv).forEach(function (mid) {
      var v = rv[mid];
      if (!v || typeof v !== "object" || (v.side !== "ja" && v.side !== "nee")) return;
      b.votes[v.side].push(mid); b.voteOf[mid] = v.side;
      var va = isoOr(v.at); if (va && (!lastVote || va > lastVote)) lastVote = va;
    });
    var vj = b.votes.ja.length, vn = b.votes.nee.length;
    b.result = b.void ? "void" : (vj >= b.need && vj > vn) ? "ja" : (vn >= b.need && vn > vj) ? "nee" : null;
    b.resultAt = lastVote || at;
    b.open = !b.void && !b.result && !b.closedAt && vj + vn === 0;
    return b;
  }
  function normalizeEvent(d) {
    var x = d.data() || {}, title = str(x.title, 60);
    if (!title || !validNight(x.date)) return null;
    var going = {}, rg = obj(x.going);
    Object.keys(rg).forEach(function (k) { if (rg[k] === true) going[k] = true; });
    return { id: d.id, title: title, date: x.date, time: typeof x.time === "string" && /^\d{2}:\d{2}$/.test(x.time) ? x.time : "",
      createdBy: strOrNull(x.createdBy) || "", by: strOrNull(x.by), going: going };
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
        L.push({ m: st.memberId, night: b.night, pts: win ? Math.round(st.amount * (b.odds[st.side] - 1)) : -st.amount, kind: "bet", win: win });
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
  function pendingCounts() {
    var ch = 0, bet = 0;
    if (!canSocial()) return { ch: 0, bet: 0 };
    S.challenges.forEach(function (c) {
      c.claims.forEach(function (cl) { if (!cl.approved && cl.memberId !== S.meId && cl.confirms.indexOf(S.meId) < 0 && memberById(cl.memberId)) ch++; });
    });
    S.bets.forEach(function (b) { if (!b.result && !b.open && !b.voteOf[S.meId]) bet++; });
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
    renderHeader(); renderBanner(); renderTabs();
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
    $("night-label").textContent = S.profileId ? "Profiel" : "Avond van " + nightLabel(nightKey(new Date()));
    $("btn-clear").disabled = !anyCount(S.counts) && !S.photo && !S.caption;
    var hasContent = anyCount(S.counts) || !!S.photo;
    $("btn-reg").disabled = !hasContent || !S.forId || !memberById(S.forId) || !canWriteNow() || S.busy;
    $("btn-reg").textContent = S.busy ? (S.busyText || "Bezig…") : "Registreren →";
  }

  function renderBanner() {
    var b = $("banner"), msg = null;
    if (S.noStore) msg = ["Geen verbinding met de database. ", "Controleer je internet en herlaad de pagina."];
    else if (S.storeError) msg = ["Verbinding met de opslag is verbroken. ", "Herlaad de pagina."];
    else if (S.readOnly || S.canWrite === false) msg = ["Opslaan lukt niet. ", "Open de uitnodigingslink opnieuw om weer mee te doen."];
    else if (S.slow && !(S.loaded.members && S.loaded.entries)) msg = ["Nog geen verbinding met de opslag. ", "Wat je ziet kan verouderd zijn."];
    else if (!S.loaded.members && S.db) msg = ["Verbinden… ", ""];
    b.hidden = !msg; clear(b);
    if (msg) { b.appendChild(el("b", { text: msg[0] })); b.appendChild(document.createTextNode(msg[1])); }
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
    S.counts[key] = Math.max(0, Math.min(MAX_PER_COUNTER, (S.counts[key] || 0) + delta));
    safeSet(KEYS.draft, JSON.stringify(S.counts)); renderCounters(); renderCompose(); renderHeader();
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
    if (anyCount(S.counts)) { line.appendChild(document.createTextNode(breakdown(S.counts, true) + " · ")); line.appendChild(el("b", { text: fmtPts(ptsOf(S.counts)) })); }
    else line.textContent = S.photo ? "Alleen een foto, zonder drankjes." : (S.assets ? "Tel je drankjes, voeg eventueel een foto toe en tik op Registreren." : "Tel je drankjes en tik op Registreren.");
  }
  function memberChip(m, pressed, onClick, disabled) {
    var kids = [m.name];
    if (m.id === S.meId) kids.push(el("span", { class: "me", text: "(jij)" }));
    if (disabled) kids.push(el("span", { class: "me", text: "(bezet)" }));
    return el("button", { type: "button", class: "chip", "aria-pressed": pressed ? "true" : "false", disabled: !!disabled, on: { click: onClick } }, kids);
  }
  function renderTellen() {
    renderCounters(); renderCompose();
    var nk = nightKey(new Date());
    var needWho = !S.meId || !memberById(S.meId), showWho = needWho && !!S.db && S.loaded.members;
    $("who-card").hidden = !showWho;
    if (showWho) {
      var wc = $("who-chips"); clear(wc);
      $("who-text").textContent = S.members.length
        ? "Kies je naam, dan registreer en reageer je als jezelf. Sta je er niet tussen? Voeg jezelf toe."
        : "Er staan nog geen namen in de groep. Voeg jezelf als eerste toe.";
      S.members.forEach(function (m) { wc.appendChild(memberChip(m, false, function () { setMe(m.id); }, takenByOther(m))); });
      wc.hidden = !S.members.length;
      $("who-add").hidden = S.members.length >= MAX_MEMBERS || !canWriteNow();
    }
    var fc = $("for-chips"); clear(fc);
    S.members.slice().sort(function (a, b) { return (b.id === S.meId) - (a.id === S.meId); })
      .forEach(function (m) { fc.appendChild(memberChip(m, m.id === S.forId, function () { S.forId = m.id; render(); })); });
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
      var what = breakdown(e.counts, true) || (e.photo ? "foto" : "");
      log.appendChild(el("div", { class: "log-row" }, [
        el("time", { text: timeOf(e.at) }),
        el("div", { class: "what" }, [nameBtn(e.memberId, "inline"), " ", el("span", { text: what })]),
        canDeleteEntry(e) ? el("button", { type: "button", class: "link-btn", text: "Verwijder", on: { click: function () { removeEntry(e); } } }) : el("span")
      ]));
    });
  }
  function canDeleteEntry(e) { return canWriteNow() && ((S.uid && e.by === S.uid) || (!S.uid && e.local)); }

  // ----- Feed -----
  function renderFeed() {
    var os = $("online-strip"); clear(os);
    var ids = Object.keys(S.online).filter(function (id) { return memberById(id); });
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
    d.feed.slice(0, S.feedLimit).forEach(function (it) { list.appendChild(feedItem(it)); });
    $("feed-more").hidden = d.feed.length <= S.feedLimit;
    if (d.feed.length && (!S.feedSeen || d.feed[0].at > S.feedSeen)) { S.feedSeen = d.feed[0].at; safeSet(KEYS.seen, S.feedSeen); renderTabs(); }
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
      action = { label: it.b.open ? "Inzetten · Ja ×" + fmtOdds(it.b.odds.ja) + " · Nee ×" + fmtOdds(it.b.odds.nee) : "Bekijk", fn: function () { goSpel("voorspellingen"); } };
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
      el("div", { class: "post-who" }, [nameBtn(e.memberId), el("span", { class: "post-time", text: timeText })]),
      anyCount(e.counts) ? el("span", { class: "post-pts" + (pts < 0 ? " neg" : ""), text: fmtPts(pts) }) : null
    ]));
    if (e.photo) {
      var ph = el("button", { type: "button", class: "post-photo", "aria-label": "Foto van " + nameOf(e.memberId) + " groot bekijken", on: { click: function () { openLightbox(e.photo); } } });
      ph.appendChild(photoNode(e.photo, "feed"));
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
        if (!S.openComments[e.id]) { S.openComments[e.id] = true; }
        S.focusComment = e.id; render();
      } } }, [el("span", { html: ICON.chat }), el("span", { text: e.comments.length ? String(e.comments.length) : "Reageer" })])
    ]);
    if (canDeleteEntry(e)) acts.appendChild(el("span", { class: "push" }, [confirmBtn("entry:" + e.id, "Verwijder", function () { removeEntry(e); })]));
    card.appendChild(acts);
    if (likers.length) card.appendChild(el("p", { class: "post-likes", text: "Proost van " + listNames(likers) }));

    var open = !!S.openComments[e.id], shown = open ? e.comments : e.comments.slice(-2);
    if (e.comments.length > 2 && !open) card.appendChild(el("button", { type: "button", class: "link-btn more", text: "Alle " + e.comments.length + " reacties", on: { click: function () { S.openComments[e.id] = true; render(); } } }));
    if (shown.length) {
      var cl = el("div", { class: "comments" });
      shown.forEach(function (c) {
        var mine = canWriteNow() && ((S.uid && c.by === S.uid) || (!S.uid && c.memberId === S.meId));
        cl.appendChild(el("div", { class: "cmt" }, [
          el("span", { class: "cmt-text" }, [nameBtn(c.memberId, "inline"), c.text]),
          el("time", { text: ago(c.at).replace(" geleden", "") }),
          mine ? el("button", { type: "button", class: "link-btn", "aria-label": "Reactie verwijderen", text: "×", on: { click: function () { removeComment(e.id, c.id); } } }) : null
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
      if (S.focusComment === e.id) { S.focusComment = null; setTimeout(function () { inp.focus(); }, 0); }
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
    if (ev.time) {
      var mins = Math.round((eventStart(ev) - now) / 60000);
      if (mins >= 60) return { n: String(Math.floor(mins / 60)), u: "uur" };
      if (mins > 0) return { n: String(mins), u: "min" };
    }
    return { n: "Nu", u: "vandaag" };
  }
  function renderEvents() {
    var box = $("events"); clear(box);
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var up = S.events.filter(function (ev) { return parseDay(ev.date) >= today; })
      .sort(function (a, b) { return eventStart(a) - eventStart(b); }).slice(0, 4);
    if (!up.length) { box.appendChild(el("p", { class: "hint", text: canSocial() ? "Nog niks gepland. Plan het volgende feest met + Plan iets." : "Nog niks gepland." })); return; }
    up.forEach(function (ev) {
      var cd = countdown(ev), going = Object.keys(ev.going).filter(function (k) { return memberById(k); });
      var am = !!(S.meId && ev.going[S.meId]);
      var when = parseDay(ev.date).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }) + (ev.time ? " · " + ev.time : "");
      var acts = el("div", { class: "ev-acts" });
      if (canSocial()) acts.appendChild(el("button", { type: "button", class: "btn-sm ghost", "aria-pressed": String(am), text: am ? "Ik ga ✓" : "Ik ga", on: { click: function () { toggleGoing(ev); } } }));
      if (canSocial() && (ev.createdBy === S.meId || (S.uid && ev.by === S.uid))) acts.appendChild(confirmBtn("ev:" + ev.id, "Verwijder", function () { deleteDoc("events/" + ev.id, "Afspraak verwijderd."); }));
      box.appendChild(el("div", { class: "event" }, [
        el("div", { class: "cd", "aria-label": "Over " + cd.n + " " + cd.u }, [el("b", { text: cd.n }), el("span", { text: cd.u })]),
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
    $("ch-rule").textContent = "Wie het doet, claimt het. Na " + need + " " + (need === 1 ? "bevestiging" : "bevestigingen") + " van anderen krijgt diegene de punten.";
    if (S.spelTab === "uitdagingen") {
      var list = $("ch-list"); clear(list);
      var open = S.challenges.filter(function (c) { return !c.closed; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      var done = S.challenges.filter(function (c) { return c.closed; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 15);
      if (!open.length && !done.length) list.appendChild(el("p", { class: "hint", text: canSocial() ? "Nog geen uitdagingen. Plaats de eerste hierboven." : "Nog geen uitdagingen." }));
      open.forEach(function (c) { list.appendChild(challengeCard(c)); });
      if (done.length) { list.appendChild(el("span", { class: "label", text: "Gesloten" })); done.forEach(function (c) { list.appendChild(challengeCard(c)); }); }
    } else {
      var bl = $("bet-list"); clear(bl);
      var active = S.bets.filter(function (b) { return !b.result; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      var past = S.bets.filter(function (b) { return !!b.result; }).sort(function (a, b) { return a.resultAt < b.resultAt ? 1 : -1; }).slice(0, 15);
      if (!active.length && !past.length) bl.appendChild(el("p", { class: "hint", text: canSocial() ? "Nog geen voorspellingen. Plaats de eerste hierboven." : "Nog geen voorspellingen." }));
      active.forEach(function (b) { bl.appendChild(betCard(b)); });
      if (past.length) { bl.appendChild(el("span", { class: "label", text: "Afgerond" })); past.forEach(function (b) { bl.appendChild(betCard(b)); }); }
    }
  }
  function challengeCard(c) {
    var card = el("article", { class: "game" });
    var isCreator = canSocial() && (c.createdBy === S.meId || (S.uid && c.by === S.uid));
    card.appendChild(el("div", { class: "game-top" }, [el("div", { class: "game-title", text: c.title }), el("span", { class: "pts-badge", text: "+" + c.points })]));
    card.appendChild(el("div", { class: "game-meta" }, ["Van ", nameBtn(c.createdBy, "inline"), " · " + ago(c.at) + (c.closed ? " · gesloten" : "")]));
    var myClaim = null, claims = el("div", { class: "claims" });
    c.claims.forEach(function (cl) {
      if (cl.memberId === S.meId) myClaim = cl;
      var right = el("div", { class: "claim-right" });
      if (cl.approved) right.appendChild(el("span", { class: "state ok", text: "Gehaald ✓" }));
      else {
        right.appendChild(el("span", { class: "state", text: cl.confirms.length + "/" + c.need + " bevestigd" }));
        if (canSocial() && cl.memberId !== S.meId && cl.confirms.indexOf(S.meId) < 0) right.appendChild(el("button", { type: "button", class: "btn-sm", text: "Bevestig", on: { click: function () { confirmClaim(c, cl.memberId); } } }));
      }
      claims.appendChild(el("div", { class: "claim" }, [avatar(cl.memberId, "s"), nameBtn(cl.memberId), right]));
    });
    if (c.claims.length) card.appendChild(claims);
    else card.appendChild(el("p", { class: "hint", text: c.closed ? "Niemand heeft deze uitdaging gehaald." : "Nog niemand heeft het gedaan." }));
    var acts = el("div", { class: "game-acts" });
    if (canSocial()) {
      if (!c.closed && !myClaim) acts.appendChild(el("button", { type: "button", class: "btn-sm", text: "Ik heb het gedaan", on: { click: function () { claimChallenge(c); } } }));
      if (myClaim && !myClaim.approved) acts.appendChild(el("button", { type: "button", class: "link-btn", text: "Claim intrekken", on: { click: function () { withdrawClaim(c); } } }));
      if (isCreator && !c.closed) acts.appendChild(confirmBtn("chclose:" + c.id, "Sluiten", function () { closeChallenge(c); }));
      if (isCreator && !c.claims.length) acts.appendChild(confirmBtn("chdel:" + c.id, "Verwijder", function () { deleteDoc("challenges/" + c.id, "Uitdaging verwijderd."); }));
    }
    if (acts.childNodes.length) card.appendChild(acts);
    return card;
  }
  function betCard(b) {
    var card = el("article", { class: "game" });
    var isCreator = canSocial() && (b.createdBy === S.meId || (S.uid && b.by === S.uid));
    var my = null; b.stakes.forEach(function (s) { if (s.memberId === S.meId) my = s; });
    card.appendChild(el("div", { class: "game-meta" }, ["Voorspelling van ", nameBtn(b.createdBy, "inline"), " · " + ago(b.at)]));
    card.appendChild(el("div", { class: "game-title big", text: b.title }));
    var odds = el("div", { class: "odds" });
    ["ja", "nee"].forEach(function (side) {
      var st = b.stakes.filter(function (s) { return s.side === side; });
      var pool = st.reduce(function (s, x) { return s + x.amount; }, 0);
      var cls = "odd" + (my && my.side === side ? " mine" : "") + (b.result === side ? " win" : "");
      var kids = [
        el("span", { class: "side", text: (side === "ja" ? "Ja" : "Nee") + (b.result === side ? " ✓" : "") }),
        el("span", { class: "mult", text: "×" + fmtOdds(b.odds[side]) }),
        el("span", { class: "who", text: st.length ? listNames(st.map(function (s) { return s.memberId; }), 3) + " · " + pool + " pnt" : "Nog niemand" })
      ];
      if (b.open && canSocial()) odds.appendChild(el("button", { type: "button", class: cls, "aria-pressed": String(!!(my && my.side === side)), on: { click: function () { placeStake(b, side); } } }, kids));
      else odds.appendChild(el("div", { class: cls }, kids));
    });
    card.appendChild(odds);
    if (b.open && canSocial()) {
      var sel = S.stakeSel[b.id] || (my ? my.amount : 10);
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
      var win = Math.round(my.amount * (b.odds[my.side] - 1));
      card.appendChild(el("p", { class: "hint" }, ["Jij: " + my.amount + " pnt op " + (my.side === "ja" ? "Ja" : "Nee") + ". Goed is +" + win + ", fout is −" + my.amount + ". ",
        b.open ? el("button", { type: "button", class: "link-btn", text: "Inzet intrekken", on: { click: function () { withdrawStake(b); } } }) : null]));
    } else if (b.open && canSocial()) {
      card.appendChild(el("p", { class: "hint", text: "Kies een inzet en tik op Ja of Nee." }));
    }
    if (b.result === "void") {
      card.appendChild(el("p", { class: "hint", text: "Geannuleerd. Niemand wint of verliest punten." }));
    } else if (b.result) {
      var res = el("div", { class: "result" }, [el("b", { text: "Uitkomst: " + (b.result === "ja" ? "het gebeurde" : "het gebeurde niet") })]);
      var line = el("span");
      b.stakes.map(function (s) { var w = s.side === b.result; return { id: s.memberId, g: w ? Math.round(s.amount * (b.odds[s.side] - 1)) : -s.amount }; })
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
      var vj = b.votes.ja.length, vn = b.votes.nee.length, mine = b.voteOf[S.meId];
      var vote = el("div", { class: "vote" }, [el("span", { class: "hint", text: b.open
        ? "Weet je de uitkomst? Stemmen sluit de inzet. Na " + b.need + " " + (b.need === 1 ? "stem" : "stemmen") + " is het definitief."
        : "Inzet gesloten. Wat is de uitkomst? Ja " + vj + "/" + b.need + " · Nee " + vn + "/" + b.need })]);
      if (canSocial()) vote.appendChild(el("div", { class: "vote-btns" }, [
        el("button", { type: "button", class: "btn-sm ghost", "aria-pressed": String(mine === "ja"), text: "Het gebeurde", on: { click: function () { voteOutcome(b, "ja"); } } }),
        el("button", { type: "button", class: "btn-sm ghost", "aria-pressed": String(mine === "nee"), text: "Gebeurde niet", on: { click: function () { voteOutcome(b, "nee"); } } })
      ]));
      card.appendChild(vote);
    }
    var acts = el("div", { class: "game-acts" });
    if (isCreator && !b.result) acts.appendChild(confirmBtn("betvoid:" + b.id, "Annuleren", function () { q("bets/" + b.id, function () { return S.db.doc("bets/" + b.id).update({ void: true }); }).then(function () { toast("Voorspelling geannuleerd."); }).catch(function (e) { writeError(e, "annuleren"); }); }));
    if (isCreator && !b.stakes.length && !b.votes.ja.length && !b.votes.nee.length) acts.appendChild(confirmBtn("betdel:" + b.id, "Verwijder", function () { deleteDoc("bets/" + b.id, "Voorspelling verwijderd."); }));
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
  function buildPointsForm() {
    var g = $("points-grid");
    DRINKS.forEach(function (d) {
      var inp = el("input", { class: "field", id: "pt-" + d.key, type: "number", inputmode: "numeric", min: "-20", max: "20", step: "1" });
      inp.addEventListener("input", function () { S.pointsDirty = true; $("points-save").disabled = !canWriteNow(); });
      g.appendChild(el("label", null, [d.label, inp]));
    });
  }
  function syncPointsForm() {
    if (S.pointsDirty) return;
    DRINKS.forEach(function (d) { var i = $("pt-" + d.key); if (document.activeElement !== i) i.value = String(pv(d.key)); });
    $("points-save").disabled = true;
  }
  function renderGroup() {
    var n = S.members.length;
    $("members-label").textContent = "Groep · " + n + "/" + MAX_MEMBERS;
    var regs = {}; S.entries.forEach(function (e) { regs[e.memberId] = (regs[e.memberId] || 0) + 1; });
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
      var acts = [];
      if (m.id === S.meId) acts.push(el("span", { class: "tag-me", text: "Jij" }));
      else if (!takenByOther(m)) acts.push(el("button", { type: "button", class: "link-btn", text: "Dit ben ik", on: { click: function () { setMe(m.id); } } }));
      if (canWriteNow()) {
        acts.push(el("button", { type: "button", class: "link-btn", text: "Naam wijzigen", on: { click: function () { S.editing = m.id; S.editValue = m.name; S.focusEdit = true; S.confirmKey = null; render(); } } }));
        if (takenByOther(m)) acts.push(confirmBtn("free:" + m.id, "Vrijgeven", function () { q("members/" + m.id, function () { return S.db.doc("members/" + m.id).update({ uid: null }); }).then(function () { toast(m.name + " is vrijgegeven."); }).catch(function (e) { writeError(e, "namen vrijgeven"); }); }));
        if (!count) acts.push(confirmBtn("rm:" + m.id, "Verwijder", function () { removeMember(m); }));
      }
      var sub = count + (count === 1 ? " registratie" : " registraties") + (takenByOther(m) ? " · gekoppeld aan een ander account" : "");
      box.appendChild(el("div", { class: "member" }, [
        avatar(m.id),
        el("div", { class: "who" }, [nameBtn(m.id), el("span", { class: "bd", text: sub })]),
        el("div", { class: "acts" }, acts)
      ]));
    });
    $("add-member").hidden = n >= MAX_MEMBERS || !canWriteNow();
    $("add-hint").textContent = n >= MAX_MEMBERS
      ? "De groep is vol (15 namen). Verwijder eerst een naam zonder registraties."
      : "Maximaal 15 namen. Iedereen kan voor iedereen registreren, handig als iemands telefoon leeg is. Namen met registraties kun je hernoemen maar niet verwijderen.";
    var link = BK && BK.inviteLink ? BK.inviteLink() : "";
    $("invite-card").hidden = !link;
    if (link) {
      if ($("invite-link").value !== link) $("invite-link").value = link;
      var gi = BK.group();
      $("invite-code").textContent = gi && gi.code ? "Groepscode: " + gi.code : "";
      $("invite-share").hidden = !navigator.share;
    }
    $("points-form").hidden = !S.db;
    syncPointsForm();
  }

  // ----- Profiel -----
  function openProfile(id) {
    if (!memberById(id)) return;
    if (!S.profileId) S.prevTab = S.tab;
    S.profileId = id; S.confirmKey = null; render(); window.scrollTo(0, 0);
  }
  function closeProfile() { S.profileId = null; S.tab = S.prevTab || "tellen"; render(); window.scrollTo(0, 0); }
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
    if (S.online[id]) tags.appendChild(el("span", { class: "online-tag", text: "Nu in de app" }));
    box.appendChild(el("div", { class: "prof-head" }, [avatar(id, "l"), el("div", null, [el("h2", { text: nameOf(id) }), tags])]));

    function stat(v, l, cls, small) { return el("div", { class: "stat" + (cls ? " " + cls : "") }, [el("b", { class: small ? "small" : null, text: String(v) }), el("span", { text: l })]); }
    var grid = el("div", { class: "stats" }, [
      stat(all.pts, "punten"), stat(all.drinks, drinksWord(all.drinks)), stat(Object.keys(nights).length, "avonden uit"),
      stat(d.mvp[id] || 0, "MVP-avonden"), stat(best ? nights[best] : 0, best ? "beste avond · " + nightLabel(best) : "beste avond"), stat(all.counts.barfjes, all.counts.barfjes === 1 ? "barfje" : "barfjes", "barf"),
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
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function placeTip(card, svg, tip, xSvg, W) {
    var r = svg.getBoundingClientRect(), cr = card.getBoundingClientRect(), scale = r.width / W;
    var left = (r.left - cr.left) + xSvg * scale;
    tip.hidden = false;
    var tw = tip.offsetWidth, l = left + 12;
    if (l + tw > card.clientWidth - 4) l = left - tw - 12;
    if (l < 4) l = 4;
    tip.style.left = l + "px"; tip.style.top = (r.top - cr.top + 4) + "px";
  }
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
    }
    function hide() { cur = -1; tip.hidden = true; cross.setAttribute("visibility", "hidden"); hov.forEach(function (c) { c.setAttribute("visibility", "hidden"); }); }
    function idxAt(ev) {
      var r = svg.getBoundingClientRect(), xs = (ev.clientX - r.left) * (W / r.width);
      return Math.max(0, Math.min(n - 1, Math.round(((xs - pl) / iw) * (n - 1))));
    }
    svg.addEventListener("pointermove", function (ev) { show(idxAt(ev)); });
    svg.addEventListener("pointerdown", function (ev) { show(idxAt(ev)); });
    svg.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") hide(); });
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
        bar.classList.add("lift"); clear(tip);
        tip.appendChild(el("div", { class: "t-h", text: nightLabel(r.night) }));
        tip.appendChild(tipRow("s1", r.pts, "punten"));
        tip.appendChild(tipRow("none", r.drinks, drinksWord(r.drinks)));
        placeTip(card, svg, tip, cx, W);
      }
      function off() { bar.classList.remove("lift"); tip.hidden = true; }
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("pointerdown", on);
      hit.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") off(); });
      hit.addEventListener("focus", on);
      hit.addEventListener("blur", off);
      svg.appendChild(hit);
    });
    card.appendChild(svg);
    card.appendChild(tip);
    card.appendChild(tableBtn("nights"));
    if (S.tables.nights) card.appendChild(dataTable(["Avond", "Punten", "Drankjes"], rows.slice().reverse().map(function (r) { return [nightLabel(r.night), r.pts, r.drinks]; })));
    return el("section", { class: "sec" }, [el("span", { class: "label", text: "Punten per avond · laatste " + n }), card]);
  }

  // ---------- actions ----------
  function validName(raw, exceptId) {
    var name = str(raw, 24);
    if (!name) { toast("Vul een naam in."); return null; }
    if (S.members.some(function (m) { return m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase(); })) { toast(name + " staat al in de groep."); return null; }
    return name;
  }
  function addMember(raw, makeMe) {
    if (!canWriteNow()) return Promise.resolve();
    if (S.members.length >= MAX_MEMBERS) { toast("De groep is vol (15 namen)."); return Promise.resolve(); }
    var name = validName(raw); if (!name) return Promise.resolve();
    var ref = S.db.collection("members").doc();
    return withRetry(function () { return ref.set({ name: name, createdAt: nowIso(), by: S.uid || null, uid: makeMe ? (S.uid || null) : null }); })
      .then(function () { toast(name + " is toegevoegd."); if (makeMe) setMe(ref.id, true); return true; })
      .catch(function (e) { writeError(e, "namen toevoegen"); });
  }
  function renameMember(m, raw) {
    var name = validName(raw, m.id); if (!name) return;
    if (name === m.name) { S.editing = null; render(); return; }
    q("members/" + m.id, function () { return S.db.doc("members/" + m.id).update({ name: name }); })
      .then(function () { S.editing = null; if (document.activeElement) document.activeElement.blur(); toast("Naam gewijzigd in " + name + "."); render(); })
      .catch(function (e) { writeError(e, "namen wijzigen"); });
  }
  function removeMember(m) {
    q("members/" + m.id, function () { return S.db.doc("members/" + m.id).delete(); })
      .then(function () { if (S.meId === m.id) setMe(null); toast(m.name + " is verwijderd."); })
      .catch(function (e) { writeError(e, "namen verwijderen"); });
  }
  function setMe(id, skipClaim) {
    var prev = S.meId;
    S.meId = id; if (id) S.forId = id;
    safeSet(KEYS.me, id || "");
    if (S.db && S.uid) {
      var pm = prev && memberById(prev);
      if (pm && pm.uid === S.uid && prev !== id && canWriteNow()) q("members/" + prev, function () { return S.db.doc("members/" + prev).update({ uid: null }); }).catch(noop);
      var nm = id && memberById(id);
      if (!skipClaim && nm && !nm.uid && canWriteNow()) q("members/" + id, function () { return S.db.doc("members/" + id).update({ uid: S.uid }); }).catch(noop);
    }
    pushPresence(); render();
  }
  function resetCompose() {
    S.counts = zero(); safeSet(KEYS.draft, JSON.stringify(S.counts));
    S.caption = ""; $("caption").value = "";
    if (S.photo) { URL.revokeObjectURL(S.photo.url); S.photo = null; }
  }
  function uploadError(code) {
    if (code === "too_large") return "De foto is te groot.";
    if (code === "unsupported_type") return "Dit fotoformaat werkt niet. Kies een JPG of PNG.";
    if (code === "quota_or_state") return "De opslag voor foto's is vol.";
    if (code === "rate_limited") return "Even rustig aan. Probeer het zo opnieuw.";
    return "Foto uploaden is mislukt. Probeer het opnieuw of haal de foto weg.";
  }
  function register() {
    var hasContent = anyCount(S.counts) || !!S.photo;
    if (!hasContent || !S.forId || !memberById(S.forId) || !canWriteNow() || S.busy) return;
    var counts = cleanCounts(S.counts), forId = S.forId, caption = str(S.caption, 140), photo = S.photo;
    S.busy = true; S.busyText = photo ? "Uploaden…" : "Opslaan…"; renderHeader();
    var up = photo && S.assets
      ? S.assets.upload(photo.blob, { type: photo.blob.type || "image/jpeg" }).catch(function (e) {
          if (e && e.code === "store_unavailable") return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return S.assets.upload(photo.blob, { type: photo.blob.type || "image/jpeg" }); });
          throw e;
        }).catch(function (e) { throw { upload: true, code: e && e.code }; })
      : Promise.resolve(null);
    up.then(function (asset) {
      var now = new Date(), ref = S.db.collection("entries").doc();
      var body = { memberId: forId, by: S.uid || null, counts: counts, at: now.toISOString(), night: nightKey(now), likes: {}, comments: {} };
      if (caption) body.caption = caption;
      if (asset) body.photo = asset.id;
      return withRetry(function () { return ref.set(body); }).then(function () {
        var keepBlob = photo ? photo.blob : null;
        if (!S.uid) localIds[ref.id] = true;
        resetCompose();
        var what = breakdown(counts, true) || "foto";
        toast("Geregistreerd voor " + nameOf(forId) + ": " + what, function () {
          q("entries/" + ref.id, function () { return ref.delete(); }).then(function () {
            if (asset && S.assets) S.assets.delete(asset.id).catch(noop);
            S.counts = counts; S.caption = caption; safeSet(KEYS.draft, JSON.stringify(counts));
            if (keepBlob) setPhoto(keepBlob);
            toast("Registratie teruggedraaid."); render();
          }).catch(function (e) { writeError(e, "registraties verwijderen"); });
        });
      });
    }).catch(function (e) {
      if (e && e.upload) toast(uploadError(e.code)); else writeError(e, "registreren");
    }).then(function () { S.busy = false; render(); });
  }
  function removeEntry(e) {
    q("entries/" + e.id, function () { return S.db.doc("entries/" + e.id).delete(); })
      .then(function () {
        if (e.photo && S.assets) S.assets.delete(e.photo).catch(noop);
        toast("Registratie van " + nameOf(e.memberId) + " verwijderd.");
      })
      .catch(function (err) { writeError(err, "registraties verwijderen"); });
  }
  function findEntry(id) { for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) return S.entries[i]; return null; }
  function toggleLike(entryId, btn) {
    if (!requireMe()) return;
    var e = findEntry(entryId); if (!e) return;
    var liked = !!e.likes[S.meId], patch = { likes: {} };
    patch.likes[S.meId] = !liked;
    if (!liked && btn) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
    q("entries/" + entryId, function () { return S.db.doc("entries/" + entryId).update(patch); }).catch(function (err) { writeError(err, "proosten"); });
  }
  function addComment(entryId, raw) {
    if (!requireMe()) return;
    var text = str(raw, 280); if (!text) return;
    var cid = newId(), patch = { comments: {} };
    patch.comments[cid] = { memberId: S.meId, by: S.uid || null, text: text, at: nowIso() };
    S.commentDrafts[entryId] = "";
    var inp = $("cmt-" + entryId); if (inp) inp.value = "";
    q("entries/" + entryId, function () { return S.db.doc("entries/" + entryId).update(patch); })
      .catch(function (err) { S.commentDrafts[entryId] = text; writeError(err, "reageren"); });
  }
  function removeComment(entryId, cid) {
    var patch = { comments: {} }; patch.comments[cid] = null;
    q("entries/" + entryId, function () { return S.db.doc("entries/" + entryId).update(patch); }).catch(function (err) { writeError(err, "reacties verwijderen"); });
  }
  function deleteDoc(path, msg) {
    q(path, function () { return S.db.doc(path).delete(); }).then(function () { toast(msg); }).catch(function (e) { writeError(e, "verwijderen"); });
  }
  function claimChallenge(c) {
    if (!requireMe()) return;
    var patch = { claims: {} }; patch.claims[S.meId] = { at: nowIso(), by: S.uid || null, confirms: {} };
    q("challenges/" + c.id, function () { return S.db.doc("challenges/" + c.id).update(patch); })
      .then(function () { toast("Geclaimd. Nu nog " + c.need + " " + (c.need === 1 ? "bevestiging" : "bevestigingen") + " van anderen."); })
      .catch(function (e) { writeError(e, "claimen"); });
  }
  function withdrawClaim(c) {
    var patch = { claims: {} }; patch.claims[S.meId] = null;
    q("challenges/" + c.id, function () { return S.db.doc("challenges/" + c.id).update(patch); }).catch(function (e) { writeError(e, "intrekken"); });
  }
  function confirmClaim(c, mid) {
    if (!requireMe() || mid === S.meId) return;
    var patch = { claims: {} }; patch.claims[mid] = { confirms: {} }; patch.claims[mid].confirms[S.meId] = nowIso();
    q("challenges/" + c.id, function () { return S.db.doc("challenges/" + c.id).update(patch); })
      .then(function () { toast("Bevestigd voor " + nameOf(mid) + "."); })
      .catch(function (e) { writeError(e, "bevestigen"); });
  }
  function closeChallenge(c) {
    q("challenges/" + c.id, function () { return S.db.doc("challenges/" + c.id).update({ closed: true }); }).then(function () { toast("Uitdaging gesloten."); }).catch(function (e) { writeError(e, "sluiten"); });
  }
  function placeStake(b, side) {
    if (!requireMe()) return;
    var amount = S.stakeSel[b.id] || 10, patch = { stakes: {} };
    patch.stakes[S.meId] = { side: side, amount: amount, at: nowIso() };
    q("bets/" + b.id, function () { return S.db.doc("bets/" + b.id).update(patch); }).catch(function (e) { writeError(e, "inzetten"); });
  }
  function withdrawStake(b) {
    var patch = { stakes: {} }; patch.stakes[S.meId] = null;
    q("bets/" + b.id, function () { return S.db.doc("bets/" + b.id).update(patch); }).catch(function (e) { writeError(e, "intrekken"); });
  }
  function voteOutcome(b, side) {
    if (!requireMe()) return;
    var patch = { votes: {} }; patch.votes[S.meId] = { side: side, at: nowIso() };
    q("bets/" + b.id, function () { return S.db.doc("bets/" + b.id).update(patch); }).catch(function (e) { writeError(e, "stemmen"); });
  }
  function toggleGoing(ev) {
    if (!requireMe()) return;
    var patch = { going: {} }; patch.going[S.meId] = !ev.going[S.meId];
    q("events/" + ev.id, function () { return S.db.doc("events/" + ev.id).update(patch); }).catch(function (e) { writeError(e, "aanmelden"); });
  }

  // ---------- wiring ----------
  buildCounters(); buildPointsForm();
  (function buildOdds() {
    var box = $("bet-odds");
    ODDS.forEach(function (o, i) {
      var inp = el("input", { type: "radio", name: "bet-odds", value: o.key });
      if (i === 1) inp.checked = true;
      box.appendChild(el("label", null, [inp, el("span", { text: o.label + " · ×" + fmtOdds(o.ja) + " / ×" + fmtOdds(o.nee) })]));
    });
  })();
  $("btn-clear").addEventListener("click", function () { resetCompose(); render(); });
  $("btn-reg").addEventListener("click", register);
  $("btn-back").addEventListener("click", closeProfile);
  document.querySelectorAll(".tabs button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      S.tab = btn.getAttribute("data-tab"); safeSet(KEYS.tab, S.tab); S.profileId = null; S.editing = null; S.confirmKey = null;
      if (S.tab === "feed") S.feedLimit = FEED_PAGE;
      render(); window.scrollTo(0, 0);
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
    addMember(input.value, true).then(function (ok) { if (ok) input.value = ""; });
  });
  $("ch-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!requireMe()) return;
    var title = str($("ch-title").value, 80); if (!title) { toast("Beschrijf de uitdaging."); return; }
    var ptsEl = document.querySelector('input[name="ch-pts"]:checked'), pts = clampInt(ptsEl ? ptsEl.value : 10, 1, 100, 10);
    var now = new Date();
    withRetry(function () { return S.db.collection("challenges").add({ title: title, points: pts, createdBy: S.meId, by: S.uid || null, at: now.toISOString(), night: nightKey(now), need: needNow(), closed: false, claims: {} }); })
      .then(function () { $("ch-title").value = ""; toast("Uitdaging geplaatst."); })
      .catch(function (e) { writeError(e, "uitdagingen plaatsen"); });
  });
  $("bet-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!requireMe()) return;
    var title = str($("bet-title").value, 100); if (!title) { toast("Schrijf op wat je voorspelt."); return; }
    var oEl = document.querySelector('input[name="bet-odds"]:checked'), o = ODDS[1];
    ODDS.forEach(function (x) { if (oEl && x.key === oEl.value) o = x; });
    var now = new Date();
    withRetry(function () { return S.db.collection("bets").add({ title: title, oddsKey: o.key, odds: { ja: o.ja, nee: o.nee }, createdBy: S.meId, by: S.uid || null, at: now.toISOString(), night: nightKey(now), need: needNow(), closedAt: null, void: false, stakes: {}, votes: {} }); })
      .then(function () { $("bet-title").value = ""; toast("Voorspelling geplaatst. Zet zelf ook in."); })
      .catch(function (e) { writeError(e, "voorspellingen plaatsen"); });
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
    if (!requireMe()) return;
    var title = str($("ev-title").value, 60), date = $("ev-date").value, time = $("ev-time").value;
    if (!title) { toast("Geef de afspraak een naam."); return; }
    if (!validNight(date)) { toast("Kies een datum."); return; }
    var going = {}; going[S.meId] = true;
    withRetry(function () { return S.db.collection("events").add({ title: title, date: date, time: /^\d{2}:\d{2}$/.test(time) ? time : "", createdBy: S.meId, by: S.uid || null, at: nowIso(), going: going }); })
      .then(function () { $("ev-title").value = ""; $("ev-time").value = ""; $("event-form").hidden = true; toast("Gepland: " + title + "."); render(); })
      .catch(function (e) { writeError(e, "plannen"); });
  });
  $("points-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!canWriteNow()) return;
    var values = {};
    DRINKS.forEach(function (d) { values[d.key] = clampInt($("pt-" + d.key).value, -20, 20, DEFAULT_POINTS[d.key]); });
    q("config/points", function () { return S.db.doc("config/points").set({ values: values, updatedAt: nowIso(), by: S.uid || null }); })
      .then(function () { S.pointsDirty = false; toast("Puntentelling opgeslagen."); syncPointsForm(); })
      .catch(function (e) { writeError(e, "punten opslaan"); });
  });
  setInterval(function () { render(); }, 60000);

  // ---------- data ----------
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
      if (S.meId && takenByOther(memberById(S.meId))) { S.meId = null; safeSet(KEYS.me, ""); }
      if (S.forId && !memberById(S.forId) && S.loaded.members) S.forId = memberById(S.meId) ? S.meId : null;
      if (!S.forId && S.meId && memberById(S.meId)) S.forId = S.meId;
    });
    sub("entries", normalizeEntry);
    sub("challenges", normalizeChallenge);
    sub("bets", normalizeBet);
    sub("events", normalizeEvent);
    db.doc("config/points").onSnapshot(function (snap) {
      S.points = snap.exists ? cleanPoints((snap.data() || {}).values) : {};
      S.ver++; syncPointsForm(); render();
    }, noop);
  }

  // ---------- start ----------
  function showGate(kind) {
    document.body.classList.toggle("gated", kind !== null);
    $("gate").hidden = kind === null;
    if (kind === null) return;
    $("gate-loading").hidden = kind !== "loading";
    $("gate-code").hidden = kind !== "code";
    $("gate-msg").hidden = ["config", "auth", "network"].indexOf(kind) < 0;
    var msgs = {
      config: "De app is nog niet gekoppeld aan een database. Vul de Supabase-gegevens in config.js in.",
      auth: "Inloggen lukt niet. Zet in Supabase anonieme logins aan (Authentication, Sign In / Providers) en probeer het opnieuw.",
      network: "Geen verbinding met de database. Controleer je internet en probeer het opnieuw."
    };
    if (msgs[kind]) $("gate-msg-text").textContent = msgs[kind];
    $("gate-retry").hidden = kind === "config";
    if (kind === "code") setTimeout(function () { $("gate-input").focus(); }, 0);
  }
  $("gate-code").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var code = $("gate-input").value.trim();
    if (!code) return;
    $("gate-submit").disabled = true; $("gate-error").hidden = true;
    BK.join(code).then(function (ok) {
      $("gate-submit").disabled = false;
      if (ok) boot(); else $("gate-error").hidden = false;
    });
  });
  $("gate-retry").addEventListener("click", function () { location.reload(); });
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

  function start() {
    var draft = null; try { draft = JSON.parse(safeGet(KEYS.draft) || "null"); } catch (e) {}
    S.counts = cleanCounts(draft);
    var t = safeGet(KEYS.tab);
    if (["feed", "spel", "tellen", "ranglijst", "groep"].indexOf(t) >= 0) S.tab = t;
    S.feedSeen = safeGet(KEYS.seen) || "";
    S.meId = safeGet(KEYS.me) || null; S.forId = S.meId;
    syncPointsForm();
    render();
    if (!BK || !BK.configured()) { showGate("config"); return; }
    showGate("loading");
    BK.start().then(function (res) {
      if (res && res.ok) boot();
      else if (res && res.needCode) showGate("code");
      else showGate(res && res.error === "auth" ? "auth" : res && res.error === "config" ? "config" : "network");
    });
  }
  function boot() {
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
