(function(){
  // Stand-in for vendor/supabase.js in tools/e2e.js --mock. The "server" lives in Node (window.__srv),
  // which can also simulate trouble: no network, a lost login, a request that never answers.
  // Offline (Playwright's setOffline) works like the real thing: requests fail at once, the live
  // channel reports CHANNEL_ERROR and misses events, and it comes back with SUBSCRIBED.
  const chans = [];
  let fetchImpl = null;
  window.__rtPush = function(ev){ if (navigator.onLine === false) return; chans.forEach(function(ch){ ch._deliver(ev); }); };
  window.addEventListener('offline', function(){ chans.forEach(function(ch){ ch._status('CHANNEL_ERROR'); }); });
  window.addEventListener('online', function(){ setTimeout(function(){ chans.forEach(function(ch){ ch._status('SUBSCRIBED'); }); }, 30); });
  let storageKey = 'turflijst-auth';
  function sess(){ try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (e) { return null; } }
  function uid(){ const s = sess(); return (s && s.user && s.user.id) || null; }
  // What supabase-js gives back when fetch itself fails (no network, or the time limit hit).
  function netFail(kind, msg){
    msg = msg || 'TypeError: Failed to fetch';
    if (kind === 'auth') return { error: { name: 'AuthRetryableFetchError', status: 0, message: msg } };
    if (kind === 'upload') return { error: { name: 'StorageUnknownError', message: msg } };
    return { data: null, error: { message: msg, details: '', hint: '', code: '' }, status: 0 };
  }
  function call(obj){
    // The stored login works offline; everything else needs the network.
    if (navigator.onLine === false && obj.kind !== 'auth') return Promise.resolve(netFail(obj.kind));
    return window.__srv(JSON.stringify(Object.assign({ uid: uid() }, obj))).then(JSON.parse)
      .then(function(r){
        if (!r || !r.hang) return r;
        // A request that never answers. It goes through the app's own fetch wrapper (as with the
        // real library), so the app's time limit is what ends it.
        if (!fetchImpl) return new Promise(function(){});
        return fetchImpl(location.origin + '/__hang', { method: 'POST' }).then(function(){ return new Promise(function(){}); },
          function(e){ return netFail(obj.kind, (e && e.name) + ': ' + (e && e.message)); });
      });
  }
  function builder(table){
    const d = { table: table, op: 'select', filters: [], cmp: [], orders: [], single: false, maybe: false, cols: null };
    const b = {
      select: function(cols){ d.cols = cols || '*'; return b; },
      eq: function(c, v){ d.filters.push([c, v]); return b; },
      gt: function(c, v){ d.cmp.push([c, 'gt', v]); return b; },
      gte: function(c, v){ d.cmp.push([c, 'gte', v]); return b; },
      in: function(c, v){ d.cmp.push([c, 'in', v]); return b; },
      order: function(c){ d.orders.push(c); return b; },
      range: function(a, z){ d.range = [a, z]; return b; }, limit: function(n){ d.limit = n; return b; },
      maybeSingle: function(){ d.maybe = true; return b; }, single: function(){ d.single = true; return b; },
      upsert: function(row, o){ d.op = 'upsert'; d.row = row; d.ignoreDup = !!(o && o.ignoreDuplicates); return b; },
      delete: function(){ d.op = 'delete'; return b; },
      then: function(res, rej){ return call({ kind: 'query', d: d }).then(res, rej); }
    };
    return b;
  }
  function createClient(url, key, opts){
    storageKey = (opts && opts.auth && opts.auth.storageKey) || storageKey;
    fetchImpl = (opts && opts.global && opts.global.fetch) || null;
    const authCbs = [];
    function emit(ev, s){ authCbs.forEach(function(cb){ try { cb(ev, s); } catch (e) {} }); }
    return {
      auth: {
        getSession: function(){
          return call({ kind: 'auth', op: 'session' }).then(function(r){
            if (r.error) return { data: { session: null }, error: r.error };
            return { data: { session: sess() }, error: null };
          });
        },
        signInAnonymously: function(){
          return call({ kind: 'auth', op: 'signup' }).then(function(r){
            if (r.error) return { data: { session: null, user: null }, error: r.error };
            const s = { user: { id: r.id } };
            localStorage.setItem(storageKey, JSON.stringify(s));
            emit('SIGNED_IN', s);
            return { data: { session: s, user: s.user }, error: null };
          });
        },
        onAuthStateChange: function(cb){ authCbs.push(cb); return { data: { subscription: { unsubscribe: function(){} } } }; },
        startAutoRefresh: async function(){}, stopAutoRefresh: async function(){}
      },
      rpc: function(name, params){ return call({ kind: 'rpc', name: name, params: params }); },
      from: builder,
      channel: function(name, opts){
        const ch = { name: name, handlers: [], presenceCbs: [], state: {}, cb: null, key: opts && opts.config && opts.config.presence && opts.config.presence.key,
          on: function(type, filter, cb){ if (type === 'presence') this.presenceCbs.push(cb); else this.handlers.push({ filter: filter, cb: cb }); return this; },
          subscribe: function(cb){ const self = this; self.cb = cb; chans.push(self); setTimeout(function(){ self._status(navigator.onLine === false ? 'CHANNEL_ERROR' : 'SUBSCRIBED'); }, 30); return self; },
          _status: function(s){ if (this.cb) this.cb(s); },
          presenceState: function(){ return this.state; },
          track: function(meta){ return call({ kind: 'track', room: this.name, key: this.key, meta: meta }).then(function(){ return 'ok'; }); },
          _deliver: function(ev){
            if (ev.type === 'presence') { if (ev.room === this.name) { this.state = ev.state; this.presenceCbs.forEach(function(cb){ cb(); }); } return; }
            this.handlers.forEach(function(h){
              if (h.filter.event !== ev.eventType) return;
              if (h.filter.filter) { const p = h.filter.filter.split('=eq.'); const row = ev.new || ev.old; if (!row || row[p[0]] !== p[1]) return; }
              h.cb(ev);
            });
          } };
        return ch;
      },
      storage: { from: function(){ return {
        upload: function(path){ return call({ kind: 'upload', path: path }).then(function(r){ return r && r.error ? { data: null, error: r.error } : { data: { path: path }, error: null }; }); },
        getPublicUrl: function(path){ return { data: { publicUrl: location.origin + '/mockphoto/' + path } }; },
        remove: async function(){ return { data: [], error: null }; }
      }; } }
    };
  }
  window.supabase = { createClient: createClient };
})();
