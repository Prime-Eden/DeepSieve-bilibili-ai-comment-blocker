/* 评论区：识别 → 无感隐藏（无标记、无动画、无提示）。
 * 判定为「大肥鱼」的账号：评论直接 display:none，同时写入屏蔽名单（下次零成本命中）。
 * 楼中楼策略 subPolicy：
 *   fish   只隐藏该账号的评论（主楼隐藏后楼中楼保留）
 *   thread 楼里出现大肥鱼就整楼隐藏
 *   ignore 只处理一级评论，楼中楼不碰 */
(function () {
  const DFY = (globalThis.DFY = globalThis.DFY || {});
  const C = (DFY.comments = {});

  const items = new Map(); // rpid -> item
  const accounts = new Map(); // mid -> {acc, rpids:Set, verdict, llm}
  let upMid = '';
  let video = null; // {title, desc} 当前视频信息（main-world 传来）
  let aiTopic = false; // 当前视频是否 AI 话题（鱼极易出没，识别权重上下文）
  const AI_TOPIC_RE = /deep\s*seek|深度求索|大模型|AIGC|人工智能|\bAI\b|agent|智能体|桌宠|大肥鱼|鲸鱼娘|\bDSH\b|白饭|harness|claude|gpt|gemini|\bllm\b/i;
  let callout = new Map(); // mid -> 被几个人点名是大肥鱼
  let burst = new Map(); // ctime(秒) -> Set(mid)：同秒发评聚类（机器人排程痕迹）
  const threadCounted = new Map(); // 已按整楼计过数的线程（去重）：rpid → 当时计入的楼中楼条数（放回来时按这个数撤回）
  const countedEls = new Set(); // 已计数/记入回收站的评论（配合主世界预隐藏去重）

  /* ---------------- 数据接收（main-world → 这里） ---------------- */
  /** 登记一条评论并确保账号存在（pre-scan 与正常扫描共用） */
  function absorb(it) {
    const isNew = !items.has(it.rpid);
    items.set(it.rpid, it);
    let a = accounts.get(it.mid);
    if (!a) {
      a = { acc: { mid: it.mid, uname: it.uname, avatar: it.avatar, sign: it.sign, level: it.level, verify: it.verify, vip: it.vip }, rpids: new Set(), verdict: null, llm: null };
      const cached = DFY.memory.llmGet(it.mid);
      if (cached && DFY.settings.llmEnabled) a.llm = { ai: cached.ai, reason: cached.r, cached: true };
      accounts.set(it.mid, a);
      DFY.avatarBlue(it.avatar).then((b) => {
        a.acc.avatarBlue = b;
        judge(a);
        C.render();
      });
    }
    a.rpids.add(it.rpid);
    return { a, isNew };
  }

  /** 把当前判鱼名单同步给主世界：挂载回调里据此做绘制前预隐藏 */
  function sendFishVerdicts() {
    const f = [];
    for (const a of accounts.values()) if (a.verdict && a.verdict.level === 'fish') f.push(String(a.acc.mid));
    window.postMessage({ source: 'dfy-iso', type: 'verdicts', f }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.source !== 'dfy-main') return;
    // 接口层拦截的评论：进回收站（可审计、可恢复）。全文/特征从 pre-scan 已入库的数据与判定结果就近补全
    if (e.data.type === 'api-blocked') {
      for (const it of e.data.items || []) {
        const mid = String(it.m || '');
        const full = items.get(String(it.id || ''));
        const a = accounts.get(mid);
        const { sc, f } = featsOf(a);
        logRemoved({ id: String(it.id || ''), mid, name: it.n || (full ? full.uname : ''), text: full ? full.text : it.x, src: 'api', score: sc, feats: f });
      }
      return;
    }
    // 判定前置：接口层在渲染前送来的原始数据，同步打分并把结果推回主世界
    if (e.data.type === 'pre-scan') {
      if (!DFY.settings || !DFY.lists || !DFY.settings.enabled) return;
      upMid = e.data.upMid || upMid;
      if (e.data.video) {
        video = e.data.video;
        aiTopic = AI_TOPIC_RE.test((video.title || '') + ' ' + (video.desc || ''));
      }
      for (const it of e.data.items || []) {
        const { a } = absorb(it);
        judge(a);
      }
      sendFishVerdicts();
      return;
    }
    if (e.data.type !== 'comments') return;
    if (!DFY.settings || !DFY.lists || !DFY.settings.enabled) return;
    upMid = e.data.upMid || upMid;
    if (e.data.video) {
      video = e.data.video;
      aiTopic = AI_TOPIC_RE.test((video.title || '') + ' ' + (video.desc || ''));
    }
    const fresh = [];
    for (const it of e.data.items) {
      const { a, isNew } = absorb(it);
      if (isNew) fresh.push(it.mid);
    }
    refreshBurst();
    for (const mid of new Set([...fresh, ...refreshCallouts()])) judge(accounts.get(mid));
    sendFishVerdicts();
    C.render();
    queueLLM();
  });

  /** 同秒发评聚类：只统计一级评论，Map(ctime -> 该秒内发评的不同账号数) */
  function refreshBurst() {
    const next = new Map();
    for (const it of items.values()) {
      if (it.isReply || !it.ctime) continue;
      if (!next.has(it.ctime)) next.set(it.ctime, new Set());
      next.get(it.ctime).add(String(it.mid));
    }
    burst = next;
  }
  function sameSecondOf(a) {
    let n = 0;
    for (const id of a.rpids) {
      const it = items.get(id);
      if (!it || it.isReply || !it.ctime) continue;
      const set = burst.get(it.ctime);
      if (set && set.size > n) n = set.size;
    }
    return n;
  }

  function refreshCallouts() {
    const next = DFY.callouts([...items.values()]);
    const changed = [...next].filter(([mid, n]) => callout.get(mid) !== n).map(([mid]) => mid);
    callout = next;
    return changed;
  }

  function textsOf(a) {
    return [...a.rpids].map((id) => items.get(id)).filter(Boolean);
  }

  function judge(a) {
    if (!a) return;
    const its = textsOf(a);
    const mid = a.acc.mid;
    if (DFY.lists.white[mid]) {
      a.verdict = { score: 0, level: 'human', reasons: [{ w: -99, why: '在白名单里' }] };
      return;
    }
    const off = DFY.judge(a.acc, its.map((i) => ({ text: i.text, isReply: i.isReply })), { upMid, topCount: its.filter((i) => !i.isReply).length, priorPages: DFY.memory.prior(mid), calledOut: callout.get(String(mid)) || 0, sameSecond: sameSecondOf(a), aiTopic, manualStats: DFY.manualStats || {} });
    let score = off.score;
    const reasons = off.reasons.slice();
    if (a.llm) score = Math.round(off.score * 0.45 + a.llm.ai * 0.55);
    // 自定义屏蔽词：评论命中任意一个词 → 直接顶格判鱼（确定性兜底，借鉴 blocker）
    const wordHit = DFY.customHit ? its.some((i) => DFY.customHit(i.text)) : false;
    if (wordHit) {
      score = 99;
      reasons.unshift({ w: 99, why: '命中自定义屏蔽词' });
    }
    if (DFY.lists.block[mid]) {
      score = Math.max(score, 99);
      reasons.unshift({ w: 99, why: '已在屏蔽名单里' });
    }
    a.verdict = { score, offline: off.score, level: DFY.levelOf(score, DFY.settings.threshold), reasons };
    // 只凭本页证据就够得上大肥鱼时才记前科（名单、精判、屏蔽词都不算，避免自我强化）
    if (off.raw >= DFY.settings.threshold && (!a.llm || a.llm.ai >= 50) && !wordHit) DFY.memory.mark(mid, a.acc.uname);
  }
  C.rejudgeAll = function () {
    for (const a of accounts.values()) judge(a);
    sendFishVerdicts();
    C.render();
  };

  /* ---------------- DOM 遍历 ---------------- */
  function eachThread(cb) {
    for (const bc of document.querySelectorAll('bili-comments')) {
      if (!bc.shadowRoot) continue;
      for (const th of bc.shadowRoot.querySelectorAll('bili-comment-thread-renderer')) cb(th);
    }
  }
  function rootElOf(th) {
    return th.shadowRoot ? th.shadowRoot.querySelector('bili-comment-renderer') : null;
  }
  function repliesOf(th) {
    const rep = th.shadowRoot && th.shadowRoot.querySelector('bili-comment-replies-renderer');
    return rep && rep.shadowRoot ? [...rep.shadowRoot.querySelectorAll('bili-comment-reply-renderer')] : [];
  }
  function accOfEl(el) {
    const id = el.getAttribute('data-dfy-rpid');
    const it = id && items.get(id);
    return it ? accounts.get(it.mid) : null;
  }
  const isFishAcc = (a) => !!(a && a.verdict && a.verdict.level === 'fish');

  function hideEl(el) {
    if (!el || el.style.display === 'none') return false;
    el.style.display = 'none';
    return true;
  }
  function showEl(el) {
    if (el && el.style.display === 'none') el.style.display = '';
  }

  /* ---------------- 疑似标注：不隐藏，只在昵称旁挂一枚轻量徽标 ----------------
   * fish（≥阈值）无感隐藏；suspect（可疑）保留可见但标注「可疑 N%」，
   * DeepSeek 参与过判定时追加 DS 角标；悬停显示评分明细。纯信息展示，点击无动作。 */
  const SUS_CSS = `
.dfy-sus{display:inline-flex;align-items:center;gap:5px;margin-left:6px;height:20px;padding:0 3px 0 8px;border-radius:999px;background:rgba(150,150,165,.16);font:500 11px/20px -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;vertical-align:middle;cursor:help;user-select:none;color:inherit}
.dfy-sus b{font-weight:700;font-variant-numeric:tabular-nums}
.dfy-sus .ds{font-style:normal;font-size:9px;font-weight:700;line-height:14px;padding:0 4px;border-radius:4px;background:rgba(61,91,214,.18);color:#5a78e6}
.dfy-sus .ks{border:0;background:transparent;color:inherit;opacity:.72;font:600 10.5px/16px -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;padding:0 7px;border-radius:999px;cursor:pointer;transition:background .12s ease,opacity .12s ease,color .12s ease}
.dfy-sus .ks:hover{background:#c2455a;color:#fff;opacity:1}
`;
  let susTip = null;
  function susTipShow(anchor, a) {
    if (!susTip) {
      susTip = document.createElement('div');
      susTip.style.cssText = 'position:fixed;z-index:2147482999;max-width:300px;padding:9px 12px;border-radius:10px;background:rgba(28,30,38,.96);color:#f0f0f4;font:12px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none;display:none';
      (document.body || document.documentElement).appendChild(susTip);
    }
    const v = a.verdict || {};
    const reasons = (v.reasons || [])
      .slice(0, 5)
      .map((r) => `· ${DFY.esc(r.why)}${r.w ? `（${r.w > 0 ? '+' : ''}${r.w}）` : ''}`)
      .join('<br>');
    susTip.innerHTML =
      `<div style="font-weight:700;margin-bottom:2px">${DFY.esc(a.acc.uname)} · 可疑 ${v.score == null ? '?' : v.score}%${a.llm ? ` · DeepSeek ${a.llm.ai}%` : ''}</div>` +
      (reasons ? `<div style="opacity:.85">${reasons}</div>` : '<div style="opacity:.7">暂无明显特征</div>') +
      (a.llm ? `<div style="margin-top:3px;opacity:.85">DeepSeek：${DFY.esc(a.llm.reason || '')}</div>` : '') +
      '<div style="margin-top:4px;opacity:.55">仅供参考 · 点「拉黑」立即拉黑 · 达到阈值自动隐藏</div>';
    const r = anchor.getBoundingClientRect();
    susTip.style.display = 'block';
    const tw = susTip.offsetWidth, thh = susTip.offsetHeight;
    const x = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let y = r.bottom + 6;
    if (y + thh > window.innerHeight - 8) y = Math.max(8, r.top - thh - 6);
    susTip.style.left = x + 'px';
    susTip.style.top = y + 'px';
  }
  function susTipHide() {
    if (susTip) susTip.style.display = 'none';
  }
  // 徽标上的「清理」：捕获阶段拦截（阻止 B 站把点击当评论交互），走后台队列拉黑
  document.addEventListener(
    'click',
    (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      const ks = path.find((n) => n.nodeType === 1 && n.classList && n.classList.contains('ks'));
      if (!ks) return;
      const sus = path.find((n) => n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-dfy-sus'));
      if (!sus) return;
      e.stopPropagation();
      e.preventDefault();
      const mid = sus.getAttribute('data-dfy-sus');
      if (mid) blockMids([mid], 99);
      susTipHide();
    },
    true
  );

  // 手动拉黑的 3 秒撤销窗口：期间评论暂缓隐藏（按钮保持「撤销」态），过期由定时器触发隐藏
  const grace = new Map(); // mid -> 过期时间戳
  function inGrace(mid) {
    const e = grace.get(String(mid));
    if (e && Date.now() < e) return e;
    grace.delete(String(mid));
    return 0;
  }

  /* ---------------- 悬停「拉黑」按钮（全页单例，脚本驱动） ----------------
   * 旧做法把按钮塞进 B 站评论的 shadow DOM，靠 CSS :host(:hover) + 过渡延迟显隐：
   *   ① 自动档要求「AI 话题或本页已出现判鱼」才插入，多数视频根本没有按钮；
   *   ② B 站组件重绘会把外来节点冲掉，而我们只在新数据到来时才补回；
   *   ③ 靠 CSS 过渡延迟计时，被重绘 / 悬停抖动打断后不再触发。
   * 现在：事件委托识别鼠标所在评论 → 停留 DWELL 毫秒 → 在昵称行右侧浮出全页唯一的按钮，
   * 位置每次现算，不依赖任何注入到评论里的节点。 */
  const BLK_DWELL = { auto: 1000, on: 0 }; // 自动：停留 1 秒；常开：立即
  const BLK_CSS = `
:host{all:initial}
.b{box-sizing:border-box;height:22px;padding:0 11px;border:1px solid rgba(16,24,40,.12);border-radius:999px;background:rgba(255,255,255,.97);color:#475467;font:600 11.5px/20px -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;cursor:pointer;white-space:nowrap;position:relative;overflow:hidden;box-shadow:0 2px 8px rgba(16,24,40,.14);animation:in .12s ease-out;transition:background .12s,color .12s,border-color .12s}
.b.dk{background:rgba(38,40,48,.97);border-color:rgba(255,255,255,.16);color:#d0d5dd}
.b:hover{background:#c2455a;border-color:#c2455a;color:#fff}
.b.undo,.b.undo.dk{background:#2546b8;border-color:#2546b8;color:#fff}
.b.undo:hover{background:#1d3a9c;border-color:#1d3a9c}
.b.undo::after{content:"";position:absolute;left:0;bottom:0;height:2px;width:100%;background:rgba(255,255,255,.75);transform-origin:left;animation:burn 3s linear forwards}
@keyframes in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@keyframes burn{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@media (prefers-reduced-motion: reduce){.b{animation:none}.b.undo::after{display:none}}
`;
  let blkHost = null, blkEl = null, blkAnchor = null;
  let blkMid = '', blkShown = '', blkPending = '', blkUndo = false;
  let blkDwellT = 0, blkLeaveT = 0, blkUndoT = 0, blkFollowT = 0;
  const blkDark = () => /dark/.test(document.documentElement.className || '') || document.documentElement.getAttribute('data-theme') === 'dark';

  function blkEnsure() {
    if (blkHost && blkHost.isConnected) return;
    blkHost = document.createElement('dfy-blk');
    blkHost.style.cssText = 'position:fixed;left:0;top:0;z-index:2147482998;display:none';
    const sh = blkHost.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = BLK_CSS;
    sh.appendChild(st);
    blkEl = document.createElement('button');
    blkEl.type = 'button';
    blkEl.className = 'b';
    blkEl.addEventListener('click', blkClick);
    sh.appendChild(blkEl);
    (document.body || document.documentElement).appendChild(blkHost);
  }

  function blkRender() {
    blkEl.classList.toggle('undo', blkUndo);
    blkEl.classList.toggle('dk', blkDark());
    blkEl.textContent = blkUndo ? '撤销' : '拉黑';
    blkEl.title = blkUndo ? '撤销这次拉黑' : '立即拉黑该账号（3 秒内可撤销，可在名单页恢复）';
  }

  /** 把按钮放到该评论「操作行」（时间 · 点赞 · 回复那一行）的最右端，垂直居中于该行。
   *  不放在昵称后面：楼中楼的昵称和正文常在同一行，按钮会压住正文；操作行右端是留白，不遮任何内容。
   *  找不到操作行时退到评论框的右下角；评论没有完整落在视口内时返回 false。 */
  function blkPlace() {
    const el = blkAnchor;
    if (!el || !el.isConnected || !blkHost) return false;
    const base = el.localName === 'bili-comment-thread-renderer' ? rootElOf(el) : el;
    if (!base || base.style.display === 'none') return false;
    const box = base.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const sr = base.shadowRoot;
    const bar = sr && sr.querySelector('bili-comment-action-buttons-renderer');
    const ar = bar ? bar.getBoundingClientRect() : null;
    blkHost.style.display = '';
    const w = blkEl.offsetWidth, h = blkEl.offsetHeight;
    let x, y;
    if (ar && ar.height) {
      if (ar.top < 0 || ar.bottom > window.innerHeight) return false; // 操作行没完整露出：不出按钮
      x = box.right - w - 6;
      y = ar.top + (ar.height - h) / 2;
    } else {
      if (box.top < 0 || box.bottom > window.innerHeight) return false;
      x = box.right - w - 6;
      y = box.bottom - h - 8;
    }
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    blkHost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    return true;
  }

  function blkHide() {
    clearTimeout(blkDwellT);
    clearTimeout(blkLeaveT);
    clearTimeout(blkUndoT);
    clearInterval(blkFollowT);
    blkPending = '';
    blkShown = '';
    blkUndo = false;
    blkAnchor = null;
    if (blkHost) blkHost.style.display = 'none';
  }

  function blkShow(el, rpid) {
    blkPending = '';
    const it = items.get(rpid);
    const a = it && accounts.get(String(it.mid));
    if (!a || !a.acc || !a.acc.mid || String(a.acc.mid) === String(upMid)) return; // UP 主自己不出按钮
    blkEnsure();
    blkAnchor = el;
    blkMid = String(a.acc.mid);
    blkUndo = grace.has(blkMid);
    blkRender();
    if (!blkPlace()) {
      blkHide();
      return;
    }
    blkShown = rpid;
  }

  function blkLeave() {
    if (blkUndo) return; // 撤销窗口内按钮常驻，等倒计时结束
    clearTimeout(blkDwellT);
    blkPending = '';
    clearTimeout(blkLeaveT);
    blkLeaveT = setTimeout(blkHide, 250); // 给鼠标从评论移向按钮留一点时间
  }

  function blkClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const mid = blkMid;
    if (!mid) return;
    if (blkUndo) {
      undoBlock(mid);
      blkHide();
      return;
    }
    blockMids([mid], 99, { grace: true });
    blkUndo = true;
    blkRender();
    clearTimeout(blkUndoT);
    blkUndoT = setTimeout(blkHide, 3300);
    clearInterval(blkFollowT);
    blkFollowT = setInterval(() => {
      if (!blkPlace()) blkHide();
    }, 250);
    susTipHide();
  }

  /** 找鼠标所在的评论：沿 composedPath 取最近的带 data-dfy-rpid 的节点（楼中楼回复自己带，主楼是线程元素） */
  function commentAt(path) {
    let inReplies = false;
    for (const n of path) {
      if (n.nodeType !== 1) continue;
      if (n.localName === 'bili-comment-replies-renderer') inReplies = true;
      if (n.hasAttribute && n.hasAttribute('data-dfy-rpid')) {
        // 停在楼中楼容器空白处（不属于任何回复）：不归给主楼
        if (inReplies && n.localName === 'bili-comment-thread-renderer') return null;
        return n;
      }
    }
    return null;
  }

  /** 鼠标移动时判断悬停对象（path = composedPath）。 */
  function blkPointer(path) {
    const s = DFY.settings;
    if (!s || !s.enabled) return;
    const mode = s.blockBtn || 'auto';
    if (mode === 'off') {
      if (blkHost && blkHost.style.display !== 'none') blkHide();
      return;
    }
    if (blkHost && path.includes(blkHost)) {
      clearTimeout(blkLeaveT); // 鼠标移上按钮：保持
      return;
    }
    const el = commentAt(path);
    if (!el) return blkLeave();
    clearTimeout(blkLeaveT);
    if (blkUndo) return;
    const rpid = el.getAttribute('data-dfy-rpid');
    if (rpid === blkShown || rpid === blkPending) return; // 还在同一条评论上
    clearTimeout(blkDwellT);
    if (blkShown) {
      blkShown = '';
      if (blkHost) blkHost.style.display = 'none';
    }
    blkPending = rpid;
    blkDwellT = setTimeout(() => blkShow(el, rpid), BLK_DWELL[mode] != null ? BLK_DWELL[mode] : 1000);
  }

  /* 为什么用 mousemove 而不是 mouseover/mouseout 委托：
   * B 站评论全是嵌套的 shadow DOM。DOM 规范规定，mouseover/out 的 target 与 relatedTarget
   * 在 document 层重定向后相同（都是 <bili-comments>）时，事件不会派发给 document 上的监听器——
   * 也就是说鼠标在评论区内部从一条移到另一条时，document 级 mouseover 根本收不到。
   * （旧版悬停提示也有同样的问题：只有从评论区外进入时才触发。）
   * mousemove 每次都会派发，用 composedPath()[0] 去重，开销很小。 */
  let lastPointerNode = null;
  document.addEventListener(
    'mousemove',
    (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      const node = path[0];
      if (node === lastPointerNode) return;
      lastPointerNode = node;
      // 疑似徽标的评分明细提示（全页单例）
      const t = path.find((n) => n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-dfy-sus'));
      if (t) {
        const a = accounts.get(t.getAttribute('data-dfy-sus'));
        if (a && a.verdict) susTipShow(t, a);
      } else susTipHide();
      blkPointer(path);
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    'mouseout',
    (e) => {
      if (!e.relatedTarget) {
        lastPointerNode = null;
        susTipHide();
        blkLeave(); // 鼠标离开窗口
      }
    },
    true
  );
  window.addEventListener(
    'scroll',
    () => {
      if (blkUndo) blkPlace();
      else if (blkShown || blkPending) blkHide();
    },
    { capture: true, passive: true }
  );

  /** 手动拉黑（框选/徽标清理共用）：名单写入走后台队列，judge 后 doRender 自动隐藏/计数/记录 */
  async function blockMids(mids, score, opts = {}) {
    const list = [...mids].filter((mid) => !DFY.lists.white[mid]);
    if (!list.length) return 0;
    const entries = {};
    const stats = {}; // 人工确认特征计数：宁滥勿放的温和强化回路
    for (const mid of list) {
      const a = accounts.get(mid);
      const acc = a ? a.acc : null;
      entries[mid] = { n: acc ? acc.uname : '', a: acc ? acc.avatar : '', t: Date.now(), s: score == null ? (a && a.verdict ? a.verdict.score : 0) : score };
      const rs = (a && a.verdict && a.verdict.reasons) || [];
      // 基础比例校准：Lv/头像/号段这类账号静态特征几乎人人有份，学了只会推高误杀；只学文本与行为特征
      const skip = new Set(['manual', 'level', 'avatar', 'mid']);
      for (const r of rs) if (r.w > 0 && r.why && !skip.has(r.tag)) stats[r.why] = (stats[r.why] || 0) + 1;
    }
    if (DFY.callBg) {
      await DFY.callBg({ type: 'bl-add', entries });
      if (Object.keys(stats).length) await DFY.callBg({ type: 'ms-add', tags: stats });
    }
    for (const mid of list) {
      DFY.lists.block[mid] = DFY.lists.block[mid] || { t: Date.now() };
      const a = accounts.get(mid);
      if (a) judge(a);
    }
    C.render(); // doRender 走完整管线：隐藏 + 计数 + 回收站，一处不落
    // 即时反馈：手动裁决被看见（悬浮台闪现强化提示；菜单开着时菜单数字即反馈）
    if (DFY.bubble && DFY.bubble.flash) {
      const kinds = Object.keys(stats).length;
      DFY.bubble.flash(opts.grace ? `已拉黑（3 秒内可撤销）· 特征强化 ${kinds} 类` : list.length > 1 ? `已拉黑 ${list.length} 个账号 · 特征强化 ${kinds} 类` : `已拉黑 · 特征强化 +${kinds || 1}`);
    }
    if (opts.grace) {
      for (const mid of list) grace.set(mid, Date.now() + 3000);
      setTimeout(() => {
        for (const mid of list) grace.delete(mid);
        C.render(); // 撤销窗口结束：真正隐藏 + 计数 + 记录
      }, 3300);
    }
    return list.length;
  }

  /** 撤销一次手动拉黑：移出名单 + 恢复原评分，评论立即回来 */
  async function undoBlock(mid) {
    mid = String(mid || '');
    grace.delete(mid);
    if (DFY.callBg) await DFY.callBg({ type: 'bl-del', mid });
    delete DFY.lists.block[mid];
    const a = accounts.get(mid);
    if (a) judge(a);
    C.render();
    if (DFY.bubble && DFY.bubble.flash) DFY.bubble.flash('已撤销拉黑');
  }

  /** 可见元素上的徽标同步：suspect 徽标挂/更新 + 一键拉黑按钮（三档设置控制） */
  function syncSuspect(host, a) {
    if (!host || !host.shadowRoot) return;
    const root = host.shadowRoot;
    const isSus = !!(a && a.verdict && a.verdict.level === 'suspect');
    const info = root.querySelector('bili-comment-user-info');
    let badge = root.querySelector('.dfy-sus');
    if (!isSus && badge) badge.remove();
    if (!info) return;
    if (!root.querySelector('style[data-dfy-sus]')) {
      const st = document.createElement('style');
      st.setAttribute('data-dfy-sus', '');
      st.textContent = SUS_CSS;
      root.appendChild(st);
    }
    // 疑似徽标
    if (!isSus) return;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'dfy-sus';
      info.after(badge);
    }
    badge.setAttribute('data-dfy-sus', a.acc.mid);
    const html = `可疑 <b>${a.verdict.score}%</b>${a.llm ? '<i class="ds">DS</i>' : ''}<button class="ks" title="立即拉黑该账号（可在名单页恢复）">拉黑</button>`;
    if (badge.dataset.v !== html) {
      badge.dataset.v = html;
      badge.innerHTML = html;
    }
  }

  async function addBlocks(list) {
    if (!list.length) return;
    // 统一写入口：后台串行队列（多标签页并发写不再互相覆盖）
    const entries = {};
    for (const a of list) entries[a.acc.mid] = { n: a.acc.uname, a: a.acc.avatar, t: Date.now(), s: a.verdict ? a.verdict.score : 0 };
    if (DFY.callBg) await DFY.callBg({ type: 'bl-add', entries });
    for (const a of list) DFY.lists.block[a.acc.mid] = { n: a.acc.uname, t: Date.now() };
  }

  /* ---------------- 回收站：本会话被隐藏的评论（可审计、可恢复） ----------------
   * 无感屏蔽最大的风险是「误杀了却不知道」，这份日志让每次隐藏都有据可查。
   * 同时批量落盘到 removedLog（跨页面跨会话的总记录，上限 2000 条），供 popup 导出。 */
  const removedLog = [];
  const removedPending = [];
  let removedTimer = 0;
  /** 从判定结果采集「发言特征」（前 4 条加减分理由）与评分，供总记录导出与人工特征强化 */
  const featsOf = (a) => {
    const v = a && a.verdict;
    if (!v) return { sc: null, f: [] };
    return {
      sc: v.score,
      f: (v.reasons || [])
        .filter((r) => r.why && r.tag !== 'manual')
        .slice(0, 4)
        .map((r) => `${r.why}${r.w ? `(${r.w > 0 ? '+' : ''}${r.w})` : ''}`),
    };
  };
  /** 评论被放回来（取消屏蔽 / 加白名单 / 调阈值）：计数与会话记录一并撤回，悬浮台、计数条、设置面板才与实际一致。
   *  此前只从「已计数」集合里删了标记，计数和记录都不动，于是手动解除之后悬浮台还挂着旧记录。
   *  跨会话的「隐藏总记录」是审计日志，不回删；接口层拦截的记录（src=api）在刷新前确实仍是隐藏态，保留。 */
  function uncount(id, roots, replies) {
    if (!id) return;
    DFY.counter.add(-roots, -replies);
    for (let i = removedLog.length - 1; i >= 0; i--) {
      if (String(removedLog[i].id) === String(id) && removedLog[i].src !== 'api') removedLog.splice(i, 1);
    }
    if (DFY.bubble && DFY.bubble.sync) DFY.bubble.sync();
  }
  function logRemoved(entry) {
    if (!entry.id && !entry.mid) return;
    entry.t = Date.now();
    removedLog.unshift(entry);
    if (removedLog.length > 200) removedLog.length = 200;
    removedPending.push({
      id: String(entry.id || ''),
      mid: String(entry.mid || ''),
      n: entry.name || '',
      x: String(entry.text || '').slice(0, 500), // 全文（截 500），导出用
      sc: entry.score == null ? null : entry.score,
      f: (entry.feats || []).slice(0, 4), // 发言特征
      src: entry.src || 'dom',
      t: entry.t,
    });
    clearTimeout(removedTimer);
    removedTimer = setTimeout(flushRemoved, 2000); // 批量落盘，不让每次隐藏都打一次 storage
  }
  async function flushRemoved() {
    if (!removedPending.length) return;
    if (!DFY.callBg) {
      removedTimer = setTimeout(flushRemoved, 2000); // content.js 还没就绪，等下一轮
      return;
    }
    const batch = removedPending.splice(0);
    const res = await DFY.callBg({ type: 'rl-append', items: batch });
    if (!res || !res.ok) {
      removedPending.unshift(...batch); // 写失败回队，放慢重试
      removedTimer = setTimeout(flushRemoved, 4000);
    }
  }
  C.removedList = () => removedLog.slice(0, 100);
  /** 恢复 = 加入白名单 + 移出屏蔽名单（后台原子完成）；接口层拦掉的评论刷新页面后才会重新出现 */
  C.restore = async function (mid) {
    mid = String(mid || '');
    if (!mid || DFY.lists.white[mid]) return;
    const a = accounts.get(mid);
    const name = a ? a.acc.uname : ((removedLog.find((x) => x.mid === mid) || {}).name || '');
    if (DFY.callBg) await DFY.callBg({ type: 'wl-promote', mid, name });
    DFY.lists.white[mid] = { n: name, t: Date.now() };
    delete DFY.lists.block[mid];
    // 会话回收站同步移除该账号的记录，恢复动作立刻可见
    for (let i = removedLog.length - 1; i >= 0; i--) if (String(removedLog[i].mid) === mid) removedLog.splice(i, 1);
    if (a) judge(a);
    C.render();
  };

  /* ---------------- 框选手动屏蔽：引擎漏网之鱼的兜底 ----------------
   * 开启后盖一层透明选框，拖一个矩形，框内评论所属账号全部拉黑；
   * 复用 doRender 管线（隐藏/计数/回收站全自动），且入屏蔽名单后接口层永久拦截。 */
  let boxMode = false;
  C.boxSelect = function () {
    if (boxMode || !C.hasComments()) return;
    boxMode = true;
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147482999;cursor:crosshair;background:rgba(31,35,41,.05)';
    const tip = document.createElement('div');
    tip.textContent = '拖动框选要屏蔽的评论 · 松手生效 · Esc 取消';
    tip.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:1;padding:6px 14px;border-radius:8px;background:#1f2329;color:#fff;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35)';
    const rect = document.createElement('div');
    rect.style.cssText = 'position:fixed;border:1.5px dashed #e0566b;background:rgba(224,86,107,.08);display:none;pointer-events:none';
    layer.appendChild(tip);
    layer.appendChild(rect);
    document.body.appendChild(layer);

    let sx = 0, sy = 0, moved = false;
    const onMove = (e) => {
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      if (w + h > 10) moved = true;
      Object.assign(rect.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', display: 'block' });
    };
    const stop = () => {
      boxMode = false;
      document.removeEventListener('keydown', onKey, true);
      layer.remove();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') stop();
    };
    layer.addEventListener('pointerdown', (e) => {
      sx = e.clientX;
      sy = e.clientY;
      moved = false;
      try {
        layer.setPointerCapture(e.pointerId);
      } catch (err) {}
      const onUp = () => {
        layer.removeEventListener('pointermove', onMove);
        layer.removeEventListener('pointerup', onUp);
        if (!moved) return; // 误触：留在框选模式等真正框选或 Esc
        const sel = rect.getBoundingClientRect();
        stop();
        applySelection(sel);
      };
      layer.addEventListener('pointermove', onMove);
      layer.addEventListener('pointerup', onUp);
    });
    document.addEventListener('keydown', onKey, true);
  };

  async function applySelection(sel) {
    const hit = (r) => !(r.right < sel.left || r.left > sel.right || r.bottom < sel.top || r.top > sel.bottom);
    const mids = new Set();
    eachThread((th) => {
      const rootId = th.getAttribute('data-dfy-rpid');
      const rootIt = rootId && items.get(rootId);
      const cr = rootElOf(th);
      if (cr && rootIt && hit(cr.getBoundingClientRect())) mids.add(String(rootIt.mid));
      for (const el of repliesOf(th)) {
        const id = el.getAttribute('data-dfy-rpid');
        const it = id && items.get(id);
        if (it && hit(el.getBoundingClientRect())) mids.add(String(it.mid));
      }
    });
    if (!mids.size) return;
    await blockMids(mids, 99); // doRender 走完整管线：隐藏 + 计数 + 回收站，一处不落
  }

  /* ---------------- 渲染（= 执行隐藏） ---------------- */
  let renderQueued = false;
  C.render = function () {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      doRender();
    });
  };

  function doRender() {
    if (!DFY.settings || !DFY.settings.enabled) return;
    const policy = DFY.settings.subPolicy || 'fish';
    const toBlock = new Set();
    eachThread((th) => {
      const rootId = th.getAttribute('data-dfy-rpid');
      const rootIt = rootId && items.get(rootId);
      const rootAcc = rootIt ? accounts.get(rootIt.mid) : null;
      const rootFish = isFishAcc(rootAcc);
      if (rootFish && rootAcc && !DFY.lists.block[rootAcc.acc.mid]) toBlock.add(rootAcc);

      const reps = repliesOf(th).map((el) => {
        const id = el.getAttribute('data-dfy-rpid');
        const it = id && items.get(id);
        const a = it ? accounts.get(it.mid) : null;
        const level = a && a.verdict ? a.verdict.level : 'human';
        if (level === 'fish' && !DFY.lists.block[a.acc.mid]) toBlock.add(a);
        return { el, id, it, a, fish: level === 'fish', sus: level === 'suspect' };
      });
      const anyReplyFish = reps.some((x) => x.fish);

      if (policy === 'thread' || policy === 'ignore') {
        // 整楼 / 只看主楼：命中时整个线程元素隐藏，一次记 1 + 楼中楼总数（撤销窗口内暂缓）
        const rootGraced = rootAcc && inGrace(rootAcc.acc.mid);
        if ((rootFish || (policy === 'thread' && anyReplyFish)) && !rootGraced) {
          // data-dfy-pre = 主世界已在绘制前隐藏过，这里只补记账
          if ((hideEl(th) || th.hasAttribute('data-dfy-pre')) && !threadCounted.has(rootId)) {
            const repN = Math.max((rootIt && rootIt.rcount) || 0, reps.length);
            threadCounted.set(rootId, repN);
            DFY.counter.add(1, repN);
            const feats = featsOf(rootAcc);
            logRemoved({ id: rootId, mid: rootIt && rootIt.mid, name: rootAcc ? rootAcc.acc.uname : '', text: ((rootIt && rootIt.text) || '').slice(0, 500), src: 'dom', score: feats.sc, feats: feats.f });
          }
        } else {
          if (threadCounted.has(rootId)) {
            const n = threadCounted.get(rootId);
            threadCounted.delete(rootId);
            uncount(rootId, 1, n);
          }
          th.removeAttribute('data-dfy-pre');
          showEl(th);
          const cr0 = rootElOf(th);
          showEl(cr0);
          syncSuspect(cr0, rootAcc);
          for (const x of reps) {
            x.el.removeAttribute('data-dfy-pre');
            showEl(x.el);
            syncSuspect(x.el, x.a);
          }
        }
        return;
      }

      // policy = fish：只隐藏命中账号自己的那几条
      showEl(th);
      const cr = rootElOf(th);
      if (rootFish) {
        if (rootAcc && inGrace(rootAcc.acc.mid)) {
          // 撤销窗口内：暂缓隐藏，按钮保持「撤销」态
          th.removeAttribute('data-dfy-pre');
          showEl(cr);
          syncSuspect(cr, rootAcc);
          if (countedEls.delete(rootId)) uncount(rootId, 1, 0);
        } else if ((hideEl(cr) || th.hasAttribute('data-dfy-pre')) && !countedEls.has(rootId)) {
          countedEls.add(rootId);
          DFY.counter.add(1, 0);
          const feats = featsOf(rootAcc);
          logRemoved({ id: rootId, mid: rootIt && rootIt.mid, name: rootAcc ? rootAcc.acc.uname : '', text: ((rootIt && rootIt.text) || '').slice(0, 500), src: 'dom', score: feats.sc, feats: feats.f });
        }
      } else {
        th.removeAttribute('data-dfy-pre');
        showEl(cr);
        syncSuspect(cr, rootAcc); // suspect 级：不隐藏，昵称旁挂疑似徽标
        if (countedEls.delete(rootId)) uncount(rootId, 1, 0);
      }
      for (const x of reps) {
        if (x.fish) {
          const graced = x.a && inGrace(x.a.acc.mid);
          if (graced) {
            x.el.removeAttribute('data-dfy-pre');
            showEl(x.el);
            syncSuspect(x.el, x.a);
            if (countedEls.delete(x.id)) uncount(x.id, 0, 1);
          } else if ((hideEl(x.el) || x.el.hasAttribute('data-dfy-pre')) && !countedEls.has(x.id)) {
            countedEls.add(x.id);
            DFY.counter.add(0, 1);
            const feats = featsOf(x.a);
            logRemoved({ id: x.id, mid: x.it && x.it.mid, name: x.a ? x.a.acc.uname : '', text: ((x.it && x.it.text) || '').slice(0, 500), src: 'dom', score: feats.sc, feats: feats.f });
          }
        } else {
          x.el.removeAttribute('data-dfy-pre');
          showEl(x.el);
          syncSuspect(x.el, x.a);
          if (countedEls.delete(x.id)) uncount(x.id, 0, 1);
        }
      }
    });
    if (toBlock.size) addBlocks([...toBlock]);
  }

  /** 关闭插件 / 停用：把隐藏的全部放回来 */
  function showAll() {
    eachThread((th) => {
      th.removeAttribute('data-dfy-pre');
      showEl(th);
      showEl(rootElOf(th));
      for (const el of repliesOf(th)) {
        el.removeAttribute('data-dfy-pre');
        showEl(el);
      }
    });
  }
  C.showAll = showAll;

  C.clear = function () {
    C.rejudgeAll();
  };

  C.rescan = function () {
    window.postMessage({ source: 'dfy-iso', type: 'rescan' }, location.origin);
    setTimeout(() => C.rejudgeAll(), 600);
  };

  /* ---------------- DeepSeek 精判（静默） ---------------- */
  let llmTimer = 0;
  const llmDone = new Set();
  function queueLLM() {
    const s = DFY.settings;
    if (!s.llmEnabled || !s.llmKey || !s.llmAuto || !DFY.canLLM) return;
    clearTimeout(llmTimer);
    llmTimer = setTimeout(() => {
      const minOff = aiTopic ? 10 : 20; // AI 话题视频：可疑池放宽，交给精判把关（精判占最终分 55%，保精度）
      const list = [...accounts.values()].filter((a) => a.verdict && !a.llm && !llmDone.has(a.acc.mid) && !DFY.lists.white[a.acc.mid] && !DFY.lists.block[a.acc.mid] && a.verdict.offline >= minOff && a.verdict.offline < 85);
      if (list.length) C.llmJudge(list.slice(0, 8));
    }, 1500);
  }

  C.llmJudge = async function (list) {
    const s = DFY.settings;
    if (!s.llmEnabled || !s.llmKey || !DFY.canLLM) return;
    list = (list || []).filter(Boolean);
    if (!list.length) return;
    for (const a of list) llmDone.add(a.acc.mid);
    const payload = list.map((a) => ({
      id: a.acc.mid,
      name: a.acc.uname,
      level: a.acc.level,
      sign: (a.acc.sign || '').slice(0, 80),
      offline: a.verdict ? a.verdict.offline : null,
      hints: a.verdict ? a.verdict.reasons.slice(0, 4).map((r) => r.why) : [],
      comments: textsOf(a)
        .slice(0, 3)
        .map((i) => i.text.slice(0, 220)),
    }));
    const res = await DFY.callBg({ type: 'llm-judge', items: payload, model: s.llmModel });
    if (!res || !res.ok) return; // 静默失败：下次精判机会留给 llmDone 之外的新账号
    for (const r of res.results || []) {
      const a = accounts.get(String(r.id));
      if (!a) continue;
      a.llm = { ai: Math.max(0, Math.min(100, +r.ai || 0)), reason: r.reason || '' };
      DFY.memory.llmPut(a.acc.mid, a.llm.ai, a.llm.reason);
      judge(a);
    }
    DFY.bump('llmCalls');
    C.render();
  };

  /* ---------------- 状态（popup 面板查询） ---------------- */
  C.hasComments = () => !!document.querySelector('bili-comments');
  C.stats = () => {
    const bands = [0, 0, 0, 0]; // 人类(<15) / 低疑(15~可疑线) / 可疑(~阈值) / 判鱼(≥阈值)
    let suspect = 0;
    const t = DFY.settings ? DFY.settings.threshold : 60;
    const susMin = Math.max(25, t - 25);
    for (const a of accounts.values()) {
      if (!a.verdict) continue;
      const sc = a.verdict.score;
      if (sc >= t) {
        bands[3]++;
        suspect++;
      } else if (sc >= susMin) {
        bands[2]++;
        suspect++;
      } else if (sc >= 15) bands[1]++;
      else bands[0]++;
    }
    return { accounts: accounts.size, items: items.size, fish: DFY.counter.total(), suspect, bands };
  };
})();
