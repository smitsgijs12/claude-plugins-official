/* Turflijst backend: connects the app to Supabase.
 * Exposes window.backend with start(), join(code), use(name), photoUrl(id), group(), inviteLink(),
 * parseCode(text) and pastUids().
 * use("db") gives a small document store (collections of JSON documents, live updates),
 * use("user") the anonymous login, use("assets") photo storage, use("room") who is online. */
(function () {
  "use strict";

  var CODE_KEY = "turflijst-code", AUTH_KEY = "turflijst-auth", UIDS_KEY = "turflijst-uids";
  var BUCKET = "photos";
  var REQ_MS = 15000, UPLOAD_MS = 120000; // a stalled request fails instead of hanging forever
  var st = { sb: null, uid: null, grp: null, group: null, ns: null, gen: 0, ctl: [], lost: false };
  function conf() { return window.TURFLIJST_CONFIG || {}; }

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function safeDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function noop() {}
  function quiet(fn) { try { var p = fn(); if (p && p.catch) p.catch(noop); } catch (e) {} }
  function randId(n) {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", s = "", buf = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < n; i++) s += a[buf[i] % 36];
    return s;
  }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function merge(t, p) {
    Object.keys(p).forEach(function (k) {
      if (isObj(p[k]) && isObj(t[k])) merge(t[k], p[k]); else t[k] = clone(p[k]);
    });
    return t;
  }
  function err(code, message) { return { code: code, message: message || code }; }
  function mapErr(e) {
    if (!e) return err("unavailable");
    if (e.code && typeof e.message === "string" && /^[a-z_]+$/.test(e.code) && !e.details && !e.hint && ["invalid_argument", "unavailable", "quota_exceeded", "not_found", "rate_limited"].indexOf(e.code) >= 0) return e;
    var c = String(e.code || ""), m = String(e.message || "");
    if (c === "TL429") {
      var secs = /retry_after_seconds=(\d+)/.exec(String(e.details || "")), mins = secs ? Math.max(1, Math.ceil(+secs[1] / 60)) : 10;
      return err("rate_limited", "Te vaak een verkeerde code geprobeerd. " + (mins > 60 ? "Probeer het morgen opnieuw." : "Wacht " + mins + (mins === 1 ? " minuut." : " minuten.")));
    }
    if (c === "P0002") return err("not_found", m);
    if (c === "42501" || c === "23503" || c === "23514" || /row-level security|violates/i.test(m)) return err("invalid_argument", m);
    return err("unavailable", m);
  }

  // ---------- group codes ----------
  // Case, invisible characters and extra spaces never matter (the server normalises the same way).
  function normCode(c) {
    return String(c == null ? "" : c).replace(/[\u200B-\u200F\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  }
  // The code inside an invite link (?g=CODE, or the older #join=CODE), or "" when there is none.
  function linkCode(s) {
    var m = /[?#&](?:g|join)=([^&#\s]*)/i.exec(String(s || ""));
    if (!m) return "";
    var v = m[1];
    try { v = decodeURIComponent(v); } catch (e) {}
    return normCode(v.replace(/[.,;:!?)\]'"]+$/, ""));
  }
  // What someone typed or pasted in the code field: a code, or a whole invite link.
  function parseCode(text) {
    var fromLink = linkCode(text);
    if (fromLink) return fromLink;
    if (/^\s*(https?:\/\/|www\.)/i.test(String(text || ""))) return "";
    return normCode(text);
  }
  // Keep the code in the address bar, so "Zet op beginscherm" saves a link that joins by itself.
  function showCodeInUrl(code) {
    try {
      var want = code ? "?g=" + encodeURIComponent(code) : "";
      if (location.search + location.hash !== want) history.replaceState(null, "", location.pathname + want);
    } catch (e) {}
  }

  // Every login this device has had, so names and registrations made with an older one stay yours.
  function pastUids() {
    try { var a = JSON.parse(safeGet(UIDS_KEY) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string" && x; }) : []; }
    catch (e) { return []; }
  }
  function rememberUid(id) {
    var a = pastUids();
    if (id && a.indexOf(id) < 0) { a.push(id); safeSet(UIDS_KEY, JSON.stringify(a.slice(-20))); }
  }

  // ---------- setup checks ----------
  // The secret / service_role key bypasses all access rules; it must never be on the site.
  function keyProblem(k) {
    if (/^sb_secret_/i.test(k)) return "secretkey";
    var p = k.split(".");
    if (p.length === 3) {
      try {
        var b = p[1].replace(/-/g, "+").replace(/_/g, "/");
        while (b.length % 4) b += "=";
        var j = JSON.parse(atob(b));
        if (j && j.role === "service_role") return "secretkey";
      } catch (e) {}
    }
    return null;
  }
  function cleanUrl(u) {
    u = String(u || "").trim();
    if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
    return u.replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/i, "").replace(/\/+$/, "");
  }
  // null when everything is in place, else "load" (a file did not arrive), "config" or "secretkey".
  function setupProblem() {
    var c = window.TURFLIJST_CONFIG;
    if (!c) return "load";
    var url = String(c.supabaseUrl || "").trim(), key = String(c.supabaseKey || "").trim();
    if (!url || !key) return "config";
    var kp = keyProblem(key);
    if (kp) return kp;
    if (!window.supabase || typeof window.supabase.createClient !== "function") return "load";
    return null;
  }
  function configured() { return !setupProblem(); }
  // Fetch the scripts that failed to load (bad reception), without reloading the page.
  function loadMissing() {
    var need = [];
    if (!window.TURFLIJST_CONFIG) need.push("config.js");
    if (!window.supabase) need.push("vendor/supabase.js");
    return Promise.all(need.map(function (src) {
      return new Promise(function (done) {
        var s = document.createElement("script");
        s.src = src; s.onload = s.onerror = function () { done(); };
        document.head.appendChild(s);
      });
    }));
  }

  // ---------- network ----------
  function timedFetch(input, init) {
    init = init || {};
    if (typeof AbortController !== "function") return fetch(input, init);
    var url = String((input && input.url) || input), method = String(init.method || "GET").toUpperCase();
    var ms = /\/storage\/v1\//.test(url) && method !== "GET" ? UPLOAD_MS : REQ_MS;
    var ac = new AbortController(), outer = init.signal, opts = {};
    Object.keys(init).forEach(function (k) { opts[k] = init[k]; });
    opts.signal = ac.signal;
    if (outer) { if (outer.aborted) ac.abort(); else outer.addEventListener("abort", function () { ac.abort(); }); }
    var t = setTimeout(function () { ac.abort(); }, ms);
    ac.keep = /\/auth\/v1\/token/.test(url); // never cut off a login refresh halfway: the token may already be rotated
    st.ctl.push(ac);
    function done() { clearTimeout(t); var i = st.ctl.indexOf(ac); if (i >= 0) st.ctl.splice(i, 1); }
    return fetch(input, opts).then(function (r) { done(); return r; }, function (e) { done(); throw e; });
  }
  // A new start attempt cancels the requests of the one before it (above all a sign-up, so two
  // attempts can never each make an account).
  function abortAll() {
    st.ctl.slice().forEach(function (c) { if (!c.keep) { try { c.abort(); } catch (e) {} } });
  }
  function makeClient() {
    var c = conf();
    if (st.sb && st.sb.auth && typeof st.sb.auth.dispose === "function") quiet(function () { return st.sb.auth.dispose(); });
    // Auto refresh stays off until a start attempt succeeds, so an abandoned attempt's client never
    // refreshes the shared login behind our back. getSession() still refreshes an expired token.
    st.sb = window.supabase.createClient(cleanUrl(c.supabaseUrl), String(c.supabaseKey).trim(), {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: AUTH_KEY },
      global: { fetch: timedFetch }
    });
    return st.sb;
  }
  function retryable(e) { var s = (e && e.status) | 0; return !!e && (e.name === "AuthRetryableFetchError" || !s || s >= 500); }
  function authKind(e) {
    var s = (e && e.status) | 0, c = String((e && e.code) || ""), m = String((e && e.message) || "");
    if (retryable(e)) return "network";
    if (s === 429 || c === "over_request_rate_limit" || /rate limit/i.test(m)) return "busy";
    if (c === "anonymous_provider_disabled" || /anonymous/i.test(m)) return "auth";
    if (s === 401 || s === 403 || /api ?key|jwt/i.test(m)) return "key";
    return "network";
  }
  // "toomany" (TL429), "network" (no answer, server trouble, login trouble) or "wrong".
  function joinErrKind(e) {
    if (mapErr(e).code === "rate_limited") return "toomany";
    var c = String((e && e.code) || ""), s = (e && e.status) | 0;
    if (!c || !s || s >= 500 || s === 401 || s === 403 || /^(PGRST|08|53|57|42501)/.test(c)) return "network";
    return "wrong";
  }

  // ---------- start & join ----------
  // Never makes a new anonymous login while a stored one exists: a failed refresh on a bad
  // network keeps the stored login, so the next try comes back as the same person.
  function session(sb) {
    return sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (s && s.user) return s;
      if (r && r.error && (retryable(r.error) || safeGet(AUTH_KEY))) throw { kind: "network", message: "login vernieuwen mislukt: " + r.error.message };
      return sb.auth.signInAnonymously().then(function (x) {
        if (x && x.error) throw { kind: authKind(x.error), message: x.error.message };
        if (!x || !x.data || !x.data.session) throw { kind: "network", message: "geen login ontvangen" };
        return x.data.session;
      });
    }, function (e) { throw { kind: "network", message: e && e.message }; });
  }
  function myGroups(sb) {
    return sb.from("groups").select("id,code,name").limit(20).then(function (r) {
      if (r.error) throw { kind: "network", message: r.error.message };
      return r.data || [];
    });
  }
  function joinGroup(sb, code) {
    return sb.rpc("join_group", { p_code: code }).then(function (r) {
      if (r.error) throw { code: r.error.code, message: r.error.message, details: r.error.details, status: r.status };
      if (!r.data) return null;
      var id = r.data, fallback = { id: id, code: code, name: "Turflijst" };
      return sb.from("groups").select("id,code,name").eq("id", id).maybeSingle().then(function (x) {
        return (x && x.data) || fallback;
      }, function () { return fallback; });
    });
  }
  function pick(list, want) {
    for (var i = 0; i < list.length; i++) if (!want || normCode(list[i].code) === want) return list[i];
    return null;
  }
  // A code from a new link is tried first. Otherwise look up the groups this login is already in
  // (one GET), and only send the saved code when that finds nothing.
  function enter(sb, fromUrl) {
    var stored = normCode(safeGet(CODE_KEY)), want = fromUrl || stored;
    var first = fromUrl && fromUrl !== stored ? Promise.resolve(null) : myGroups(sb);
    return first.then(function (list) {
      var g = list && pick(list, want);
      if (g) return { group: g };
      if (!want) return { needCode: true };
      return joinGroup(sb, want).then(function (jg) { return jg || "wrong"; }, function (e) {
        var k = joinErrKind(e);
        if (k === "network") throw { kind: "network", message: e && e.message };
        if (k === "toomany") st.joinMsg = mapErr(e).message;
        return k;
      }).then(function (r) {
        if (typeof r !== "string") return { group: r };
        if (r === "toomany") return { needCode: true, tooMany: st.joinMsg };
        safeDel(CODE_KEY);
        return (list ? Promise.resolve(list) : myGroups(sb)).then(function (l2) {
          if (l2.length) return { group: l2[0] };
          return { needCode: true, badCode: want, fromLink: !!fromUrl };
        });
      });
    });
  }
  function useGroup(sb, g) {
    st.grp = g.id; st.group = g;
    var code = normCode(g.code);
    if (code) safeSet(CODE_KEY, code);
    showCodeInUrl(code || normCode(safeGet(CODE_KEY)));
    quiet(function () { return sb.auth.startAutoRefresh(); });
  }
  // Safe to call again after a failure (the app's retry): each call gets a fresh client, so the
  // auth library's cached refresh failure does not block the retry, and the newest call wins.
  function start() {
    if (st.grp) return Promise.resolve({ ok: true });
    var gen = ++st.gen;
    abortAll();
    function live(v) { if (gen !== st.gen) throw { stale: true }; return v; }
    var prob = setupProblem();
    return (prob === "load" ? loadMissing().then(setupProblem) : Promise.resolve(prob)).then(function (p) {
      live();
      if (p) {
        if (p === "secretkey") console.warn("Turflijst: in config.js staat de secret/service_role key. Zet er de publishable key in en maak in Supabase een nieuwe secret key aan.");
        return { error: p };
      }
      var sb;
      try { sb = makeClient(); } catch (e) {
        console.warn("Turflijst: config.js klopt niet. supabaseUrl moet de Project URL zijn, zoals https://abcdefgh.supabase.co.", e && e.message);
        return { error: "config" };
      }
      var fromUrl = linkCode(location.search + location.hash);
      if (fromUrl) showCodeInUrl(fromUrl);
      // Clearly offline: say so right away instead of letting the login refresh retry for ~30 s.
      if (navigator.onLine === false) return { error: "network", detail: "offline" };
      return session(sb).then(live).then(function (s) {
        st.uid = s.user.id; rememberUid(st.uid);
        return enter(sb, fromUrl);
      }).then(live).then(function (r) {
        if (r.group) { useGroup(sb, r.group); return { ok: true }; }
        if (fromUrl && r.badCode) showCodeInUrl("");
        return r;
      });
    }).catch(function (e) {
      if ((e && e.stale) || gen !== st.gen) return { stale: true };
      var kind = (e && e.kind) || "network";
      if (kind !== "network" || (e && e.message)) console.warn("Turflijst start: " + kind + (e && e.message ? " (" + e.message + ")" : ""));
      return { error: kind, detail: e && e.message };
    });
  }
  // From the code screen: "ok", "wrong", "toomany" (joinMessage() says how long to wait) or "network".
  function join(text) {
    var code = parseCode(text);
    if (!code) return Promise.resolve("wrong");
    if (!st.sb || !st.uid) return Promise.resolve("network");
    var sb = st.sb;
    return joinGroup(sb, code).then(function (g) {
      if (!g) { safeDel(CODE_KEY); return "wrong"; }
      if (!st.grp) useGroup(sb, g);
      return "ok";
    }, function (e) {
      var k = joinErrKind(e);
      if (k === "toomany") st.joinMsg = mapErr(e).message;
      return k;
    });
  }
  function inviteLink() {
    var code = normCode((st.group && st.group.code) || safeGet(CODE_KEY));
    if (!code) return "";
    var base = String(conf().appUrl || "").trim();
    if (base) {
      if (!/^https?:\/\//i.test(base)) base = "https://" + base;
      base = base.replace(/[?#].*$/, "").replace(/\/+$/, "") + "/";
    } else base = location.origin + location.pathname;
    return base + "?g=" + encodeURIComponent(code);
  }

  // Data requests only go out with our own login. Without one, supabase-js would fall back to the
  // anon role, where reads come back empty and writes are refused.
  function fire(name) { try { window.dispatchEvent(new Event(name)); } catch (e) {} }
  function lost() { if (!st.lost) { st.lost = true; fire("turflijst-signed-out"); } }
  function authed() {
    return st.sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) { if (!safeGet(AUTH_KEY)) lost(); throw err("unavailable", "Geen login (bereik?)"); }
      if (s.user && st.uid && s.user.id !== st.uid) { lost(); throw err("unavailable", "Andere login"); }
      return s;
    }, function (e) { throw err("unavailable", (e && e.message) || "Geen login"); });
  }
  function watchAuth(sb) {
    if (!sb.auth.onAuthStateChange) return;
    sb.auth.onAuthStateChange(function (ev, s) {
      // Deferred: the auth library must not be called again from inside its own callback.
      setTimeout(function () {
        if ((ev === "TOKEN_REFRESHED" || ev === "SIGNED_IN") && s && s.user && s.user.id === st.uid) {
          st.lost = false;
          if (st.reload) st.reload();
          fire("turflijst-auth-ok");
        } else if (ev === "SIGNED_OUT") lost();
      }, 0);
    });
  }

  // ---------- documents ----------
  // Loading: the first time names and settings come first (so "Wie ben jij?" shows quickly), then
  // everything, page by page in path order (keyset, so a delete in between cannot shift a row out).
  // After that only what changed since the newest change we saw, plus a cheap check of which
  // documents still exist every 10 minutes and after the live connection was gone.
  var PAGE = 1000, FULL = "grp,path,data,updated_at", OVERLAP_MS = 30000, DEEP_MS = 10 * 60000, TOMB_MS = 10 * 60000;
  function makeDb() {
    var sb = st.sb, grp = st.grp;
    var server = {}, stamp = {}, ops = {}, cache = {}, recvAt = {}, deletedAt = {}, tomb = {};
    var colL = {}, docL = {}, dirty = {}, flushT = null, loaded = false, colLoaded = {}, waiters = [], emptyAt = 0;
    // syncedTo: the newest updated_at a fetch gave us (server clock). Live events and write answers
    // do not move it: they can run ahead of changes we missed. cap: rows per answer (a project's
    // max-rows setting can be lower than PAGE).
    var syncedTo = 0, cap = PAGE, lastOk = 0, lastDeep = 0, hiddenAt = 0, busy = null, again = null, retryT = null, wasDown = false;
    // What the app shows as "Geen verbinding · bijgewerkt om …": ok (the last refresh worked), live
    // (the realtime channel is up), offline (the browser says so), lastOk (until when the data is
    // known to be current) and since (when the current trouble began, 0 when there is none).
    var health = { ok: true, live: false, offline: navigator.onLine === false, lastOk: 0, since: Date.now() }, healthL = [];
    function troubled(h) { return !h.ok || !h.live || h.offline; }
    function setHealth(p) {
      var was = troubled(health), ch = false;
      Object.keys(p).forEach(function (k) { if (health[k] !== p[k]) { health[k] = p[k]; ch = true; } });
      if (!ch) return;
      var now = troubled(health);
      if (now && !was) { health.since = Date.now(); if (loaded) health.lastOk = Date.now(); }
      else if (!now) health.since = 0;
      var h = clone(health);
      healthL.slice().forEach(function (fn) { try { fn(h); } catch (e) { setTimeout(function () { throw e; }); } });
    }

    function colOf(p) { return p.slice(0, p.lastIndexOf("/")); }
    function isLoaded(c) { return loaded || !!colLoaded[c]; }
    function docSnap(p) {
      var d = cache[p];
      return { id: p.split("/").pop(), exists: d !== undefined, data: function () { return clone(d); },
        metadata: { fromCache: !isLoaded(colOf(p)), hasPendingWrites: !!ops[p] } };
    }
    function colSnap(c) {
      var docs = Object.keys(cache).filter(function (p) { return colOf(p) === c; }).sort().map(docSnap);
      return { docs: docs, size: docs.length, empty: !docs.length,
        metadata: { fromCache: !isLoaded(c), hasPendingWrites: false }, docChanges: function () { return []; } };
    }
    function mark(p) { dirty[p] = true; if (!flushT) flushT = setTimeout(flush, 0); }
    function flush() {
      flushT = null;
      var paths = Object.keys(dirty), cols = {};
      dirty = {};
      paths.forEach(function (p) {
        cols[colOf(p)] = true;
        (docL[p] || []).slice().forEach(function (fn) { try { fn(docSnap(p)); } catch (e) { setTimeout(function () { throw e; }); } });
      });
      Object.keys(cols).forEach(function (c) {
        (colL[c] || []).slice().forEach(function (fn) { try { fn(colSnap(c)); } catch (e) { setTimeout(function () { throw e; }); } });
      });
    }
    function markCol(c) {
      mark(c + "/_");
      Object.keys(docL).forEach(function (p) { if (colOf(p) === c) mark(p); });
    }
    function recompute(p) {
      var base = clone(server[p]);
      (ops[p] || []).forEach(function (op) {
        if (op.type === "set") base = clone(op.data);
        else if (op.type === "update") { if (base !== undefined) merge(base, op.patch); }
        else base = undefined;
      });
      if (base === undefined) delete cache[p]; else cache[p] = base;
      mark(p);
    }
    // fresh: a live event or the answer to our own write, newer than any load still under way.
    function takeRow(row, fresh) {
      if (!row || row.grp !== grp || typeof row.path !== "string") return;
      var p = row.path, t = Date.parse(row.updated_at) || 0;
      // Deleted after this version was written: a late live event or an older fetch cannot bring it back.
      if (tomb[p]) { if (t <= tomb[p].t) return; delete tomb[p]; }
      if (stamp[p] && t < stamp[p]) return;
      stamp[p] = t; server[p] = row.data;
      if (fresh) { recvAt[p] = Date.now(); delete deletedAt[p]; }
      recompute(p);
    }
    // deadT: the server's updated_at of the version that was deleted, when we know it (the answer
    // to our own delete; live DELETE events carry only the key). A delete of an older version than
    // the one we hold (it was put back since) is ignored.
    function dropRow(p, deadT) {
      if (deadT) {
        if (stamp[p] && stamp[p] > deadT) return;
        tomb[p] = { t: Math.max(deadT, tomb[p] ? tomb[p].t : 0), at: Date.now() };
      }
      deletedAt[p] = Date.now(); // also when we do not hold it yet: a load under way must not add it
      if (!(p in server) && !(p in cache)) return;
      delete server[p]; delete stamp[p];
      recompute(p);
    }
    // The answer to our own write. Sent before we heard of a delete: it cannot prove the document
    // still exists (if the write made it again, its live event brings it).
    function takeWrite(row, sentAt) {
      if (row && deletedAt[row.path] && deletedAt[row.path] > sentAt) return;
      takeRow(row, true);
    }
    function seenStamp(row) { var t = Date.parse(row && row.updated_at) || 0; if (t > syncedTo) syncedTo = t; }
    function pruneTombs() {
      var old = Date.now() - TOMB_MS;
      Object.keys(tomb).forEach(function (p) { if (tomb[p].at < old) delete tomb[p]; });
      [deletedAt, recvAt].forEach(function (m) { Object.keys(m).forEach(function (p) { if (m[p] < old) delete m[p]; }); });
    }

    function docsQuery(cols) { return sb.from("docs").select(cols).eq("grp", grp); }
    // Every row, in path order. Keeps asking until an empty or short page; the first short page is
    // checked once more, since the project may answer fewer rows than asked for.
    function allByPath(cols) {
      var rows = [];
      function page(after, probe) {
        var qb = docsQuery(cols);
        if (after !== null) qb = qb.gt("path", after);
        return qb.order("path").limit(PAGE).then(function (r) {
          if (r.error) throw r.error;
          var d = r.data || [];
          rows = rows.concat(d);
          if (!d.length) return rows;
          if (probe) cap = probe; // there was more after the short first page: that was the limit
          var last = d[d.length - 1].path;
          if (d.length >= cap) return page(last, 0);
          if (after === null && !probe) return page(last, d.length);
          return rows;
        });
      }
      return page(null, 0);
    }
    // An empty answer while we hold data is suspicious (it is what a lapsed login reads).
    // Only believe it when a second one, at least 5 s later, says the same.
    function suspectEmpty(n, began) {
      if (n || !Object.keys(server).length) { emptyAt = 0; return false; }
      if (emptyAt && began - emptyAt >= 5000) { emptyAt = 0; return false; }
      if (!emptyAt) emptyAt = began;
      later(5000, true);
      return true;
    }
    // Drop what the server no longer has, except what arrived live or was written since we asked.
    function dropUnseen(seen, began) {
      Object.keys(server).forEach(function (p) { if (!seen[p] && !(recvAt[p] && recvAt[p] > began)) dropRow(p); });
    }
    function takeAll(rows, began) {
      rows.forEach(function (row) {
        seenStamp(row);
        if (deletedAt[row.path] && deletedAt[row.path] > began) return;
        takeRow(row, false);
      });
    }
    function firstLoad(began) {
      return docsQuery(FULL).in("collection", ["members", "config"]).limit(PAGE).then(function (r) {
        if (r.error) throw r.error;
        takeAll(r.data || [], began);
        ["members", "config"].forEach(function (c) { if (!colLoaded[c]) { colLoaded[c] = true; markCol(c); } });
        return allByPath(FULL);
      }).then(function (all) {
        if (suspectEmpty(all.length, began)) throw { suspect: true };
        var seen = {};
        all.forEach(function (row) { seen[row.path] = true; });
        takeAll(all, began);
        dropUnseen(seen, began);
        lastDeep = Date.now();
        if (!loaded) {
          loaded = true;
          Object.keys(colL).forEach(markCol);
          Object.keys(docL).forEach(function (p) { mark(p); });
          waiters.splice(0).forEach(function (fn) { fn(); });
        }
      });
    }
    // What changed since the newest change we saw (with an overlap: a write can commit a little
    // after the time it was stamped with).
    function fetchChanged(began) {
      var rows = [];
      function page(from, n) {
        return docsQuery(FULL).gte("updated_at", from).order("updated_at").order("path").limit(PAGE).then(function (r) {
          if (r.error) throw r.error;
          var d = r.data || [], last = d.length ? d[d.length - 1].updated_at : from;
          rows = rows.concat(d);
          return d.length >= cap && n < 20 && last !== from ? page(last, n + 1) : rows;
        });
      }
      return page(new Date(Math.max(0, syncedTo - OVERLAP_MS)).toISOString(), 0).then(function (all) { takeAll(all, began); });
    }
    // Which documents exist (paths and stamps only): drops what is gone, fetches what we miss.
    function reconcile(began) {
      return allByPath("path,updated_at").then(function (list) {
        if (suspectEmpty(list.length, began)) throw { suspect: true };
        var seen = {}, need = [];
        list.forEach(function (r) {
          var p = r.path, t = Date.parse(r.updated_at) || 0;
          seen[p] = true;
          if ((deletedAt[p] && deletedAt[p] > began) || (tomb[p] && t <= tomb[p].t)) return;
          if (!(p in server) || (stamp[p] || 0) < t) need.push(p);
        });
        dropUnseen(seen, began);
        var chain = Promise.resolve();
        for (var i = 0; i < need.length; i += 50) (function (part) {
          chain = chain.then(function () {
            return docsQuery(FULL).in("path", part).then(function (r) { if (r.error) throw r.error; takeAll(r.data || [], began); });
          });
        })(need.slice(i, i + 50));
        return chain.then(function () { lastDeep = Date.now(); pruneTombs(); });
      });
    }
    function later(ms, deep) { clearTimeout(retryT); retryT = setTimeout(function () { refresh(deep); }, ms); }
    // One refresh at a time. Asked again meanwhile: once more right after. Every request has a time
    // limit (timedFetch), so a stalled one fails and never blocks the refreshes after it.
    function refresh(deep) {
      if (busy) { again = { deep: !!(deep || (again && again.deep)) }; return busy; }
      clearTimeout(retryT);
      var began = Date.now(), noLogin = false;
      busy = authed().then(null, function (e) { noLogin = true; throw e; }).then(function () {
        if (!loaded) return firstLoad(began);
        return fetchChanged(began).then(function () { if (deep || Date.now() - lastDeep > DEEP_MS) return reconcile(began); });
      }).then(function () {
        lastOk = Date.now(); setHealth({ ok: true, lastOk: lastOk });
      }, function (e) {
        if (e && e.suspect) return;
        setHealth({ ok: false });
        later(navigator.onLine === false ? 30000 : noLogin ? 5000 : loaded ? 8000 : 3000, deep);
      }).then(function () {
        busy = null;
        if (again) { var a = again; again = null; refresh(a.deep); }
      });
      return busy;
    }
    // Recent and the live channel is up: nothing to fetch.
    function fresh() { return health.live && health.ok && !health.offline && Date.now() - lastOk < 20000; }

    st.reload = function () { refresh(true); };
    sb.channel("docs-" + grp)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "docs", filter: "grp=eq." + grp }, function (pl) { takeRow(pl.new, true); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "docs", filter: "grp=eq." + grp }, function (pl) { takeRow(pl.new, true); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "docs" }, function (pl) {
        var o = pl.old || {};
        if (o.grp === grp && typeof o.path === "string") dropRow(o.path, Date.parse(o.updated_at) || 0);
      })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          // Back after a break: changes and deletes may have been missed meanwhile.
          var deep = wasDown && Date.now() - lastDeep > 60000;
          wasDown = false;
          setHealth({ live: true });
          refresh(deep);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          wasDown = true;
          setHealth({ live: false });
        }
      });
    setTimeout(function () { if (!loaded) refresh(false); }, 4000);
    setInterval(function () { if (document.visibilityState === "visible" && !fresh()) refresh(false); }, 60000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") { hiddenAt = Date.now(); return; }
      var away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away < 60000 && fresh()) return;
      refresh(away > 5 * 60000);
    });
    window.addEventListener("online", function () { setHealth({ offline: false }); refresh(false); });
    window.addEventListener("offline", function () { setHealth({ offline: true }); });

    function whenLoaded() { return loaded ? Promise.resolve() : new Promise(function (r) { waiters.push(r); }); }
    function pushOp(p, op) { (ops[p] || (ops[p] = [])).push(op); recompute(p); }
    function dropOp(p, op) {
      var a = ops[p]; if (!a) return;
      var i = a.indexOf(op); if (i >= 0) a.splice(i, 1);
      if (!a.length) delete ops[p];
    }
    function checkBody(data) {
      if (!isObj(data)) throw err("invalid_argument", "Een document moet een object zijn.");
      if (JSON.stringify(data).length > 250000) throw err("invalid_argument", "Document is te groot.");
    }
    function setDoc(p, data) {
      try { checkBody(data); } catch (e) { return Promise.reject(e); }
      var op = { type: "set", data: clone(data) }, sentAt = Date.now();
      pushOp(p, op);
      return authed().then(function () {
        return sb.from("docs").upsert({ grp: grp, path: p, collection: colOf(p), data: data }, { onConflict: "grp,path" })
          .select(FULL).single();
      }).then(function (r) {
        dropOp(p, op);
        if (r.error) { recompute(p); throw mapErr(r.error); }
        takeWrite(r.data, sentAt); recompute(p);
      }, function (e) { dropOp(p, op); recompute(p); throw mapErr(e); });
    }
    // Makes the document only when it is not there yet; never overwrites. Sending the same new
    // registration (or challenge, bet, plan) again after a lost answer therefore cannot double it,
    // and cannot wipe the proosts and comments it got meanwhile. Resolves { created: true/false }.
    function createDoc(p, data) {
      try { checkBody(data); } catch (e) { return Promise.reject(e); }
      if (server[p] !== undefined) return Promise.resolve({ created: false });
      var op = { type: "set", data: clone(data) }, sentAt = Date.now();
      pushOp(p, op);
      function gone(e) { dropOp(p, op); recompute(p); throw mapErr(e); }
      return authed().then(function () {
        return sb.from("docs").upsert({ grp: grp, path: p, collection: colOf(p), data: data }, { onConflict: "grp,path", ignoreDuplicates: true }).select(FULL);
      }).then(function (r) {
        if (r.error) gone(r.error);
        var row = r.data && r.data[0];
        if (row) { dropOp(p, op); takeWrite(row, sentAt); recompute(p); return { created: true }; }
        // It was there already (an earlier try arrived after all): show the real one.
        return docsQuery(FULL).eq("path", p).then(function (x) {
          dropOp(p, op);
          if (!x.error && x.data && x.data[0]) takeWrite(x.data[0], sentAt);
          recompute(p);
          return { created: false };
        }, function () { dropOp(p, op); recompute(p); return { created: false }; });
      }, gone);
    }
    function updateDoc(p, patch) {
      try { checkBody(patch); } catch (e) { return Promise.reject(e); }
      if (server[p] === undefined && !(ops[p] || []).some(function (o) { return o.type === "set"; }))
        return Promise.reject(err("not_found", "Dit bestaat niet meer."));
      var op = { type: "update", patch: clone(patch) }, sentAt = Date.now();
      pushOp(p, op);
      return authed().then(function () {
        return sb.rpc("doc_merge", { p_grp: grp, p_path: p, p_patch: patch });
      }).then(function (r) {
        dropOp(p, op);
        if (r.error) { recompute(p); throw mapErr(r.error); }
        var res = r.data || {};
        takeWrite({ grp: grp, path: p, data: res.data, updated_at: res.updated_at }, sentAt); recompute(p);
      }, function (e) { dropOp(p, op); recompute(p); throw mapErr(e); });
    }
    function deleteDoc(p) {
      var op = { type: "delete" };
      pushOp(p, op);
      return authed().then(function () {
        return sb.from("docs").delete().eq("grp", grp).eq("path", p).select("path,updated_at");
      }).then(function (r) {
        if (r.error) { dropOp(p, op); recompute(p); throw mapErr(r.error); }
        var gone = r.data && r.data[0];
        if (!gone && p in server) {
          // Nothing was deleted: check whether it is really gone, never report a delete that did not happen.
          return docsQuery("path").eq("path", p).then(function (x) {
            dropOp(p, op);
            if (!x.error && x.data && !x.data.length) { dropRow(p); return; }
            recompute(p); throw err("unavailable", "Verwijderen is niet gelukt.");
          }, function () { dropOp(p, op); recompute(p); throw err("unavailable", "Verwijderen is niet gelukt."); });
        }
        dropOp(p, op); dropRow(p, gone ? Date.parse(gone.updated_at) || 0 : 0);
      }, function (e) { dropOp(p, op); recompute(p); throw mapErr(e); });
    }

    function docRef(p) {
      return {
        id: p.split("/").pop(), path: p,
        get: function () { return whenLoaded().then(function () { return docSnap(p); }); },
        set: function (d) { return setDoc(p, d); },
        create: function (d) { return createDoc(p, d); },
        update: function (d) { return updateDoc(p, d); },
        delete: function () { return deleteDoc(p); },
        onSnapshot: function (next) {
          (docL[p] || (docL[p] = [])).push(next);
          if (isLoaded(colOf(p))) setTimeout(function () { next(docSnap(p)); }, 0);
          return function () { var a = docL[p] || [], i = a.indexOf(next); if (i >= 0) a.splice(i, 1); };
        },
        collection: function (c) { return colRef(p + "/" + c); }
      };
    }
    function colRef(c) {
      return {
        path: c,
        doc: function (id) { return docRef(c + "/" + (id || randId(20))); },
        add: function (d) { var r = docRef(c + "/" + randId(20)); return r.set(d).then(function () { return r; }); },
        onSnapshot: function (next) {
          (colL[c] || (colL[c] = [])).push(next);
          if (isLoaded(c)) setTimeout(function () { next(colSnap(c)); }, 0);
          return function () { var a = colL[c] || [], i = a.indexOf(next); if (i >= 0) a.splice(i, 1); };
        }
      };
    }
    return {
      doc: docRef, collection: colRef,
      // Sync state for the "Geen verbinding" line; fn gets a copy now and after every change.
      onStatus: function (fn) {
        healthL.push(fn);
        setTimeout(function () { fn(clone(health)); }, 0);
        return function () { var i = healthL.indexOf(fn); if (i >= 0) healthL.splice(i, 1); };
      }
    };
  }

  // ---------- photos ----------
  // No answer (bad reception, a request that hit its time limit) or a busy server: "unavailable",
  // worth trying again. Too big, wrong type or storage full: trying again will not help.
  function uploadErr(e) {
    var m = String((e && e.message) || ""), s = +((e && (e.status || e.statusCode)) || 0) || 0;
    if (!s && !(e && e.name === "StorageApiError")) return err("unavailable", m);
    if (s === 413 || /exceed|too large/i.test(m)) return err("too_large", m);
    if (s === 415 || /mime/i.test(m)) return err("unsupported_type", m);
    if (/quota/i.test(m)) return err("quota_or_state", m);
    if (s === 408 || s === 429 || s >= 500) return err("unavailable", m);
    return err("upstream_error", m);
  }
  function makeAssets() {
    var sb = st.sb, grp = st.grp;
    var ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    return {
      upload: function (blob, opts) {
        var type = (opts && opts.type) || blob.type || "image/jpeg";
        if (!ext[type]) return Promise.reject(err("unsupported_type"));
        if (blob.size > 10 * 1024 * 1024) return Promise.reject(err("too_large"));
        var path = grp + "/" + Date.now().toString(36) + "-" + randId(16) + "." + ext[type];
        return authed().then(function () {
          return sb.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
        }).then(function (r) {
          if (r.error) throw uploadErr(r.error);
          return { id: path, url: photoUrl(path), sizeBytes: blob.size, contentType: type };
        });
      },
      delete: function (id) {
        return sb.storage.from(BUCKET).remove([id]).then(function (r) {
          if (r.error) throw err("upstream_error", r.error.message);
          return { deleted: true };
        });
      }
    };
  }
  function photoUrl(id) {
    if (!st.sb) return "";
    return st.sb.storage.from(BUCKET).getPublicUrl(id).data.publicUrl;
  }

  // ---------- who is online ----------
  function makeRoom() {
    var sb = st.sb, me = {}, cbs = [], peers = [], joined = false;
    var tab = randId(10);
    var ch = sb.channel("room-" + st.grp, { config: { presence: { key: tab } } });
    function emit() {
      var state = ch.presenceState();
      peers = Object.keys(state).map(function (k) {
        var metas = state[k] || [];
        return { peer: k, presence: metas[0] || {}, isMe: k === tab, sameTab: k === tab };
      });
      cbs.forEach(function (cb) { try { cb({ peers: peers, joined: [], left: [], updated: [] }); } catch (e) {} });
    }
    ch.on("presence", { event: "sync" }, emit)
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") { joined = true; ch.track(me).catch(noop); }
      });
    return {
      presence: function (patch) {
        Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete me[k]; else me[k] = patch[k]; });
        return joined ? ch.track(me).then(noop, noop) : Promise.resolve();
      },
      onPeers: function (cb) { cbs.push(cb); setTimeout(function () { cb({ peers: peers, joined: [], left: [], updated: [] }); }, 0); return function () { var i = cbs.indexOf(cb); if (i >= 0) cbs.splice(i, 1); }; },
      peers: function () { return peers; }
    };
  }

  function namespaces() {
    if (st.ns) return st.ns;
    var uid = st.uid;
    watchAuth(st.sb);
    st.ns = {
      db: makeDb(),
      user: {
        id: function () { return Promise.resolve(uid); },
        can: function () { return Promise.resolve(true); },
        isOwner: function () { return Promise.resolve(false); },
        canEdit: function () { return Promise.resolve(false); }
      },
      assets: makeAssets(),
      room: makeRoom()
    };
    return st.ns;
  }

  window.backend = {
    configured: configured,
    start: start,
    join: join,
    parseCode: parseCode,
    pastUids: pastUids,
    joinMessage: function () { return st.joinMsg || ""; },
    use: function (name) {
      if (!st.grp) return Promise.resolve(null);
      return Promise.resolve(namespaces()[name] || null);
    },
    photoUrl: photoUrl,
    group: function () { return st.group; },
    inviteLink: inviteLink
  };
})();
