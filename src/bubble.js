/* 悬浮控制台（默认关）：可拖动的扫帚圆钮 + 一站式控制台。
 * 与原版鲸鱼娘菜单的定位差异：不搞角色扮演，而是一块「控制台」——
 * 状态、分数分布、灵敏度预设、回收站审计、各项开关全在一处，点完即走。
 * 无形象、无动画、无音效；位置记忆（视口比例，随窗口大小自适应）。 */
(function () {
  const DFY = (globalThis.DFY = globalThis.DFY || {});

  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif}
.wrap{position:fixed;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.wrap.dock-l{align-items:flex-start}
.wrap.dock-l .dot{transform:translateX(-42%)}
.wrap.dock-r .dot{transform:translateX(42%)}
.wrap.dock-l:hover .dot,.wrap.dock-l.open .dot{transform:none}
.wrap.dock-r:hover .dot,.wrap.dock-r.open .dot{transform:none}
.wrap .dot.dragging{transform:scale(1.08)}
@media (prefers-reduced-motion: reduce){.menu.on{animation:none}.dot,.flash,.menu{transition:none!important}.dot.dragging{transform:none}}
.wrap.below .menu{bottom:auto;top:calc(100% + 10px)}
.dot{position:relative;width:42px;height:42px;border-radius:50%;background:#2546b8;color:#fff;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 0 0 2px rgba(255,255,255,.92),0 6px 18px rgba(20,28,60,.34);border:none;touch-action:none;user-select:none;transition:transform .12s ease,background .15s ease}
.dot:hover{background:#1d3a9c}
.dot:active{cursor:grabbing}
.dot.dragging{transform:scale(1.08);box-shadow:0 0 0 2px rgba(255,255,255,.95),0 12px 28px rgba(20,28,60,.42)}
.dot svg{display:block;pointer-events:none}
.badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e0566b;color:#fff;font:700 10.5px/18px -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;display:none;font-variant-numeric:tabular-nums}
.wrap.dock-r .badge{right:auto;left:-6px}
.kill{position:absolute;top:-7px;left:-7px;width:18px;height:18px;border-radius:50%;background:rgba(31,35,41,.92);color:#fff;border:none;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:11px;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,.35);padding:0}
.dot:hover .kill{display:flex}
.hint-bubble{position:absolute;right:0;bottom:calc(100% + 12px);white-space:nowrap;padding:8px 13px;border-radius:10px;background:#1f2329;color:#fff;font:500 12.5px/1.5 -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;transition:opacity .2s}
.hint-bubble b{color:#9db8ff;font-weight:700;margin-right:6px}
.wrap.below .hint-bubble{bottom:auto;top:calc(100% + 12px)}
.wrap.left-ex .hint-bubble{right:auto;left:0}
.flash{position:absolute;right:0;bottom:calc(100% + 12px);white-space:nowrap;padding:7px 12px;border-radius:9px;background:#1f2329;color:#9fe5bb;font:600 12px/1.5 -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;opacity:0;transition:opacity .2s}
.flash.on{opacity:1}
.wrap.below .flash{bottom:auto;top:calc(100% + 12px)}
.wrap.left-ex .menu{right:auto;left:0}
.wrap.left-ex .flash{right:auto;left:0}
.menu.on{animation:dfypop .14s cubic-bezier(.2,.9,.3,1)}
@keyframes dfypop{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}

/* 面板：颜色全部走变量，深色只改变量（旧写法 .dk .menu 永远选不中自己，深色底色失效） */
.menu{--ink:#1f2329;--mut:#667085;--faint:#98a2b3;--surface:#fff;--line:rgba(16,24,40,.08);--field:rgba(16,24,40,.06);--tint:rgba(37,70,184,.08);--tint-h:rgba(37,70,184,.14);--acc:#2546b8;--acc-h:#1d3a9c;--acc-t:#2546b8;--danger:#c2455a;
  position:absolute;right:0;bottom:calc(100% + 10px);width:276px;padding:14px;border-radius:16px;background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(16,24,40,.06),0 18px 40px -14px rgba(16,24,40,.32);color:var(--ink)}
.menu.dk{--ink:#eceef3;--mut:#a3a9b8;--faint:#7c8392;--surface:#25272d;--line:rgba(255,255,255,.1);--field:rgba(255,255,255,.08);--tint:rgba(143,176,255,.12);--tint-h:rgba(143,176,255,.2);--acc:#4a6ee0;--acc-h:#5b7be8;--acc-t:#9db8ff;--danger:#e0707f}
.hd{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.hd b{font-size:14px;font-weight:700}
.hd small{color:var(--faint);font-size:11px;font-variant-numeric:tabular-nums}
.hd .x{margin-left:auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--mut);font-size:17px;line-height:1;cursor:pointer}
.hd .x:hover{background:var(--field);color:var(--ink)}
.st{display:flex;align-items:baseline;gap:8px;margin-bottom:10px;font-size:12px;color:var(--mut)}
.st strong{font-size:24px;line-height:1;color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
.bands{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.band{position:relative;min-width:0;padding-top:8px;font-size:10.5px;line-height:16px;color:var(--mut);text-align:left;white-space:nowrap}
.band::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;border-radius:2px;background:var(--field)}
.band i{position:absolute;left:0;top:0;height:4px;min-width:3px;border-radius:2px;background:#c9ced8}
.band:nth-child(2) i{background:#e6c264}
.band:nth-child(3) i{background:#e8964a}
.band:nth-child(4) i{background:#e0566b}
.menu.dk .band:nth-child(1) i{background:#8a92a3}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.action{min-height:40px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 6px;border:0;border-radius:10px;background:var(--acc);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .12s ease}
.action:hover{background:var(--acc-h)}
.action.secondary{background:var(--tint);color:var(--acc-t)}
.action.secondary:hover{background:var(--tint-h)}
.action svg{flex:none;pointer-events:none}
.field{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.field-label{flex:none;font-size:11.5px;color:var(--mut)}
.seg{display:flex;gap:2px;flex:1;min-width:0;padding:2px;border-radius:9px;background:var(--field)}
.seg button{flex:1;border:0;background:none;border-radius:7px;padding:5px 0;font-size:11.5px;color:var(--mut);cursor:pointer;transition:background .12s ease,color .12s ease}
.seg button:hover{color:var(--ink)}
.seg button.on{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(16,24,40,.14)}
.menu.dk .seg button.on{background:rgba(255,255,255,.14);box-shadow:none}
.learn{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:6px 10px;border-radius:9px;background:var(--tint);font-size:11px;color:var(--mut)}
.learn .lt{flex:none;color:var(--acc-t);font-weight:600}
.learn .lv{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.space-link{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;margin:0 0 10px;padding:6px 0;border:0;border-radius:9px;background:var(--tint);color:var(--acc-t);font-size:11.5px;cursor:pointer}
.space-link:hover{background:var(--tint-h)}
.recent{border-top:1px solid var(--line);padding-top:10px}
.recent-hd{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11.5px;color:var(--mut)}
.recent-hd .rc{color:var(--faint);font-variant-numeric:tabular-nums}
.recent-hd button{margin-left:auto;border:0;background:none;color:var(--acc-t);font-size:11.5px;cursor:pointer;padding:0}
.recent-hd button:hover{text-decoration:underline}
.rb{display:flex;align-items:center;gap:8px;padding:5px 6px;margin:0 -6px;border-radius:8px;font-size:12px;line-height:1.5}
.rb:hover{background:var(--field)}
.rb .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rb .txt{color:var(--faint)}
.rb button{flex:none;border:0;background:none;color:var(--acc-t);font-size:11.5px;cursor:pointer;padding:0 2px}
.rb button:hover{text-decoration:underline}
.empty{font-size:11.5px;color:var(--faint);padding:4px 0 6px}
.tools{display:flex;align-items:center;gap:4px;margin-top:8px;padding-top:10px;border-top:1px solid var(--line)}
.tool{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:transparent;color:var(--mut);cursor:pointer}
.tool:hover{background:var(--field);color:var(--ink)}
.tool.on{color:var(--acc-t);background:var(--tint)}
.tool.end{margin-left:auto}
.tool svg{pointer-events:none}
`;

  let host = null, root = null, wrap = null, menu = null, dot = null, badge = null, hintEl = null, hintTimer = 0;
  let open = false, pos = { x: 0, y: 0 }, dragged = false;
  let dragActive = false; // pointerdown 起为真：挂起 loadPos/resize 的位置重放，杜绝拖动中瞬移
  let lastHref = location.href;

  const SIZE = 42, MARGIN = 8;
  const dark = () => /dark/.test(document.documentElement.className || '') || document.documentElement.getAttribute('data-theme') === 'dark';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ver = () => {
    try {
      return chrome.runtime.getManifest().version;
    } catch (e) {
      return '';
    }
  };

  function clampPoint(x, y) {
    const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
    return { x: Math.min(Math.max(MARGIN, x), maxX), y: Math.min(Math.max(MARGIN, y), maxY) };
  }

  function applyPos(x, y) {
    pos = clampPoint(x, y);
    wrap.style.left = pos.x + 'px';
    wrap.style.top = pos.y + 'px';
    wrap.classList.toggle('below', pos.y < 340); // 顶部空间不足时菜单翻到按钮下方
    // 贴边吸附：靠左右边缘时圆钮半收进屏幕，悬停或菜单打开时弹出（位置数据不变，纯渲染态）
    wrap.classList.toggle('left-ex', pos.x < 258 + MARGIN + 12);
    wrap.classList.toggle('dock-l', pos.x <= MARGIN + 4);
    wrap.classList.toggle('dock-r', pos.x >= window.innerWidth - SIZE - MARGIN - 4);
  }

  async function loadPos() {
    if (dragActive) return; // 拖动中：位置由手说了算，存储重放不许插队（瞬移根因）
    let p = null;
    try {
      p = (await DFY.store.get('bubblePos')) || null;
    } catch (e) {}
    const x = p && p.x > 0 ? p.x * window.innerWidth : window.innerWidth - SIZE - 16;
    const y = p && p.y > 0 ? p.y * window.innerHeight : window.innerHeight - SIZE - 110;
    applyPos(x, y);
  }

  /** 位置按视口比例记忆：换分辨率也能落在同一个相对位置（同原版鲸鱼娘的做法） */
  function savePos() {
    DFY.store.set({ bubblePos: { x: +(pos.x / window.innerWidth).toFixed(4), y: +(pos.y / window.innerHeight).toFixed(4) } });
  }

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('dfy-bubble');
    root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    wrap = document.createElement('div');
    wrap.className = 'wrap';
    menu = document.createElement('div');
    menu.className = 'menu';
    menu.style.display = 'none';
    menuSig = ''; // 新节点必须重置签名，否则首帧会被判「没变化」而渲染空白
    dot = document.createElement('button');
    dot.className = 'dot';
    dot.title = 'DeepSieve（可拖动）';
    dot.innerHTML = DFY.icon('broom', 20, 2.2);
    badge = document.createElement('span');
    badge.className = 'badge';
    dot.appendChild(badge);
    const kill = document.createElement('button');
    kill.className = 'kill';
    kill.title = '收起悬浮台';
    kill.textContent = '×';
    // 悬停圆钮出现的叉号：直接收起（设置里可再开）；阻止冒泡避免触发拖动/开菜单
    kill.addEventListener('pointerdown', (e) => e.stopPropagation());
    kill.addEventListener('pointerup', (e) => e.stopPropagation());
    kill.addEventListener('click', async (e) => {
      e.stopPropagation();
      await DFY.store.patch('settings', (s) => {
        s.showBubble = false;
      });
    });
    dot.appendChild(kill);
    wrap.appendChild(menu);
    wrap.appendChild(dot);
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
    bindDot();
    bindMenu(); // menu 每次重建都要重绑（旧节点随 host.remove() 一起丢弃）
    loadPos();
  }

  /* 拖动：pointer 事件 + 5px 位移阈值区分「拖」和「点」 */
  function bindDot() {
    let sx = 0, sy = 0, ox = 0, oy = 0, down = false;
    dot.addEventListener('pointerdown', (e) => {
      down = true;
      dragActive = true;
      dragged = false;
      sx = e.clientX;
      sy = e.clientY;
      ox = pos.x;
      oy = pos.y;
      try {
        dot.setPointerCapture(e.pointerId);
      } catch (err) {}
      e.preventDefault();
    });
    dot.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      if (!dragged) {
        dragged = true;
        dot.classList.add('dragging'); // 拖起动效：放大 + 深投影（transform 不碰 left/top，零延迟）
        close(); // 拖动时若菜单开着先收起
      }
      applyPos(ox + dx, oy + dy);
    });
    dot.addEventListener('pointerup', (e) => {
      down = false;
      dragActive = false;
      dot.classList.remove('dragging');
      try {
        dot.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (dragged) {
        savePos();
        return;
      }
      toggle();
    });
    dot.addEventListener('pointercancel', () => {
      down = false;
      dragActive = false;
      dot.classList.remove('dragging');
    });
  }

  function close() {
    open = false;
    if (wrap) wrap.classList.remove('open');
    if (menu) {
      menu.style.display = 'none';
      menu.classList.remove('on');
    }
  }

  /** 首次显示的一次性提示：只出现一次（bubbleHinted 落盘），点按钮或 6 秒后消失 */
  async function maybeShowHint() {
    try {
      if (await DFY.store.get('bubbleHinted')) return;
      await DFY.store.set({ bubbleHinted: true });
    } catch (e) {
      return;
    }
    if (!root || !host || !host.isConnected) return;
    hintEl = document.createElement('div');
    hintEl.className = 'hint-bubble';
    hintEl.innerHTML = '<b>悬浮台</b>可拖动，点击展开';
    wrap.appendChild(hintEl);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(dismissHint, 6000);
  }

  function dismissHint() {
    clearTimeout(hintTimer);
    if (!hintEl) return;
    const el = hintEl;
    hintEl = null;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }

  function toggle() {
    open = !open;
    dismissHint();
    if (wrap) wrap.classList.toggle('open', open);
    if (open) {
      renderMenu();
      if (menu) {
        menu.style.display = '';
        menu.classList.add('on');
      }
    } else if (menu) {
      menu.style.display = 'none';
      menu.classList.remove('on');
    }
    requestAnimationFrame(positionMenu);
  }

  /** 菜单视口钳制：无论按钮拖到哪，菜单都完整留在屏幕内（贴边自动内收，上下放不下自动翻转） */
  function positionMenu() {
    if (!open || !menu) return;
    const r = menu.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (r.left < MARGIN) dx = MARGIN - r.left;
    else if (r.right > window.innerWidth - MARGIN) dx = window.innerWidth - MARGIN - r.right;
    if (r.top < MARGIN) dy = MARGIN - r.top;
    else if (r.bottom > window.innerHeight - MARGIN) dy = window.innerHeight - MARGIN - r.bottom;
    menu.style.transform = dx || dy ? `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` : '';
  }

  function statsSafe() {
    try {
      return DFY.comments.stats() || {};
    } catch (e) {
      return {};
    }
  }

  const PRESETS = [
    { t: 70, label: '宽松' },
    { t: 60, label: '标准' },
    { t: 50, label: '严格' },
  ];
  const BAND_COLORS = ['#c9ced8', '#e8c56a', '#e89a4a', '#e0566b'];
  const BAND_LABELS = ['人类', '低疑', '可疑', '判鱼'];

  let menuSig = '';
  function renderMenu() {
    if (!menu) return;
    const s = statsSafe();
    const n = DFY.counter.total();
    const th = (DFY.settings && DFY.settings.threshold) || 60;
    const bands = s.bands || [0, 0, 0, 0];
    const sum = bands[0] + bands[1] + bands[2] + bands[3];
    const allRemoved = DFY.comments.removedList ? DFY.comments.removedList() : [];
    const recent = allRemoved.slice(0, 3);
    const enabled = !!(DFY.settings && DFY.settings.enabled);
    const showCount = !!(DFY.settings && DFY.settings.showCount);
    const ms = DFY.manualStats || {};
    const mKeys = Object.keys(ms).sort((a, b) => ms[b] - ms[a]);
    const mCount = mKeys.reduce((s2, k) => s2 + ms[k], 0);
    // 签名对比：内容没变就一个字都不写；记录 ID 一并纳入，保证恢复/替换后也会刷新
    const sig = JSON.stringify([n, s.accounts || 0, bands.join(','), th, enabled, showCount, allRemoved.length, recent.map((x) => x.id).join(','), mCount, mKeys.slice(0, 2).join(','), ver(), dark()]);
    if (sig === menuSig) return;
    menuSig = sig;
    menu.classList.toggle('dk', dark());
    // 骨架只建一次，后续全部定点更新——点击目标不再被整块 innerHTML 替换（吞点击根治）
    if (!menu.querySelector('.hd')) {
      menu.innerHTML = `
<div class="hd"><b>清扫台</b><small class="vv"></small><button class="x" data-a="close" title="关闭菜单" aria-label="关闭菜单">×</button></div>
<div class="st"><strong class="sn"></strong><span class="scan"></span></div>
<div class="bands">${'<div class="band"><i></i><span class="bn"></span></div>'.repeat(4)}</div>
<div class="actions">
  <button class="action" data-a="clear">${DFY.icon('broom', 16, 2.2)}<span>清扫本页</span></button>
  <button class="action secondary" data-a="box">${DFY.icon('frame', 16, 2)}<span>框选屏蔽</span></button>
</div>
<div class="field"><span class="field-label">灵敏度</span><div class="seg">${PRESETS.map((p2) => `<button data-th="${p2.t}" title="隐藏门槛 ${p2.t}%：嫌疑分达到才隐藏，越严格门槛越低">${p2.label}</button>`).join('')}</div></div>
<div class="learn" style="display:none"><span class="lt">人工强化</span><span class="lv"></span></div>
<div class="recent"><div class="recent-hd"><span>最近隐藏</span><span class="rc"></span><button data-a="all" title="在设置页查看全部记录">全部记录 ↗</button></div><div class="rlist"></div></div>
<div class="tools">
  <button class="tool" data-a="rescan" title="重新扫描本页">${DFY.icon('search', 16, 2)}</button>
  <button class="tool" data-a="count" title="已清计数条">${DFY.icon('report', 16, 2)}</button>
  <button class="tool" data-a="toggle" title="暂停屏蔽">${DFY.icon('pause', 16, 2)}</button>
  <button class="tool" data-a="cfg" title="打开设置面板">${DFY.icon('gear', 16, 2)}</button>
  <button class="tool end" data-a="hidebubble" title="收起悬浮台（设置里可再开）">${DFY.icon('minus', 16, 2)}</button>
</div>`;
    }
    const q = (sel) => menu.querySelector(sel);
    q('.vv').textContent = 'v' + ver();
    q('.sn').textContent = n;
    q('.scan').textContent = `条已清 · 扫描 ${s.accounts || 0} 账号`;
    const bEls = menu.querySelectorAll('.band');
    bEls.forEach((b, i2) => {
      b.querySelector('i').style.width = sum ? Math.round((bands[i2] / sum) * 100) + '%' : '0%';
      b.querySelector('.bn').textContent = `${BAND_LABELS[i2]} ${bands[i2]}`;
    });
    menu.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', +b.dataset.th === th));
    const learn = q('.learn');
    learn.style.display = mKeys.length ? '' : 'none';
    if (mKeys.length) q('.lv').textContent = `裁决 ${mCount} 次 · ${mKeys.slice(0, 2).map((k) => `${k.length > 9 ? k.slice(0, 9) + '…' : k} ×${ms[k]}`).join(' · ')}`;
    q('.rc').textContent = allRemoved.length ? `${allRemoved.length} 条` : '';
    const recentHtml = recent.length
      ? recent
          .map(
            (x) =>
              `<div class="rb" title="${esc((x.text || '') + '（' + (x.src === 'api' ? '接口拦截' : '页面隐藏') + '）')}"><span class="t">${esc(x.name || x.mid || '?')}<span class="txt"> · ${esc((x.text || '').slice(0, 16))}</span></span><button data-rb="${esc(x.mid || '')}" title="恢复该账号">恢复</button></div>`
          )
          .join('')
      : '<div class="empty">本页还没有隐藏过评论</div>';
    const rlist = q('.rlist');
    if (rlist.dataset.v !== recentHtml) {
      rlist.dataset.v = recentHtml;
      rlist.innerHTML = recentHtml;
    }
    const tCount = q('[data-a="count"]');
    const tToggle = q('[data-a="toggle"]');
    tCount.classList.toggle('on', showCount);
    tCount.title = `已清计数条：${showCount ? '开（点击关闭）' : '关（点击开启）'}`;
    tToggle.classList.toggle('on', !enabled);
    tToggle.title = enabled ? '暂停屏蔽' : '恢复屏蔽';
    if (tToggle.dataset.v !== String(enabled)) {
      tToggle.dataset.v = String(enabled);
      tToggle.innerHTML = DFY.icon(enabled ? 'pause' : 'play', 16, 2);
    }
    requestAnimationFrame(positionMenu); // 内容变化后重新钳制视口
  }

  function bindMenu() {
    menu.addEventListener('click', async (e) => {
      const thBtn = e.target.closest('[data-th]');
      if (thBtn) {
        e.stopPropagation();
        const t = +thBtn.dataset.th;
        await DFY.store.patch('settings', (s) => {
          s.threshold = t;
        });
        renderMenu();
        return;
      }
      const rb = e.target.closest('[data-rb]');
      if (rb) {
        e.stopPropagation();
        await DFY.comments.restore(rb.dataset.rb);
        renderMenu();
        return;
      }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      e.stopPropagation();
      const act = a.dataset.a;
      // 普通操作原地生效并保留菜单；只有需要离开当前交互的动作才关闭
      if (act === 'close') {
        close();
        return;
      }
      if (act === 'clear') DFY.comments.clear();
      else if (act === 'box') {
        close();
        DFY.comments.boxSelect && DFY.comments.boxSelect();
        return;
      } else if (act === 'rescan') DFY.comments.rescan();
      else if (act === 'cfg') {
        DFY.callBg({ type: 'open-options' });
        close();
        return;
      } else if (act === 'all') {
        DFY.callBg({ type: 'open-options', tab: 'lists' });
        close();
        return;
      } else if (act === 'count') {
        await DFY.store.patch('settings', (s) => {
          s.showCount = !s.showCount;
        });
      } else if (act === 'hidebubble') {
        close();
        await DFY.store.patch('settings', (s) => {
          s.showBubble = false;
        });
        return;
      } else if (act === 'toggle') {
        await DFY.store.patch('settings', (s) => {
          s.enabled = !s.enabled;
        });
      }
      renderMenu();
    });
  }

  // 点外面 / Esc 关闭
  document.addEventListener('click', (e) => {
    if (open && host && !e.composedPath().includes(host)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) close();
  });

  /** 圆钮上的已清计数徽标（>0 才显示） */
  function updateBadge() {
    if (!badge) return;
    const n = DFY.counter.total();
    badge.textContent = n > 99 ? '99+' : n > 0 ? String(n) : '';
    badge.style.display = n > 0 ? 'block' : 'none';
  }

  /** 手动拉黑后的即时反馈：圆钮上方闪现「已拉黑 · 特征强化」（菜单开着时不弹，菜单数字即反馈） */
  let flashEl = null, flashTimer = 0;
  function flash(text) {
    if (!wrap || open) return;
    dismissHint();
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.className = 'flash';
      wrap.appendChild(flashEl);
    }
    flashEl.textContent = text;
    flashEl.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl && flashEl.classList.remove('on'), 2200);
  }

  // 打开期间轻刷数字（计数/分布/回收站都是内存读，开销可忽略）；徽标常驻刷新
  /** 悬浮台只在视频页出现（www.bilibili.com/video/*）；动态页/首页等不显示，屏蔽引擎照常工作 */
  function isVideoPage() {
    return location.hostname === 'www.bilibili.com' && /^\/video\//.test(location.pathname);
  }

  function routeSync() {
    if (!isVideoPage()) {
      if (host) {
        close(); // 真正离开视频页才重置开合状态，防止回来出现「open=true 但菜单不可见」
        host.remove();
      }
    } else if (DFY.settings && DFY.settings.showBubble) {
      ensure();
    }
  }

  // 内存优先：悬浮台不在页面时定时器空转直接跳过；菜单没开就不重渲染
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      routeSync(); // SPA 路由切换：离开视频页收起，进来再现
    }
    if (!(host && host.isConnected)) return;
    updateBadge();
    if (open && menu) {
      renderMenu();
      positionMenu();
    }
  }, 1500);

  // 窗口尺寸变化时把按钮夹回视口内，菜单重新钳制（拖动中不插队）
  window.addEventListener('resize', () => {
    if (dragActive) return;
    if (wrap && pos) applyPos(pos.x, pos.y);
    positionMenu();
  });

  /** 由 content.js 在设置加载后与每次设置变化时调用。
   * 注意：只看 showBubble，不看 enabled——暂停屏蔽时悬浮台要留着，方便原地恢复。 */
  DFY.bubble = {
    flash,
    /** 只管显示/隐藏；绝不动菜单开合状态——菜单被随机关闭的元凶就是这里曾经的 close() */
    sync() {
      if (DFY.settings && DFY.settings.showBubble && isVideoPage()) {
        ensure();
        maybeShowHint();
      } else if (host) {
        close(); // 仅在真正隐藏悬浮台时重置；普通存储写入不会走到这里
        host.remove();
      }
    },
  };
})();