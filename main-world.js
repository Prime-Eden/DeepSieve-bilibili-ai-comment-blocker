/* 运行在页面主世界，两个职责：
 * 1) 读取 B 站评论 Web Component 上的 .data，postMessage 给插件（隔离世界）——原版逻辑
 * 2) 方案 B：拦截评论接口（fetch / XMLHttpRequest），把屏蔽名单、自定义屏蔽词命中的评论
 *    在数据进入渲染前直接删掉（零闪烁），命中数回传给计数条
 *    拦截规则由隔离世界经 postMessage 下发，并用 localStorage 快照让新页面一打开就生效 */
(function () {
  if (window.__dfyMainWorld) return;
  window.__dfyMainWorld = true;

  const ATTR = 'data-dfy-rpid';

  /* ================= 职责 1：评论数据提取（原版逻辑） ================= */

  function pick(d, isReply) {
    const m = d.member || {};
    return {
      rpid: String(d.rpid_str || d.rpid),
      root: String(d.root_str || d.root || 0),
      mid: String(m.mid || d.mid_str || d.mid),
      uname: m.uname || '',
      avatar: m.avatar || '',
      sign: m.sign || '',
      level: (m.level_info && m.level_info.current_level) || 0,
      verify: m.official_verify ? m.official_verify.type : -1,
      vip: (m.vip && m.vip.vipStatus) || 0,
      text: (d.content && d.content.message) || '',
      ctime: d.ctime || 0,
      like: d.like || 0,
      rcount: +d.rcount || 0, // 一级评论的楼中楼总数（整楼隐藏时计数用）
      isReply: !!isReply,
    };
  }

  function upMid() {
    try {
      const s = window.__INITIAL_STATE__;
      return String(
        (s && ((s.videoData && s.videoData.owner && s.videoData.owner.mid) || (s.upInfo && s.upInfo.mid) || (s.mediaInfo && s.mediaInfo.up_info && s.mediaInfo.up_info.mid))) || ''
      );
    } catch (e) {
      return '';
    }
  }

  /** 视频标题/简介：供隔离世界判定「AI 话题视频」并调整识别权重 */
  function videoInfo() {
    try {
      const v = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData;
      if (!v) return null;
      return { title: v.title || '', desc: v.desc || '' };
    } catch (e) {
      return null;
    }
  }

  function scan() {
    const out = [];
    const hosts = document.querySelectorAll('bili-comments');
    for (const bc of hosts) {
      const root = bc.shadowRoot;
      if (!root) continue;
      for (const th of root.querySelectorAll('bili-comment-thread-renderer')) {
        visit(th, false, out);
        const rep = th.shadowRoot && th.shadowRoot.querySelector('bili-comment-replies-renderer');
        if (rep && rep.shadowRoot) {
          for (const r of rep.shadowRoot.querySelectorAll('bili-comment-reply-renderer')) visit(r, true, out);
        }
      }
    }
    if (out.length) window.postMessage({ source: 'dfy-main', type: 'comments', items: out, upMid: upMid(), video: videoInfo() }, '*');
  }

  function visit(el, isReply, out) {
    const d = el.data;
    if (!d || !d.member) return;
    const id = String(d.rpid_str || d.rpid);
    if (el.getAttribute(ATTR) === id) return;
    el.setAttribute(ATTR, id);
    out.push(pick(d, isReply));
  }

  let timer = 0;
  function schedule(delay = 250) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      try {
        scan();
      } catch (e) {}
    }, delay);
  }
  setInterval(schedule, 1500);

  // 评论组件一挂载 / 一更新就立刻扫描，不用等轮询。
  // wrapped 里做「预隐藏」：隔离世界已判定为鱼且经 pre-scan 同步过来的账号，
  // 在 connectedCallback 内（绘制前）直接 display:none —— 新鱼首屏也零闪烁。
  // 记账（计数/回收站）统一由隔离世界的 doRender 依 data-dfy-pre 属性补录，这里保持沉默。
  const fast = () => schedule(40);
  function preHide(el) {
    if (!RULES.on || !fishSet.size) return;
    if (el.hasAttribute(ATTR)) return; // visit 已处理过
    const d = el.data;
    if (!d || !d.member) return;
    const mid = String(d.member.mid || d.mid_str || d.mid || '');
    if (!fishSet.has(mid)) return;
    const id = String(d.rpid_str || d.rpid);
    el.setAttribute(ATTR, id); // 让隔离世界的 items/accounts 能对上（scan 会因此跳过，数据走 pre-scan）
    el.setAttribute('data-dfy-pre', '1');
    el.style.display = 'none';
  }
  for (const tag of ['bili-comment-thread-renderer', 'bili-comment-reply-renderer', 'bili-comment-renderer']) {
    customElements.whenDefined(tag).then(() => {
      const proto = customElements.get(tag).prototype;
      for (const fn of ['connectedCallback', 'updated']) {
        const orig = proto[fn];
        if (typeof orig !== 'function' || orig.__dfy) continue;
        const wrapped = function () {
          const r = orig.apply(this, arguments);
          try {
            preHide(this);
          } catch (e) {}
          fast();
          return r;
        };
        wrapped.__dfy = true;
        proto[fn] = wrapped;
      }
    });
  }
  document.addEventListener('scroll', schedule, { passive: true, capture: true });

  function clearAttrs() {
    for (const bc of document.querySelectorAll('bili-comments')) {
      if (!bc.shadowRoot) continue;
      for (const el of bc.shadowRoot.querySelectorAll('bili-comment-thread-renderer')) {
        el.removeAttribute(ATTR);
        const rep = el.shadowRoot && el.shadowRoot.querySelector('bili-comment-replies-renderer');
        if (rep && rep.shadowRoot) for (const r of rep.shadowRoot.querySelectorAll('bili-comment-reply-renderer')) r.removeAttribute(ATTR);
      }
    }
  }

  /* ================= 职责 2：接口层拦截（融合自 blocker，MIT） ================= */

  const LS_KEY = 'dfy-rules-v1';
  const RULES = { on: false, block: new Set(), white: new Set(), re: null, policy: 'fish' };
  let fishSet = new Set(); // 隔离世界判定为鱼的 mid 集合（预隐藏用）

  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\/|-]/g, '\\$&');

  function applyRules(j) {
    j = j || {};
    RULES.on = !!j.e; // 插件总开关
    RULES.block = new Set((j.b || []).map(String));
    RULES.white = new Set((j.w || []).map(String));
    RULES.policy = j.p === 'thread' || j.p === 'ignore' ? j.p : 'fish';
    if (Array.isArray(j.words) && j.words.length) {
      try {
        RULES.re = new RegExp(j.words.map(escapeRe).join('|'), 'i');
      } catch (e) {
        RULES.re = null;
      }
    } else RULES.re = null;
  }

  // 新页面打开时先吃 localStorage 快照（隔离世界在每次规则变化时写入），老名单零闪烁
  try {
    applyRules(JSON.parse(localStorage.getItem(LS_KEY) || 'null'));
  } catch (e) {}

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'dfy-iso') return;
    if (e.data.type === 'rescan') {
      clearAttrs();
      schedule();
    } else if (e.data.type === 'rules') {
      applyRules(e.data.rules);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(e.data.rules));
      } catch (err) {}
      clearAttrs();
      schedule();
    } else if (e.data.type === 'verdicts') {
      // 隔离世界同步来的判定结果：主世界据此在挂载回调里预隐藏
      fishSet = new Set((e.data.f || []).map(String));
    } else if (e.data.type === 'ready') {
      // 内容脚本就绪：回放它在加载完成前错过的拦截事件（首屏请求早于 document_idle 的场景）
      isoReady = true;
      while (pendingEarly.length) window.postMessage(pendingEarly.shift(), '*');
    }
  });

  /* ---- 早期事件缓冲：document_idle 前发生的拦截，等隔离世界 ready 后回放 ---- */
  const pendingEarly = [];
  let isoReady = false;
  function emitEarly(payload) {
    if (isoReady) return window.postMessage(payload, '*');
    if (pendingEarly.length < 60) pendingEarly.push(payload);
  }

  /* ---- 接口识别 ---- */

  function apiKind(url) {
    if (!url || url.indexOf('/x/v2/reply') === -1) return 0;
    if (url.indexOf('/x/v2/reply/reply') !== -1) return 2; // 楼中楼
    if (url.indexOf('/x/v2/reply/wbi/main') !== -1 || url.indexOf('/x/v2/reply/main') !== -1 || url.indexOf('/x/v2/reply?') !== -1) return 1; // 一级
    return 0; // add / del / action / subject / report 等一律跳过
  }

  function isFirstPageReq(url) {
    if (!url) return false;
    let u = url;
    try {
      u = decodeURIComponent(url);
    } catch (e) {}
    if (u.indexOf('pagination_str') !== -1) return u.indexOf('"offset":""') !== -1;
    if (!/[?&]next=/.test(u) && !/[?&]pn=/.test(u)) return true;
    return /[?&]next=0(&|$)/.test(u) || /[?&]pn=1(&|$)/.test(u);
  }

  const midOf = (r) => String((r && r.member && (r.member.mid || r.member.mid_str)) || (r && r.mid) || '');
  const nameOf = (r) => (r && r.member && (r.member.uname || r.member.name)) || '';
  const textOf = (r) => {
    const c = r && r.content;
    return c && typeof c.message === 'string' ? c.message : '';
  };
  const snapOf = (r) => ({ id: String((r && (r.rpid_str || r.rpid)) || ''), m: midOf(r), n: nameOf(r), x: textOf(r).slice(0, 60) });

  /** 白名单豁免；屏蔽名单 mid 或自定义屏蔽词命中 → 拦 */
  function hit(r) {
    const mid = midOf(r);
    if (RULES.white.has(mid)) return false;
    if (RULES.block.has(mid)) return true;
    return !!(RULES.re && RULES.re.test(textOf(r)));
  }

  /* ---- 计数去重（接口层删掉的，DOM 层不会再看到，不会重复计数） ---- */
  const countedApi = Object.create(null);
  let countedN = 0;
  const COUNT_CAP = 50000;
  function take(id, ids) {
    if (id == null) return;
    const k = String(id);
    if (countedApi[k] || countedN >= COUNT_CAP) return;
    countedApi[k] = 1;
    countedN++;
    ids.push(k);
  }

  /**
   * 过滤一份接口数据，返回 {roots, replies, ids} 或 null（不用管）。
   * 一级评论命中 → 整楼从数据里消失（数据层无法"删主楼留楼中楼"）；
   * 楼中楼：fish 策略只删命中预览并修正 rcount；thread 策略整楼消失；ignore 不碰。
   */
  function filterPayload(json, kind) {
    if (!RULES.on) return null; // 插件停用：接口数据原样放行
    const data = json && json.data;
    if (!data) return null;
    let roots = 0, replies = 0;
    const ids = [];
    const items = []; // 回收站快照（谁被拦了），回传给隔离世界

    if (kind === 2) {
      if (RULES.policy === 'ignore') return null;
      const list = data.replies;
      if (!list || !list.length) return null;
      const kept = [];
      for (const r of list) {
        if (hit(r)) {
          replies++;
          take(r && r.rpid, ids);
          items.push(snapOf(r));
          continue;
        }
        kept.push(r);
      }
      if (!replies) return null;
      data.replies = kept;
      return { roots, replies, ids, items };
    }

    const list = data.replies;
    if (!list || !list.length) return null;

    // 置顶评论不处理
    const pinned = Object.create(null);
    const tops = data.top_replies;
    if (tops && tops.length) for (const t of tops) if (t && t.rpid != null) pinned[t.rpid] = 1;
    if (data.top && data.top.upper && data.top.upper.rpid != null) pinned[data.top.upper.rpid] = 1;

    const kept = [];
    for (const c of list) {
      if (c && pinned[c.rpid]) {
        kept.push(c);
        continue;
      }
      const kids = (c && c.replies) || [];
      if (hit(c)) {
        roots++;
        take(c && c.rpid, ids);
        items.push(snapOf(c));
        for (const k of kids) if (k && k.rpid != null) take(k.rpid, ids); // 预览楼中楼一并带走
        continue;
      }
      if (kids.length && RULES.policy !== 'ignore') {
        const keptKids = [];
        let kidHits = 0;
        for (const k of kids) {
          if (hit(k)) {
            kidHits++;
            replies++;
            take(k && k.rpid, ids);
            items.push(snapOf(k));
            continue;
          }
          keptKids.push(k);
        }
        if (RULES.policy === 'thread' && kidHits) {
          roots++;
          take(c && c.rpid, ids);
          items.push(snapOf(c));
          for (const k of kids) if (k && k.rpid != null) take(k.rpid, ids);
          continue;
        }
        if (kidHits && RULES.policy === 'fish') {
          c.replies = keptKids;
          if (c.rcount) c.rcount = Math.max(0, c.rcount - kidHits); // 「共 N 条回复」跟着减，防空楼
        }
      }
      kept.push(c);
    }

    if (!roots && !replies) return null;
    if (roots) data.replies = kept;
    return { roots, replies, ids, items };
  }

  /** 不做删改，只把响应里的评论原始数据摘出来，赶在页面渲染前送识别引擎同步打分 */
  function scanPayload(json, kind) {
    try {
      const data = json && json.data;
      if (!data) return [];
      const out = [];
      if (kind === 2) {
        for (const r of data.replies || []) out.push(pick(r, true));
        return out;
      }
      for (const c of data.replies || []) {
        out.push(pick(c, false));
        for (const k of (c && c.replies) || []) out.push(pick(k, true));
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  /* ---- fetch 拦截 ---- */

  const RESP_KEYS = ['type', 'url', 'redirected'];

  function cloneRes(res, text) {
    const headers = new Headers(res.headers);
    try {
      headers.delete('content-length');
    } catch (e) {}
    try {
      headers.delete('content-encoding');
    } catch (e) {}
    const init = { status: res.status, statusText: res.statusText, headers };
    const out = new Response(text, init);
    for (const k of RESP_KEYS) {
      try {
        Object.defineProperty(out, k, { configurable: true, get: () => res[k] });
      } catch (e) {}
    }
    return out;
  }

  function hookFetch() {
    const raw = window.fetch;
    if (typeof raw !== 'function' || raw.__dfy) return;
    const wrapped = function (input) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const kind = apiKind(url);
      const promise = raw.apply(this, arguments);
      if (!kind) return promise;
      const first = kind === 1 && isFirstPageReq(url);
      return promise.then((res) => {
        if (!res || !res.ok) return res;
        return res
          .clone()
          .text()
          .then((txt) => {
            let json;
            try {
              json = JSON.parse(txt);
            } catch (e) {
              return res;
            }
            let f = null;
            try {
              f = filterPayload(json, kind);
            } catch (e) {
              return res;
            }
            if (first) emitEarly({ source: 'dfy-main', type: 'api-first' });
            // 判定前置：渲染前把数据送识别引擎（响应体此刻刚被我们换掉，页面还没渲染）
            const scan = scanPayload(json, kind);
            if (scan.length) window.postMessage({ source: 'dfy-main', type: 'pre-scan', items: scan.slice(0, 80), upMid: upMid(), video: videoInfo() }, '*');
            if (!f || (!f.roots && !f.replies)) return res;
            let out;
            try {
              out = cloneRes(res, JSON.stringify(json));
            } catch (e) {
              return res; // 复刻失败原样放行：评论闪现，DOM 层兜底
            }
            emitEarly({ source: 'dfy-main', type: 'api-blocked', roots: f.roots, replies: f.replies, items: (f.items || []).slice(0, 20) });
            return out;
          })
          .catch(() => res);
      });
    };
    wrapped.__dfy = 1;
    window.fetch = wrapped;
  }

  /* ---- XHR 拦截：send() 里立刻在实例上覆盖 responseText/response 的 getter，
     不等 readystatechange，避免页面监听器注册顺序竞态（blocker 踩过的坑） ---- */

  function hookXHR() {
    const XHR = window.XMLHttpRequest;
    if (!XHR || XHR.__dfy) return;
    const proto = XHR.prototype;
    let dText = null, dResp = null;
    try {
      dText = Object.getOwnPropertyDescriptor(proto, 'responseText');
      dResp = Object.getOwnPropertyDescriptor(proto, 'response');
    } catch (e) {}
    if (!dText || !dText.get || !dResp || !dResp.get) return;
    const getText = dText.get;
    const getResp = dResp.get;

    function once(xhr) {
      if (xhr.__dfyDone) return xhr.__dfyCache;
      if (xhr.readyState !== 4) return null;
      if (!xhr.__dfyKind) return null;
      if (xhr.status < 200 || xhr.status >= 300) {
        xhr.__dfyDone = 1;
        return (xhr.__dfyCache = null);
      }
      xhr.__dfyDone = 1;
      let r = null;
      try {
        const rt = xhr.responseType;
        const isJson = rt === 'json';
        if (!isJson && rt !== '' && rt !== 'text') return (xhr.__dfyCache = null);
        const rawBody = isJson ? getResp.call(xhr) : getText.call(xhr);
        if (!rawBody) return (xhr.__dfyCache = null);
        const obj = isJson ? rawBody : JSON.parse(rawBody);
        const scan = scanPayload(obj, xhr.__dfyKind);
        if (scan.length) window.postMessage({ source: 'dfy-main', type: 'pre-scan', items: scan.slice(0, 80), upMid: upMid(), video: videoInfo() }, '*');
        const f = filterPayload(obj, xhr.__dfyKind);
        if (xhr.__dfyFirst) emitEarly({ source: 'dfy-main', type: 'api-first' });
        if (!f || (!f.roots && !f.replies)) return (xhr.__dfyCache = null);
        // XHR 路径的命中数与回收站快照也要回传
        emitEarly({ source: 'dfy-main', type: 'api-blocked', roots: f.roots, replies: f.replies, items: (f.items || []).slice(0, 20) });
        r = { out: isJson ? obj : JSON.stringify(obj), roots: f.roots, replies: f.replies };
      } catch (err) {
        r = null;
      }
      return (xhr.__dfyCache = r);
    }

    const open = proto.open;
    proto.open = function (m, url) {
      this.__dfyKind = apiKind(url);
      this.__dfyFirst = this.__dfyKind === 1 && isFirstPageReq(url);
      this.__dfyDone = 0; // 实例会被连接池复用，每次 open 都要重置
      this.__dfyCache = null;
      return open.apply(this, arguments);
    };
    const send = proto.send;
    proto.send = function () {
      const xhr = this;
      if (xhr.__dfyKind) {
        try {
          Object.defineProperty(xhr, 'responseText', {
            configurable: true,
            get: () => {
              if (xhr.responseType === 'json') return getText.call(xhr); // 原生就该抛
              const r = once(xhr);
              return r ? r.out : getText.call(xhr);
            },
          });
          Object.defineProperty(xhr, 'response', {
            configurable: true,
            get: () => {
              const r = once(xhr);
              return r ? r.out : getResp.call(xhr);
            },
          });
        } catch (e) {}
      }
      return send.apply(this, arguments);
    };
    XHR.__dfy = 1;
  }

  hookFetch();
  hookXHR();
})();
