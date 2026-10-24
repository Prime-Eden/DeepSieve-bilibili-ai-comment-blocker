/* 设置面板（清净版）：识别 / 屏蔽词 / DeepSeek / 名单 */
(async function () {
  const DFY = globalThis.DFY;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  if (location.search.includes('page') || window.innerWidth > 500) document.body.classList.add('page');

  let S = await DFY.store.get(['settings', 'blocklist', 'whitelist', 'customWords', 'seen']);

  /* 扩展指纹：装了两份（两套独立存储）时，两个面板的 ID 会不同，一眼分辨 */
  try {
    $('fp').textContent = `指纹 ${chrome.runtime.id.slice(0, 10)} · v${chrome.runtime.getManifest().version}`;
  } catch (e) {}

  /* 存储自检：绕过一切界面逻辑直读 chrome.storage 原始计数，专治「列表 0 但导入说已存在」这类灵异 */
  async function renderSelfCheck() {
    let bl = 0, wl = 0, rl = 0, il = 0;
    try {
      const o = await chrome.storage.local.get(['blocklist', 'whitelist', 'removedLog', 'importLog']);
      bl = o.blocklist && typeof o.blocklist === 'object' ? Object.keys(o.blocklist).length : 0;
      wl = o.whitelist && typeof o.whitelist === 'object' ? Object.keys(o.whitelist).length : 0;
      rl = Array.isArray(o.removedLog) ? o.removedLog.length : 0;
      il = Array.isArray(o.importLog) ? o.importLog.length : 0;
    } catch (e) {}
    $('selfcheck').textContent = `存储自检：屏蔽 ${bl} · 白名单 ${wl} · 总记录 ${rl} · 导入历史 ${il}`;
  }

  /* ---------- 分页（记住上次停留的页） ---------- */
  function showTab(name) {
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === name);
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.dataset.panel === name);
    try {
      localStorage.setItem('dfy-tab', name);
    } catch (e) {}
  }
  $('tabs').onclick = (e) => e.target.dataset.tab && showTab(e.target.dataset.tab);
  let lastTab = 'detect';
  try {
    lastTab = new URLSearchParams(location.search).get('tab') || localStorage.getItem('dfy-tab') || 'detect';
  } catch (e) {}
  showTab(lastTab);

  const save = () => DFY.store.set({ settings: S.settings });

  const SUB_HINT = {
    fish: '主楼是大肥鱼 → 隐藏主楼（楼中楼保留）；楼中楼里有大肥鱼 → 只隐藏那几条回复。',
    thread: '楼里出现任何一个大肥鱼账号（主楼或楼中楼）→ 整栋楼一起隐藏。',
    ignore: '只判定和隐藏一级评论，楼中楼原样保留。',
  };

  function renderSettings() {
    const s = S.settings;
    $('enabled').checked = !!s.enabled;
    $('showCount').checked = !!s.showCount;
    $('showBubble').checked = !!s.showBubble;
    $('llmEnabled').checked = !!s.llmEnabled;
    $('llmAuto').checked = !!s.llmAuto;
    $('llmVision').checked = !!s.llmVision;
    $('threshold').value = s.threshold;
    $('th-val').textContent = s.threshold + '%';
    $('th-hint').textContent = `评分 ≥ ${s.threshold}% 判为大肥鱼立即隐藏；${Math.max(25, s.threshold - 25)}% 起算可疑。低于阈值不会隐藏，可疑账号只作为 DeepSeek 复核候选。`;
    for (const b of $('sub-policy').children) b.classList.toggle('on', b.dataset.v === (s.subPolicy || 'fish'));
    $('sub-hint').textContent = SUB_HINT[s.subPolicy || 'fish'];
    $('llmKey').value = s.llmKey || '';
    $('llmModel').value = s.llmModel;
  }

  /* 屏蔽账号数直接从名单时间戳算（命中即入名单，天然去重） */
  function renderStats() {
    const today = new Date();
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    let n = 0;
    for (const v of Object.values(S.blocklist)) if ((v.t || 0) >= t0) n++;
    $('s-today').textContent = n;
    $('s-total').textContent = Object.keys(S.blocklist).length;
    $('s-seen').textContent = Object.keys(S.seen || {}).length;
    $('seen-n').textContent = Object.keys(S.seen || {}).length;
  }

  function renderWords() {
    const ws = S.customWords || [];
    $('words').innerHTML = ws.length
      ? ws.map((w) => `<span class="chip">${esc(w)}<i data-w="${esc(w)}" title="删除">×</i></span>`).join('')
      : '<span class="empty">还没有自定义屏蔽词</span>';
    $('words-n').textContent = `${ws.length} / 100 个词`;
  }

  /* ---------- 本页状态（设置页模式下也查询当前活动标签页，回收站/状态才能实时更新） ---------- */
  async function activeTab() {
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      return t;
    } catch (e) {
      return null;
    }
  }
  const ask = (tabId, msg) =>
    new Promise((ok) => {
      try {
        chrome.tabs.sendMessage(tabId, msg, (r) => {
          void chrome.runtime.lastError;
          ok(r || null);
        });
      } catch (e) {
        ok(null);
      }
    });
  let hereTab = null, hereSig = '';
  async function renderHere() {
    const tab = await activeTab();
    const st = tab && tab.id != null ? await ask(tab.id, { dfy: 'status' }) : null;
    hereTab = tab;
    let t, s, cls = '', btns = [];
    if (!st) {
      t = '这里不是 B 站';
      s = '切到 B 站标签页后这里会自动跟上';
      btns = [['open', '去 B 站', 'ghost']];
    } else if (!st.enabled) {
      t = '已停用';
      s = '打开右上角的开关立即恢复';
    } else if (st.fish) {
      cls = 'fish';
      t = `本页已清 ${st.fish} 条`;
      s = `扫描 ${st.accounts} 个账号 · 可疑 ${st.suspect}`;
      btns = [['rescan', '重新扫描', 'ghost']];
    } else if (st.comments && st.accounts) {
      t = '本页很干净';
      s = `扫描 ${st.accounts} 个账号 · 可疑 ${st.suspect}`;
      btns = [['rescan', '重新扫描', 'ghost']];
    } else if (st.space) {
      t = '空间主页';
      s = '鉴定卡片在页面右上角';
      btns = [['report', '打开鉴定卡片', '']];
    } else {
      t = '还没看到评论区';
      s = '滚到评论区自动开始识别';
    }
    // 分数分布（人类/低疑/可疑/判鱼）
    let bars = '';
    if (st && st.bands && (st.bands[0] + st.bands[1] + st.bands[2] + st.bands[3] > 0)) {
      const sum = st.bands[0] + st.bands[1] + st.bands[2] + st.bands[3];
      const labels = ['人类', '低疑', '可疑', '判鱼'];
      const colors = ['#c9ced8', '#e8c56a', '#e89a4a', '#e0566b'];
      bars = st.bands
        .map((n, i) => `<div class="band"><i style="width:${Math.round((n / sum) * 100)}%;background:${colors[i]}"></i>${labels[i]} ${n}</div>`)
        .join('');
    }
    const sig = JSON.stringify([t, s, cls, btns, bars]);
    if (sig === hereSig) return;
    hereSig = sig;
    $('here').className = 'here ' + cls;
    $('here-t').textContent = t;
    $('here-s').textContent = s;
    $('here-b').innerHTML = bars;
    $('here-btns').innerHTML = btns.map(([a, l, c]) => `<button class="btn ${c}" data-here="${a}">${l}</button>`).join('');
  }
  $('here-btns').onclick = async (e) => {
    const a = e.target.closest('[data-here]')?.dataset.here;
    if (!a) return;
    if (a === 'open') return chrome.tabs.create({ url: 'https://www.bilibili.com/' });
    if (!hereTab) return;
    await ask(hereTab.id, { dfy: a });
    window.close();
  };

  renderSettings();
  renderStats();
  renderLists(); // v2.0 重写时漏了这行：列表只在导入/删除后局部渲染，重开面板就是空白——「导入后刷新就没了」的真正元凶
  renderWords();
  renderHere();
  renderRemoved();
  renderRemovedAll();
  renderImportLog();
  renderSelfCheck();
  setInterval(() => {
    renderHere();
    renderRemoved();
  }, 1500);

  /* ---------- 本页回收站（误杀审计 + 导出） ---------- */
  let lastRemoved = [];
  async function renderRemoved() {
    const tab = hereTab || (await activeTab());
    if (!tab || tab.id == null) {
      $('rb-n').textContent = 0;
      $('rb').innerHTML = '<li class="empty">不在 B 站页面</li>';
      return;
    }
    const st = await ask(tab.id, { dfy: 'removed' });
    // 已恢复（进了白名单）的账号不再展示在记录里——「恢复没生效」的观感问题
    lastRemoved = ((st && st.items) || []).filter((x) => !(S.whitelist && S.whitelist[x.mid]));
    $('rb-n').textContent = lastRemoved.length;
    $('rb').innerHTML = lastRemoved.length
      ? lastRemoved
          .slice(0, 50)
          .map(
            (x) =>
              `<li><a class="n" href="https://space.bilibili.com/${esc(x.mid || '')}" target="_blank">${esc(x.name || x.mid || '未知账号')}</a><span class="d" title="${esc(x.text || '')}">${esc((x.text || '').slice(0, 18))}${x.src === 'api' ? ' · 拦截' : ''}</span><button data-rb="${esc(x.mid || '')}">恢复</button></li>`
          )
          .join('')
      : '<li class="empty">本页还没有隐藏过评论</li>';
  }
  $('rb-export').onclick = () => {
    if (!lastRemoved.length) return;
    const data = { app: 'dafeiyu-clean', exported: new Date().toISOString(), removed: lastRemoved };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `回收站-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  document.addEventListener('click', async (e) => {
    const rb = e.target.dataset && e.target.dataset.rb;
    if (!rb) return;
    const tab = hereTab;
    if (!tab || tab.id == null) return;
    await ask(tab.id, { dfy: 'restore', mid: rb });
    renderRemoved();
  });

  /* ---------- 隐藏总记录（跨页面跨会话持久化，removedLog） ---------- */
  let lastAll = [];
  async function renderRemovedAll() {
    try {
      const st = await DFY.store.get('removedLog');
      lastAll = Array.isArray(st) ? st : [];
    } catch (e) {
      lastAll = [];
    }
    $('rba-n').textContent = lastAll.length;
  }
  $('rba-export').onclick = () => {
    if (!lastAll.length) return;
    const data = { app: 'dafeiyu-clean', type: 'removed-all', exported: new Date().toISOString(), removed: lastAll };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `隐藏总记录-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  /* 总记录导入：格式自动路由——总记录格式合并总记录；名单格式自动转为名单导入 */
  $('rba-import-file').onchange = async () => {
    const f = $('rba-import-file').files[0];
    $('rba-import-file').value = '';
    if (!f) return;
    let j;
    try {
      j = JSON.parse(await f.text());
    } catch (e) {
      return note('文件不是合法 JSON', false);
    }
    const raw = Array.isArray(j) ? j : j && (j.removed || j.removedLog);
    if (Array.isArray(raw)) {
      const entries = normalizeRemoved(raw);
      if (!entries.length) return note('文件里没有可识别的记录', false);
      const res = await sendMsg({ type: 'rl-append', items: entries });
      if (!res || !res.ok) return note('导入失败：' + ((res && res.error) || '后台无响应'), false);
      renderRemovedAll();
      appendImportLog('总记录', res.added || 0, res.total || 0);
      return note(res.added ? `导入成功：新增 ${res.added} 条（现有共 ${res.total} 条）` : `都已存在，没有新增（现有共 ${res.total} 条）`, true);
    }
    if (j && (j.blocklist || j.whitelist)) {
      const bl = normalizeList(j.blocklist || {});
      const wl = normalizeList(j.whitelist || {});
      if (!Object.keys(bl).length && !Object.keys(wl).length) return note('这个文件里没有名单数据', false);
      const r = await mergeIntoLists(bl, wl);
      appendImportLog('名单', r.nb + r.nw, r.totalBl); // 此前这条路由漏记导入历史
      return note(`识别为名单文件：已并入屏蔽名单 ${r.nb} 条、白名单 ${r.nw} 条（现有屏蔽共 ${r.totalBl} 条）`, true);
    }
    note('无法识别这个 JSON 的类型（需要总记录或名单导出格式）', false);
  };
  confirm2($('rba-clear'), async () => {
    await sendMsg({ type: 'rl-clear' });
    lastAll = [];
    $('rba-n').textContent = 0;
  });

  /* ---------- 设置 ---------- */
  // Firefox 要求把网页内容发给第三方前取得用户授权，Chrome 不需要这一步
  function askConsent() {
    try {
      if (!chrome.runtime.getURL('').startsWith('moz-extension:')) return null;
      return chrome.permissions.request({ data_collection: ['websiteContent'] });
    } catch (e) {
      return null;
    }
  }
  for (const id of ['enabled', 'showCount', 'showBubble', 'llmEnabled', 'llmAuto', 'llmVision']) {
    $(id).onchange = () => {
      S.settings[id] = $(id).checked;
      save();
      if (id === 'llmEnabled' && S.settings.llmEnabled && !S.settings.llmKey) showTab('ds');
      const consent = id === 'llmEnabled' && S.settings.llmEnabled && askConsent();
      if (consent)
        consent.then(
          (ok) => {
            if (ok) return;
            S.settings.llmEnabled = false;
            $(id).checked = false;
            save();
          },
          () => {}
        );
    };
  }
  $('threshold').oninput = () => {
    S.settings.threshold = +$('threshold').value;
    $('th-val').textContent = S.settings.threshold + '%';
    $('th-hint').textContent = `评分 ≥ ${S.settings.threshold}% 判为大肥鱼立即隐藏；${Math.max(25, S.settings.threshold - 25)}% 起算可疑。低于阈值不会隐藏，可疑账号只作为 DeepSeek 复核候选。`;
  };
  $('threshold').onchange = save;
  $('sub-policy').onclick = (e) => {
    const v = e.target.dataset.v;
    if (!v) return;
    S.settings.subPolicy = v;
    save();
    renderSettings();
  };
  $('llmKey').onchange = () => {
    S.settings.llmKey = $('llmKey').value.trim();
    save();
  };
  $('llmModel').onchange = () => {
    S.settings.llmModel = $('llmModel').value;
    save();
  };
  $('eye').onclick = () => ($('llmKey').type = $('llmKey').type === 'password' ? 'text' : 'password');
  $('test').onclick = async () => {
    const key = $('llmKey').value.trim();
    const r = $('test-res');
    if (!key) {
      r.className = 'err';
      r.textContent = '先填密钥';
      return;
    }
    S.settings.llmKey = key;
    save();
    $('test').disabled = true;
    r.className = '';
    r.textContent = '正在连接……';
    const res = await new Promise((ok) => chrome.runtime.sendMessage({ type: 'llm-test', key, model: S.settings.llmModel }, ok));
    $('test').disabled = false;
    if (res && res.ok) {
      r.className = 'ok';
      r.textContent = `连接成功（${(res.ms / 1000).toFixed(1)}s）`;
    } else {
      r.className = 'err';
      r.textContent = (res && res.error) || '服务器繁忙，请稍后再试';
    }
  };

  /* ---------- 屏蔽词 ---------- */
  function addWord(raw) {
    const w = String(raw == null ? '' : raw).trim().slice(0, 24);
    if (!w) return { ok: false, msg: '词不能为空' };
    if ((S.customWords || []).length >= 100) return { ok: false, msg: '最多 100 个词' };
    if (S.customWords.some((x) => x.toLowerCase() === w.toLowerCase())) return { ok: false, msg: '这个已经有了' };
    S.customWords.push(w);
    return { ok: true };
  }
  function commitWord() {
    const r = addWord($('word-in').value);
    if (!r.ok) {
      $('words-n').textContent = r.msg;
      return;
    }
    $('word-in').value = '';
    DFY.store.set({ customWords: S.customWords });
    renderWords();
  }
  $('word-add').onclick = commitWord;
  $('word-in').onkeydown = (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      commitWord();
    }
  };
  $('words').onclick = (e) => {
    const w = e.target.dataset && e.target.dataset.w;
    if (!w) return;
    S.customWords = S.customWords.filter((x) => x !== w);
    DFY.store.set({ customWords: S.customWords });
    renderWords();
  };

  /* ---------- 名单 ---------- */
  /* ---------- 名单写操作统一走后台串行队列（popup/标签页/后台多写者，直写必竞态） ---------- */
  const sendMsg = (msg) =>
    new Promise((ok) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError;
          ok(r || null);
        });
      } catch (e) {
        ok(null);
      }
    });
  const refreshLists = async () => {
    const o = await DFY.store.get(['blocklist', 'whitelist']);
    S.blocklist = o.blocklist;
    S.whitelist = o.whitelist;
    renderLists();
    renderStats();
  };
  document.addEventListener('click', async (e) => {
    const un = e.target.dataset && e.target.dataset.un;
    const unw = e.target.dataset && e.target.dataset.unw;
    if (un) {
      await sendMsg({ type: 'bl-del', mid: un });
      await refreshLists();
    }
    if (unw) {
      await sendMsg({ type: 'wl-del', mid: unw });
      await refreshLists();
    }
  });
  /** 危险操作点两下才生效 */
  function confirm2(btn, fn) {
    const label = btn.textContent;
    btn.onclick = async () => {
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.textContent = '再点一下确认';
        clearTimeout(btn._t);
        btn._t = setTimeout(() => {
          btn.classList.remove('armed');
          btn.textContent = label;
        }, 2600);
        return;
      }
      clearTimeout(btn._t);
      btn.classList.remove('armed');
      btn.textContent = label;
      await fn();
    };
  }
  confirm2($('bl-clear'), async () => {
    await sendMsg({ type: 'bl-clear' });
    await refreshLists();
  });
  confirm2($('wl-clear'), async () => {
    await sendMsg({ type: 'wl-clear' });
    await refreshLists();
  });
  confirm2($('seen-clear'), async () => {
    S.seen = {};
    await DFY.store.set({ seen: {}, llmCache: {} });
    renderStats();
  });
  $('bl-q').oninput = renderLists;

  function renderLists() {
    const all = Object.entries(S.blocklist).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
    const q = $('bl-q').value.trim().toLowerCase();
    const bl = q ? all.filter(([mid, v]) => mid.includes(q) || String(v.n || '').toLowerCase().includes(q)) : all;
    $('bl-n').textContent = all.length;
    $('bl').innerHTML = bl.length
      ? bl
          .slice(0, 300)
          .map(
            ([mid, v]) =>
              `<li>${v.a ? `<img src="${esc(v.a.replace(/^http:/, 'https:'))}@52w_52h.webp" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<img alt="">'}<a class="n" href="https://space.bilibili.com/${esc(mid)}" target="_blank">${esc(v.n || mid)}</a><span class="d">${v.t ? new Date(v.t).toLocaleDateString() : '导入'}</span><button data-un="${esc(mid)}">移除</button></li>`
          )
          .join('')
      : `<li class="empty">${q ? '没有找到这条鱼' : '还没有屏蔽任何大肥鱼'}</li>`;
    const wl = Object.entries(S.whitelist).sort((a, b) => b[1].t - a[1].t);
    $('wl-n').textContent = wl.length;
    $('wl').innerHTML = wl.length
      ? wl.map(([mid, v]) => `<li><a class="n" href="https://space.bilibili.com/${esc(mid)}" target="_blank">${esc(v.n || mid)}</a><button data-unw="${esc(mid)}">移除</button></li>`).join('')
      : '<li class="empty">误判的人类可以在空间卡片上点「是人类」</li>';
  }

  /* ---------- 名单导入 / 导出（格式与原版完全兼容） ---------- */
  $('io-export').onclick = () => {
    const data = { app: 'dafeiyu-cleaner', v: 1, exported: new Date().toISOString(), blocklist: S.blocklist, whitelist: S.whitelist };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `大肥鱼名单-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  /** 支持本插件导出的格式，也支持 {mid: 名字} 或 [mid, ...] 这种简单名单 */
  function normalizeList(x) {
    const out = {};
    const put = (mid, v) => {
      mid = String(mid || '').trim();
      if (!/^\d{1,20}$/.test(mid)) return;
      out[mid] = typeof v === 'object' && v ? { n: String(v.n || v.name || v.uname || ''), a: String(v.a || v.avatar || ''), t: +v.t || Date.now() } : { n: typeof v === 'string' ? v : '', t: Date.now() };
    };
    if (Array.isArray(x)) for (const it of x) typeof it === 'object' && it ? put(it.mid || it.id, it) : put(it, '');
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) put(k, v);
    return out;
  }
  /* ---------- 导入：格式路由 + 结果反馈（拒绝一切静默失败） ---------- */
  let noteTimer = 0;
  function note(msg, ok = true) {
    let el = document.getElementById('dfy-note');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dfy-note';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'note' + (ok ? '' : ' err') + ' on';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => el.classList.remove('on'), 2800);
  }

  function normalizeRemoved(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((x) => x && typeof x === 'object' && String(x.id || '').trim())
      .map((x) => ({
        id: String(x.id).trim(),
        mid: String(x.mid || '').trim(),
        n: String(x.n || x.name || '').slice(0, 40),
        x: String(x.x || x.text || '').slice(0, 500),
        sc: x.sc == null ? null : Math.max(0, Math.min(99, +x.sc || 0)),
        f: Array.isArray(x.f) ? x.f.slice(0, 4).map((s) => String(s).slice(0, 60)) : [],
        src: ['api', 'dom', 'manual'].includes(x.src) ? x.src : 'dom',
        t: +x.t || Date.now(),
      }))
      .slice(0, 2000);
  }

  /** 名单合并写（后台队列），返回新增数与现有总数；失败带原因 */
  async function mergeIntoLists(bl, wl) {
    let nb = 0, nw = 0, totalBl = 0;
    if (Object.keys(wl).length) {
      const r1 = await sendMsg({ type: 'wl-add', entries: wl });
      if (!r1 || !r1.ok) return { error: (r1 && r1.error) || '后台无响应' };
      nw = r1.added || 0;
    }
    if (Object.keys(bl).length) {
      const r2 = await sendMsg({ type: 'bl-add', entries: bl });
      if (!r2 || !r2.ok) return { error: (r2 && r2.error) || '后台无响应' };
      nb = r2.added || 0;
      totalBl = r2.total || 0;
    }
    await refreshLists();
    return { nb, nw, totalBl };
  }
  async function appendImportLog(kind, added, total) {
    const r = await sendMsg({ type: 'il-append', kind, added, total });
    if (r && r.ok) renderImportLog();
  }
  async function renderImportLog() {
    let log = [];
    try {
      const st = await DFY.store.get('importLog');
      log = Array.isArray(st) ? st : [];
    } catch (e) {}
    $('ilh-n').textContent = log.length;
    $('ilh').innerHTML = log.length
      ? log
          .slice(0, 20)
          .map((x) => `<li><span class="n">${esc(x.kind || '导入')} · 新增 ${x.added || 0} 条</span><span class="d">${new Date(x.t).toLocaleString()} · 现有 ${x.total || 0}</span></li>`)
          .join('')
      : '<li class="empty">还没有导入过</li>';
  }

  $('io-import').onchange = async () => {
    const f = $('io-import').files[0];
    $('io-import').value = '';
    if (!f) return;
    let j;
    try {
      j = JSON.parse(await f.text());
    } catch (e) {
      return note('文件不是合法 JSON', false);
    }
    const bl = normalizeList(j && (j.blocklist || (j.whitelist ? null : j)));
    const wl = normalizeList(j && j.whitelist);
    if (!Object.keys(bl).length && !Object.keys(wl).length) return note('这个文件里没有名单数据', false);
    const r = await mergeIntoLists(bl, wl);
    if (r.error) return note('导入失败：' + r.error, false);
    note(nb || nw ? `导入成功：新增屏蔽 ${r.nb} 条、白名单 ${r.nw} 条（现有屏蔽共 ${r.totalBl} 条）` : '名单里都是老面孔，没有新增', true);
    appendImportLog('名单', r.nb + r.nw, r.totalBl);
  };

  DFY.store.onChange((ch) => {
    for (const k of ['blocklist', 'whitelist']) if (ch[k]) S[k] = Object.assign({}, DFY.DEFAULTS[k], ch[k]);
    if (ch.customWords) S.customWords = ch.customWords || [];
    if ('seen' in ch) S.seen = ch.seen || {};
    if (ch.removedLog) renderRemovedAll();
    if (ch.importLog) renderImportLog();
    if (ch.blocklist || ch.whitelist || ch.removedLog || ch.importLog || 'seen' in ch) renderSelfCheck();
    if (ch.blocklist || ch.whitelist) {
      renderLists();
      renderStats();
    }
    if (ch.customWords) renderWords();
    if ('seen' in ch) renderStats();
  });
})();
