/* 本地存储：设置、名单、前科、精判缓存（全部只存在本机）
 * 清净版：删掉 weapon/showMascot/sound/mascotPos/customMascot；
 * 新增 subPolicy（楼中楼策略）、showCount（计数条）、customWords（自定义屏蔽词）。
 * 名单键名与原版完全一致，导出 JSON 可直接互导。 */
(function () {
  const DFY = (globalThis.DFY = globalThis.DFY || {});

  DFY.DEFAULTS = {
    settings: {
      enabled: true,
      threshold: 60, // 大于等于此分数判定为大肥鱼，命中即隐藏
      subPolicy: 'fish', // 楼中楼策略：fish 只隐藏该账号的评论 | thread 楼里有大肥鱼就整楼隐藏 | ignore 只处理一级评论
      showCount: true, // 评论区顶部显示「已清 N 条」
      showBubble: false, // 显示悬浮球（手动菜单入口，默认关闭保持无感）
      llmEnabled: false,
      llmKey: '',
      llmModel: 'deepseek-flash',
      llmAuto: true, // 自动精判可疑账号
      llmVision: true, // 让 DeepSeek 看头像
    },
    customWords: [], // 自定义屏蔽词：评论命中任意一个词，该账号直接判为大肥鱼
    stats: { total: 0, today: 0, day: '', llmCalls: 0, verdicts: 0 },
    blocklist: {}, // mid -> {n, a, t, s}
    whitelist: {}, // mid -> {n, t}
    seen: {}, // 前科记忆：mid -> {n, c, k, t}
    llmCache: {}, // DeepSeek 精判缓存：mid -> {ai, r, t}
    bubblePos: null, // 悬浮控制台位置（视口比例，拖动后记忆）
    bubbleHinted: false, // 首次显示悬浮台时的一次性提示是否已出过
    removedLog: [], // 隐藏总记录（跨页面跨会话持久化，上限 2000 条，新的挤掉旧的）
    importLog: [], // 导入历史（名单页底部展示，上限 50 条）
    manualStats: {}, // 人工拉黑特征计数：tag -> 次数（判定强化的反馈回路，上限 200 个标签）
  };

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const LS = 'dfy-store-';

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  DFY.store = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      let raw = {};
      if (hasChrome) raw = await chrome.storage.local.get(list);
      else for (const k of list) {
        try {
          const v = localStorage.getItem(LS + k);
          if (v != null) raw[k] = JSON.parse(v);
        } catch (e) {}
      }
      const out = {};
      for (const k of list) {
        const def = DFY.DEFAULTS[k];
        const v = raw[k];
        out[k] = def && typeof def === 'object' && !Array.isArray(def) && v && typeof v === 'object' ? Object.assign(clone(def), v) : v != null ? v : clone(def);
      }
      return Array.isArray(keys) ? out : out[keys];
    },
    async set(obj) {
      if (hasChrome) return chrome.storage.local.set(obj);
      for (const k in obj) {
        try {
          localStorage.setItem(LS + k, JSON.stringify(obj[k]));
        } catch (e) {}
      }
      DFY.store._emit(obj);
    },
    async patch(key, fn) {
      const v = await DFY.store.get(key);
      const nv = fn(v) || v;
      await DFY.store.set({ [key]: nv });
      return nv;
    },
    _subs: [],
    onChange(fn) {
      DFY.store._subs.push(fn);
    },
    _emit(changes) {
      for (const fn of DFY.store._subs) fn(changes);
    },
  };

  if (hasChrome && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const obj = {};
      for (const k in changes) obj[k] = changes[k].newValue;
      DFY.store._emit(obj);
    });
  }

  /** 计数器（精判调用数、鉴定次数等小统计） */
  DFY.bump = async function (field, n = 1) {
    return DFY.store.patch('stats', (s) => {
      s[field] = (s[field] || 0) + n;
    });
  };

  /*
   * 跨页面记忆：同一账号在多个视频下都被认出是大肥鱼 → 下次直接加分；DeepSeek 精判结果缓存 7 天，省 Token。
   * 多个标签页同时写时，只把本页新增的条目合并进去，不整体覆盖。
   */
  const SEEN_MAX = 6000, LLM_MAX = 3000, LLM_TTL = 7 * 86400000;
  const prune = (obj, max) => {
    const ks = Object.keys(obj);
    if (ks.length <= max) return obj;
    ks.sort((a, b) => obj[b].t - obj[a].t);
    for (const k of ks.slice(max)) delete obj[k];
    return obj;
  };
  DFY.memory = {
    seen: {},
    llm: {},
    pending: { seen: {}, llm: {} },
    timer: 0,
    async load() {
      const r = await DFY.store.get(['seen', 'llmCache']);
      this.seen = r.seen || {};
      this.llm = r.llmCache || {};
    },
    page() {
      const m = location.pathname.match(/BV\w{10}|av\d+|ep\d+|ss\d+|\/(\d{3,})/i);
      return m ? m[1] || m[0] : location.pathname;
    },
    /** 在当前页面以外，被认出是大肥鱼的页面数 */
    prior(mid) {
      const s = this.seen[mid];
      if (!s) return 0;
      return Math.max(0, s.c - (s.k.includes(this.page()) ? 1 : 0));
    },
    mark(mid, name) {
      const pg = this.page();
      const s = this.seen[mid] || { n: name, c: 0, k: [], t: 0 };
      if (s.k.includes(pg)) return;
      s.c++;
      s.k = [pg, ...s.k].slice(0, 6);
      s.n = name || s.n;
      s.t = Date.now();
      this.seen[mid] = s;
      this.pending.seen[mid] = s;
      this.save();
    },
    llmGet(mid) {
      const c = this.llm[mid];
      return c && Date.now() - c.t < LLM_TTL ? c : null;
    },
    llmPut(mid, ai, r) {
      const c = { ai, r: String(r || '').slice(0, 60), t: Date.now() };
      this.llm[mid] = c;
      this.pending.llm[mid] = c;
      this.save();
    },
    save() {
      clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        const { seen: ps, llm: pl } = this.pending;
        this.pending = { seen: {}, llm: {} };
        const cur = await DFY.store.get(['seen', 'llmCache']);
        for (const [mid, s] of Object.entries(ps)) {
          const old = cur.seen[mid];
          if (old) {
            const k = [...new Set([...s.k, ...old.k])].slice(0, 6);
            s.c = Math.max(s.c, old.c, k.length);
            s.k = k;
          }
          cur.seen[mid] = s;
        }
        Object.assign(cur.llmCache, pl);
        for (const [k, v] of Object.entries(cur.llmCache)) if (Date.now() - v.t > LLM_TTL) delete cur.llmCache[k];
        this.seen = prune(cur.seen, SEEN_MAX);
        this.llm = prune(cur.llmCache, LLM_MAX);
        await DFY.store.set({ seen: this.seen, llmCache: this.llm });
      }, 2000);
    },
  };

})();
