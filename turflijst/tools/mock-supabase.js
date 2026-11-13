(function(){
  const chans = [];
  window.__rtPush = function(ev){ chans.forEach(function(ch){ ch._deliver(ev); }); };
  function uid(){ return sessionStorage.getItem('mock-uid'); }
  function call(obj){ return window.__srv(JSON.stringify(Object.assign({ uid: uid() }, obj))).then(JSON.parse); }
  function builder(table){
    const d = { table: table, op: 'select', filters: [], single: false, maybe: false };
    const b = {
      select: function(){ return b; }, eq: function(c, v){ d.filters.push([c, v]); return b; }, order: function(){ return b; },
      range: function(a, z){ d.range = [a, z]; return b; }, limit: function(n){ d.limit = n; return b; },
      maybeSingle: function(){ d.maybe = true; return b; }, single: function(){ d.single = true; return b; },
      upsert: function(row){ d.op = 'upsert'; d.row = row; return b; }, delete: function(){ d.op = 'delete'; return b; },
      then: function(res, rej){ return call({ kind: 'query', d: d }).then(res, rej); }
    };
    return b;
  }
  function createClient(){
    return {
      auth: {
        getSession: async function(){ return { data: { session: uid() ? { user: { id: uid() } } : null } }; },
        signInAnonymously: async function(){ const id = 'u-' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('mock-uid', id); return { data: { session: { user: { id: id } } }, error: null }; }
      },
      rpc: function(name, params){ return call({ kind: 'rpc', name: name, params: params }); },
      from: builder,
      channel: function(name, opts){
        const ch = { name: name, handlers: [], presenceCbs: [], state: {}, key: opts && opts.config && opts.config.presence && opts.config.presence.key,
          on: function(type, filter, cb){ if (type === 'presence') this.presenceCbs.push(cb); else this.handlers.push({ filter: filter, cb: cb }); return this; },
          subscribe: function(cb){ chans.push(this); setTimeout(function(){ cb && cb('SUBSCRIBED'); }, 30); return this; },
          presenceState: function(){ return this.state; },
          track: function(meta){ return call({ kind: 'track', room: this.name, key: this.key, meta: meta }).then(function(){ return 'ok'; }); },
          _deliver: function(ev){
            const self = this;
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
        upload: async function(path){ return { data: { path: path }, error: null }; },
        getPublicUrl: function(path){ return { data: { publicUrl: location.origin + '/mockphoto/' + path } }; },
        remove: async function(){ return { data: [], error: null }; }
      }; } }
    };
  }
  window.supabase = { createClient: createClient };
})();
