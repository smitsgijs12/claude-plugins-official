/* Turflijst backend: connects the app to Supabase.
 * Exposes window.backend with start(), join(code), use(name), photoUrl(id), group().
 * use("db") gives a small document store (collections of JSON documents, live updates),
 * use("user") the anonymous login, use("assets") photo storage, use("room") who is online. */
(function () {
  "use strict";

  var cfg = window.TURFLIJST_CONFIG || {};
  var CODE_KEY = "turflijst-code";
  var BUCKET = "photos";
  var st = { sb: null, uid: null, grp: null, group: null, ns: null };

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function safeDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function noop() {}
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
    if (e.code && typeof e.message === "string" && /^[a-z_]+$/.test(e.code) && !e.details && !e.hint && ["invalid_argument", "unavailable", "quota_exceeded", "not_found"].indexOf(e.code) >= 0) return e;
    var c = String(e.code || ""), m = String(e.message || "");
    if (c === "P0002") return err("not_found", m);
    if (c === "42501" || c === "23503" || c === "23514" || /row-level security|violates/i.test(m)) return err("invalid_argument", m);
    return err("unavailable", m);
  }

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && typeof window.supabase.createClient === "function");
  }

  // ---------- start & join ----------
  function start() {
    if (!configured()) return Promise.resolve({ error: "config" });
    st.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "turflijst-auth" }
    });
    var m = /(?:^#|[#&])join=([^&]+)/.exec(location.hash || "");
    if (m) {
      try { safeSet(CODE_KEY, decodeURIComponent(m[1])); } catch (e) {}
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
    return st.sb.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) return r.data.session;
      return st.sb.auth.signInAnonymously().then(function (x) {
        if (x.error) throw { auth: true, message: x.error.message };
        return x.data.session;
      });
    }).then(function (session) {
      st.uid = session.user.id;
      var code = safeGet(CODE_KEY);
      return (code ? joinWith(code) : Promise.resolve(false)).then(function (ok) {
        return ok ? { ok: true } : findExisting();
      });
    }).catch(function (e) {
      return { error: e && e.auth ? "auth" : "network", detail: e && e.message };
    });
  }
  function findExisting() {
    return st.sb.from("group_access").select("grp").eq("user_id", st.uid).limit(1).then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.length) return loadGroup(r.data[0].grp).then(function () { return { ok: true }; });
      return { needCode: true };
    });
  }
  function joinWith(code) {
    code = String(code || "").trim();
    if (!code) return Promise.resolve(false);
    return st.sb.rpc("join_group", { p_code: code }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data) { safeDel(CODE_KEY); return false; }
      safeSet(CODE_KEY, code);
      return loadGroup(r.data).then(function () { return true; });
    });
  }
  function loadGroup(g) {
    st.grp = g;
    return st.sb.from("groups").select("id,code,name").eq("id", g).maybeSingle().then(function (r) {
      st.group = (r && r.data) || { id: g, code: safeGet(CODE_KEY) || "", name: "Turflijst" };
    });
  }

  // ---------- documents ----------
  function makeDb() {
    var sb = st.sb, grp = st.grp;
    var server = {}, stamp = {}, ops = {}, cache = {}, recvAt = {}, deletedAt = {};
    var colL = {}, docL = {}, dirty = {}, flushT = null, loaded = false, loading = null, waiters = [];

    function colOf(p) { return p.slice(0, p.lastIndexOf("/")); }
    function docSnap(p) {
      var d = cache[p];
      return { id: p.split("/").pop(), exists: d !== undefined, data: function () { return clone(d); },
        metadata: { fromCache: !loaded, hasPendingWrites: !!ops[p] } };
    }
    function colSnap(c) {
      var docs = Object.keys(cache).filter(function (p) { return colOf(p) === c; }).sort().map(docSnap);
      return { docs: docs, size: docs.length, empty: !docs.length,
        metadata: { fromCache: !loaded, hasPendingWrites: false }, docChanges: function () { return []; } };
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
    function takeRow(row, fromLive) {
      if (!row || row.grp !== grp || typeof row.path !== "string") return;
      var t = Date.parse(row.updated_at) || 0;
      if (stamp[row.path] && t < stamp[row.path]) return;
      stamp[row.path] = t; server[row.path] = row.data;
      if (fromLive) { recvAt[row.path] = Date.now(); delete deletedAt[row.path]; }
      recompute(row.path);
    }
    function dropRow(p) {
      if (!(p in server) && !(p in cache)) return;
      delete server[p]; delete stamp[p]; deletedAt[p] = Date.now();
      recompute(p);
    }

    function fullLoad() {
      if (loading) return loading;
      var began = Date.now(), rows = [], size = 1000;
      function page(i) {
        return sb.from("docs").select("grp,path,data,updated_at").eq("grp", grp).order("path").range(i * size, i * size + size - 1).then(function (r) {
          if (r.error) throw r.error;
          rows = rows.concat(r.data || []);
          return (r.data || []).length === size ? page(i + 1) : rows;
        });
      }
      loading = page(0).then(function (all) {
        var seen = {};
        all.forEach(function (row) {
          seen[row.path] = true;
          if (deletedAt[row.path] && deletedAt[row.path] > began) return;
          takeRow(row, false);
        });
        Object.keys(server).forEach(function (p) {
          if (!seen[p] && !(recvAt[p] && recvAt[p] > began)) dropRow(p);
        });
        if (!loaded) {
          loaded = true;
          Object.keys(colL).forEach(function (c) { mark(c + "/_"); });
          Object.keys(docL).forEach(function (p) { mark(p); });
          waiters.splice(0).forEach(function (fn) { fn(); });
        }
      }).catch(function () {
        setTimeout(fullLoad, loaded ? 15000 : 3000);
      }).then(function () { loading = null; });
      return loading;
    }

    sb.channel("docs-" + grp)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "docs", filter: "grp=eq." + grp }, function (pl) { takeRow(pl.new, true); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "docs", filter: "grp=eq." + grp }, function (pl) { takeRow(pl.new, true); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "docs" }, function (pl) {
        var o = pl.old || {};
        if (o.grp === grp && typeof o.path === "string") dropRow(o.path);
      })
      .subscribe(function (status) { if (status === "SUBSCRIBED") fullLoad(); });
    setTimeout(function () { if (!loaded) fullLoad(); }, 4000);
    setInterval(function () { if (document.visibilityState === "visible") fullLoad(); }, 60000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") fullLoad(); });
    window.addEventListener("online", function () { fullLoad(); });

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
      var op = { type: "set", data: clone(data) };
      pushOp(p, op);
      return sb.from("docs").upsert({ grp: grp, path: p, collection: colOf(p), data: data }, { onConflict: "grp,path" })
        .select("grp,path,data,updated_at").single()
        .then(function (r) {
          dropOp(p, op);
          if (r.error) { recompute(p); throw mapErr(r.error); }
          delete deletedAt[p]; takeRow(r.data, false); recompute(p);
        }, function (e) { dropOp(p, op); recompute(p); throw mapErr(e); });
    }
    function updateDoc(p, patch) {
      try { checkBody(patch); } catch (e) { return Promise.reject(e); }
      if (server[p] === undefined && !(ops[p] || []).some(function (o) { return o.type === "set"; }))
        return Promise.reject(err("not_found", "Dit bestaat niet meer."));
      var op = { type: "update", patch: clone(patch) };
      pushOp(p, op);
      return sb.rpc("doc_merge", { p_grp: grp, p_path: p, p_patch: patch }).then(function (r) {
        dropOp(p, op);
        if (r.error) { recompute(p); throw mapErr(r.error); }
        var res = r.data || {};
        takeRow({ grp: grp, path: p, data: res.data, updated_at: res.updated_at }, false); recompute(p);
      }, function (e) { dropOp(p, op); recompute(p); throw mapErr(e); });
    }
    function deleteDoc(p) {
      var op = { type: "delete" };
      pushOp(p, op);
      return sb.from("docs").delete().eq("grp", grp).eq("path", p).then(function (r) {
        dropOp(p, op);
        if (r.error) { recompute(p); throw mapErr(r.error); }
        dropRow(p);
      }, function (e) { dropOp(p, op); recompute(p); throw mapErr(e); });
    }

    function docRef(p) {
      return {
        id: p.split("/").pop(), path: p,
        get: function () { return whenLoaded().then(function () { return docSnap(p); }); },
        set: function (d) { return setDoc(p, d); },
        update: function (d) { return updateDoc(p, d); },
        delete: function () { return deleteDoc(p); },
        onSnapshot: function (next) {
          (docL[p] || (docL[p] = [])).push(next);
          if (loaded) setTimeout(function () { next(docSnap(p)); }, 0);
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
          if (loaded) setTimeout(function () { next(colSnap(c)); }, 0);
          return function () { var a = colL[c] || [], i = a.indexOf(next); if (i >= 0) a.splice(i, 1); };
        }
      };
    }
    return { doc: docRef, collection: colRef };
  }

  // ---------- photos ----------
  function makeAssets() {
    var sb = st.sb, grp = st.grp;
    var ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    return {
      upload: function (blob, opts) {
        var type = (opts && opts.type) || blob.type || "image/jpeg";
        if (!ext[type]) return Promise.reject(err("unsupported_type"));
        if (blob.size > 10 * 1024 * 1024) return Promise.reject(err("too_large"));
        var path = grp + "/" + Date.now().toString(36) + "-" + randId(16) + "." + ext[type];
        return sb.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false }).then(function (r) {
          if (r.error) {
            var m = String(r.error.message || "");
            throw err(/exceed|too large|size/i.test(m) ? "too_large" : /mime|type/i.test(m) ? "unsupported_type" : /quota/i.test(m) ? "quota_or_state" : "upstream_error", m);
          }
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
    join: function (code) { return joinWith(code).catch(function () { return false; }); },
    use: function (name) {
      if (!st.grp) return Promise.resolve(null);
      return Promise.resolve(namespaces()[name] || null);
    },
    photoUrl: photoUrl,
    group: function () { return st.group; },
    inviteLink: function () {
      var code = (st.group && st.group.code) || safeGet(CODE_KEY) || "";
      return code ? location.origin + location.pathname + "#join=" + encodeURIComponent(code) : "";
    }
  };
})();
