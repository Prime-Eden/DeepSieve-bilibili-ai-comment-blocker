/* 入口：读设置、接住主世界数据、路由监听（清净版：不挂任何页面 UI，空间页除外） */
(async function () {
  const DFY = globalThis.DFY;
  if (DFY.booted) return;
  DFY.booted = true;

  const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  DFY.canLLM = !!hasRuntime;
  DFY.callBg = function (msg) {
    if (!hasRuntime) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  };

  const [st] = await Promise.all([DFY.store.get(['settings', 'blocklist', 'whitelist', 'customWords', 'manualStats']), DFY.memory.load()]);
  DFY.settings = st.settings;
  DFY.lists = { block: st.blocklist, white: st.whitelist };
  DFY.customWords = st.customWords || [];
  DFY.compileWords(DFY.customWords);
  DFY.manualStats = st.manualStats || {}; // 人工拉黑特征计数：判定引擎的强化反馈

  if (window.top !== window) return;

  /* 拦截规则下发（主世界）+ localStorage 快照（下次打开页面立即生效，老名单零闪烁） */
  function broadcastRules() {
    try {
      window.postMessage({
        source: 'dfy-iso',
        type: 'rules',
        rules: { e: !!DFY.settings.enabled, b: Object.keys(DFY.lists.block || {}), w: Object.keys(DFY.lists.white || {}), words: DFY.customWords || [], p: (DFY.settings && DFY.settings.subPolicy) || 'fish' },
      }, '*');
    } catch (e) {}
  }
  broadcastRules();
  DFY.bubble.sync();
  // 通知主世界：内容脚本已就绪，回放它在加载完成前缓冲的拦截事件（首屏早于 document_idle 的场景）
  window.postMessage({ source: 'dfy-iso', type: 'ready' }, '*');

  DFY.store.onChange((ch) => {
    if (ch.settings) {
      const prev = DFY.settings;
      DFY.settings = Object.assign({}, DFY.DEFAULTS.settings, ch.settings);
      const needJudge = prev.threshold !== DFY.settings.threshold || prev.subPolicy !== DFY.settings.subPolicy || prev.llmEnabled !== DFY.settings.llmEnabled || prev.enabled !== DFY.settings.enabled;
      if (!DFY.settings.enabled) DFY.comments.showAll();
      else if (needJudge) DFY.comments.rejudgeAll();
      else DFY.comments.render();
      DFY.bubble.sync(); // 只有设置变化才需要同步悬浮台可见性——名单写入等高频变更不再打扰菜单
    }
    if (ch.customWords) {
      DFY.customWords = ch.customWords || [];
      DFY.compileWords(DFY.customWords);
      DFY.comments.rejudgeAll();
    }
    if (ch.blocklist) DFY.lists.block = ch.blocklist || {};
    if (ch.whitelist) DFY.lists.white = ch.whitelist || {};
    if (ch.manualStats) DFY.manualStats = ch.manualStats || {};
    if ('seen' in ch) DFY.memory.seen = ch.seen || {};
    if ('llmCache' in ch) DFY.memory.llm = ch.llmCache || {};
    if (ch.blocklist || ch.whitelist) DFY.comments.rejudgeAll();
    broadcastRules(); // 规则变更仍需每次广播给主世界拦截层；悬浮台可见性只在设置变化时同步（见上）
  });

  // popup / 快捷键
  if (hasRuntime)
    chrome.runtime.onMessage.addListener((msg, sender, send) => {
      if (!msg || !msg.dfy) return;
      const C = DFY.comments;
      const isSpace = () => !!DFY.space.midFromUrl();
      if (msg.dfy === 'status') send({ enabled: DFY.settings.enabled, comments: C.hasComments(), space: isSpace(), ...C.stats() });
      else if (msg.dfy === 'clear') C.clear(), send({ ok: true });
      else if (msg.dfy === 'rescan') C.rescan(), send({ ok: true });
      else if (msg.dfy === 'report') DFY.space.show(), send({ ok: true });
      else if (msg.dfy === 'removed') send({ items: C.removedList() });
      else if (msg.dfy === 'restore') C.restore(msg.mid), send({ ok: true });    });

  if (!DFY.settings.enabled) return;
  // 设置加载前主世界可能已经送来过评论，让它重新送一次
  window.postMessage({ source: 'dfy-iso', type: 'rescan' }, '*');

  // 空间主页鉴定（B 站空间是单页应用，路由变化时重新鉴定）
  let lastMid = '';
  const checkRoute = () => {
    const mid = DFY.space.midFromUrl();
    if (mid && mid !== lastMid) {
      lastMid = mid;
      setTimeout(() => DFY.space.run(), 800);
    }
  };
  checkRoute();
  setInterval(checkRoute, 1000);
})();
