/* 已清计数条：评论区顶部一行「已清 N 条」（借鉴 blocker）。
 * 只做计数显示，无动画、无弹窗；数字含义 = 当前这份评论列表里被隐藏的评论数。
 * 计数在本页内存里去重，切视频 / 刷新时归零。 */
(function () {
  const DFY = (globalThis.DFY = globalThis.DFY || {});

  const CSS = `
.b{margin:8px 0 4px;display:inline-flex;align-items:center;gap:6px;padding:3px 11px 3px 9px;border-radius:999px;
  font:500 12px/1.6 -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;
  color:#667085;background:rgba(16,24,40,.045);user-select:none;font-variant-numeric:tabular-nums}
.b::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:#2546b8;opacity:.75}
.b.dk{color:#a3a9b8;background:rgba(255,255,255,.08)}
.b.dk::before{background:#9db8ff}`;

  const isDark = () => /dark/.test(document.documentElement.className || '') || document.documentElement.getAttribute('data-theme') === 'dark';

  let host = null, textEl = null, cache = '';

  /* 评论区顶部插入点：bili-comments shadowRoot 里的 #feed 之前（同 blocker） */
  function findMount() {
    const el = document.querySelector('#commentapp bili-comments');
    if (el && el.shadowRoot) {
      const feed = el.shadowRoot.querySelector('#feed');
      if (feed && feed.parentNode) return { parent: feed.parentNode, before: feed };
    }
    const old = document.querySelector('#comment .reply-warp') || document.querySelector('.reply-warp');
    if (old) {
      const list = old.querySelector('.reply-list') || old.querySelector('.comment-list');
      if (list && list.parentNode) return { parent: list.parentNode, before: list };
      return { parent: old, before: old.firstChild };
    }
    return null;
  }

  function update() {
    if (!textEl) return;
    textEl.classList.toggle('dk', isDark());
    const t = `已清 ${DFY.counter.total()} 条`;
    if (t === cache) return;
    cache = t;
    textEl.textContent = t;
    textEl.title = `一级评论 ${DFY.counter.roots} 条 · 楼中楼 ${DFY.counter.replies} 条`;
    textEl.classList.toggle('dk', isDark());
  }

  function draw() {
    if (!DFY.settings || !DFY.settings.showCount) {
      if (host) host.remove();
      return;
    }
    if (host && host.isConnected) return update();
    const m = findMount();
    if (!m) return;
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'display:block;width:100%';
      const sh = host.attachShadow({ mode: 'open' });
      const st = document.createElement('style');
      st.textContent = CSS;
      sh.appendChild(st);
      textEl = document.createElement('div');
      textEl.className = 'b';
      sh.appendChild(textEl);
    }
    update();
    if (m.before) m.parent.insertBefore(host, m.before);
    else m.parent.appendChild(host);
  }

  /* bili-comments 懒加载：300ms 廉价轮询等挂载点，插上即停（同 blocker） */
  let mountTimer = 0, tries = 0;
  function watchMount() {
    if (mountTimer || !DFY.settings || !DFY.settings.showCount) return;
    tries = 0;
    mountTimer = setTimeout(tick, 300);
  }
  function tick() {
    mountTimer = 0;
    if (!DFY.settings || !DFY.settings.showCount) return;
    if (host && host.isConnected) return;
    if (++tries > 50) return;
    draw();
    if (!(host && host.isConnected)) mountTimer = setTimeout(tick, 300);
  }

  DFY.counter = {
    roots: 0,
    replies: 0,
    add(r, s) {
      if (!r && !s) return;
      this.roots = Math.max(0, this.roots + (r || 0));
      this.replies = Math.max(0, this.replies + (s || 0));
      requestAnimationFrame(draw);
    },
    total() {
      return this.roots + this.replies;
    },
    reset() {
      this.roots = 0;
      this.replies = 0;
      cache = '';
      requestAnimationFrame(draw);
    },
  };

  /* 接口层（main-world）拦掉的评论不会进 DOM，计数从这里回传 */
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.source !== 'dfy-main') return;
    if (e.data.type === 'api-blocked') DFY.counter.add(e.data.roots || 0, e.data.replies || 0);
    else if (e.data.type === 'api-first') DFY.counter.reset(); // 换排序 / 换视频 / 刷新 → 首屏请求 → 归零
  });

  /* 切视频 / SPA 路由变化时归零（DOM 层没有首屏请求信号，用 URL 近似）；顺带响应 showCount 开关 */
  // 只看 pathname：#reply 锚点、?p= 分P 这类变化评论区还是同一批，不能当成换页（旧写法用整条 href，点评论永久链接就会把计数清零）
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      DFY.counter.reset();
      if (DFY.comments && DFY.comments.resetPage) DFY.comments.resetPage();
    }
    if (DFY.settings && !DFY.settings.showCount) {
      if (host) host.remove();
    } else if (DFY.settings && DFY.settings.showCount && !(host && host.isConnected)) {
      watchMount();
    }
  }, 1000);
})();
