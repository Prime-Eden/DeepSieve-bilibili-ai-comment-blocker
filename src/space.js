/* 空间主页鉴定（简版）：资料 + 投稿节奏 + 头像 +（可选）DeepSeek 精判。
 * 输出 = 右上角一张安静的小卡片：结论、依据、屏蔽 / 白名单按钮。无印章、无动画、无音效。 */
(function () {
  const DFY = (globalThis.DFY = globalThis.DFY || {});
  const S = (DFY.space = {});
  const esc = (s) => DFY.esc(s);

  S.midFromUrl = function (u) {
    try {
      const url = new URL(u || location.href);
      if (url.hostname !== 'space.bilibili.com') return '';
      const m = url.pathname.match(/\/(\d{2,})(?:\/|$)/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  };

  async function getJSON(url) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  function fmtNum(n) {
    n = +n || 0;
    return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
  }

  /** 拉取资料并做离线鉴定 */
  S.inspect = async function (mid) {
    const [card, arc] = await Promise.all([
      getJSON(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=false`),
      getJSON(`https://api.bilibili.com/x/series/recArchivesByKeywords?mid=${mid}&keywords=&ps=30&pn=1&orderby=pubdate`),
    ]);
    const c = card && card.code === 0 && card.data ? card.data.card : null;
    if (!c) return null;
    const prof = {
      mid,
      uname: c.name,
      avatar: c.face,
      sign: c.sign || '',
      level: (c.level_info && c.level_info.current_level) || 0,
      verify: c.official_verify ? c.official_verify.type : -1,
      verifyDesc: (c.official_verify && c.official_verify.desc) || '',
      fans: card.data.follower || c.fans || 0,
      archives: card.data.archive_count || 0,
      videos: ((arc && arc.code === 0 && arc.data && arc.data.archives) || []).map((v) => ({ title: v.title, t: v.pubdate || v.ctime })),
    };
    prof.avatarBlue = await DFY.avatarBlue(prof.avatar);
    const base = DFY.scoreAccount(prof);
    let s = base.score;
    const reasons = base.reasons.slice();
    const now = Date.now() / 1000;
    const recent = prof.videos.filter((v) => now - v.t < 14 * 86400);
    if (recent.length) {
      const first = Math.min(...recent.map((v) => v.t));
      const days = Math.max(1, (now - first) / 86400);
      const perDay = recent.length / days;
      if (perDay >= 3) {
        s += 25;
        reasons.push({ w: 25, why: `日更 ${perDay.toFixed(1)} 条，频率异常` });
      } else if (perDay >= 0.9 && recent.length >= 4) {
        s += 12;
        reasons.push({ w: 12, why: `近两周 ${recent.length} 条，几乎天天更` });
      }
    }
    if (prof.videos.length >= 3) {
      const aiTitles = prof.videos.filter((v) => /deep\s*seek|鲸鱼娘|大肥鱼|白饭|\bAI\b|AIGC|大模型|本鲸/i.test(v.title)).length;
      const ratio = aiTitles / prof.videos.length;
      if (ratio >= 0.4) {
        s += 12;
        reasons.push({ w: 12, why: `${Math.round(ratio * 100)}% 的投稿都在聊 AI / 鲸鱼话题` });
      }
      const series = prof.videos.filter((v) => /【?Day\s*\d+|第\s*\d+\s*天|\bD\d+\b/i.test(v.title)).length;
      if (series >= 3) {
        s += 8;
        reasons.push({ w: 8, why: '「Day N」流水线日更' });
      }
    }
    if (prof.level <= 2 && prof.fans >= 10000) {
      s += 6;
      reasons.push({ w: 6, why: `Lv${prof.level} 却有 ${fmtNum(prof.fans)} 粉` });
    }
    if (prof.verify === 0 || prof.verify === 1) reasons.push({ w: 0, why: `认证：${prof.verifyDesc}` });
    const score = Math.max(0, Math.min(99, Math.round(s)));
    return { prof, score, offline: score, reasons: reasons.filter((r) => r.w !== 0 || r.why.startsWith('认证')).sort((a, b) => b.w - a.w) };
  };

  /* ---------------- 右上角小卡片 ---------------- */
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.c{position:fixed;top:76px;right:18px;z-index:2147483000;width:324px;padding:14px 16px;border-radius:12px;
  background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 16px 40px -18px rgba(0,0,0,.3);
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2329}
.dk .c,.c.dk{background:#26262c;border-color:rgba(255,255,255,.1);color:#f0f0f4}
.hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.hd b{font-size:13.5px}
.hd .x{margin-left:auto;cursor:pointer;color:#8b8b94;font-size:16px;line-height:1;padding:2px 4px;border-radius:6px}
.hd .x:hover{background:rgba(0,0,0,.06)}
.who{display:flex;gap:10px;align-items:center}
.who img{width:44px;height:44px;border-radius:50%;flex:none}
.nm{font-weight:600;font-size:14px}
.meta{color:#8b8b94;font-size:12px}
.gauge{margin:10px 0 6px;height:6px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden}
.gauge i{display:block;height:100%;background:#e0566b;border-radius:3px;transition:width .4s ease}
.dk .gauge{background:rgba(255,255,255,.1)}
.lv{font-size:12.5px;margin-bottom:6px}
.lv b{color:#e0566b}
ul{list-style:none;margin:6px 0 10px}
li{display:flex;gap:8px;padding:2px 0;color:#5b6378;font-size:12.3px}
.dk li{color:#b6bcc8}
li b{flex:none;min-width:30px;text-align:right;font-weight:600;color:#c2455a}
li b.neg{color:#1a9e6c}
.llm{margin:6px 0 10px;padding:8px 10px;border-radius:8px;background:rgba(37,70,184,.07);font-size:12.3px}
.dk .llm{background:rgba(255,255,255,.07)}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button{all:unset;cursor:pointer;padding:4px 12px;border-radius:8px;font-size:12.5px;border:1px solid rgba(0,0,0,.14)}
button:hover{background:rgba(0,0,0,.05)}
.dk button{border-color:rgba(255,255,255,.16)}
.dk button:hover{background:rgba(255,255,255,.08)}
button.pri{background:#2546b8;border-color:#2546b8;color:#fff}
button.pri:hover{background:#1d3a9c}
button.danger{background:#e0566b;border-color:#e0566b;color:#fff}
button.danger:hover{background:#c9455a}
.notice{margin-bottom:8px;padding:6px 10px;border-radius:8px;background:rgba(224,86,107,.1);font-size:12.3px}
.empty{color:#8b8b94}`;

  let host = null, root = null, card = null, current = null, running = false;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('dfy-space-card');
    root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    card = document.createElement('div');
    card.className = 'c';
    root.appendChild(card);
    (document.body || document.documentElement).appendChild(host);
  }

  function levelInfo(score) {
    const lv = DFY.levelOf(score, DFY.settings.threshold);
    return {
      lv,
      label: lv === 'fish' ? '疑似 AI 账号' : lv === 'suspect' ? '可疑账号' : '未发现 AI 特征',
    };
  }

  function render(r, state = {}) {
    ensureHost();
    const p = r.prof;
    const info = levelInfo(r.score);
    const blocked = DFY.lists.block[p.mid];
    const white = DFY.lists.white[p.mid];
    const dk = /dark/.test(document.documentElement.className || '') || document.documentElement.getAttribute('data-theme') === 'dark';
    card.classList.toggle('dk', dk);
    const ev = r.reasons
      .slice(0, 6)
      .map((x) => `<li><b>${x.w ? (x.w > 0 ? '+' : '') + x.w : '·'}</b><span>${esc(x.why)}</span></li>`)
      .join('');
    const canLLM = DFY.settings.llmEnabled && DFY.settings.llmKey && DFY.canLLM;
    const llm = r.llm
      ? `<div class="llm">DeepSeek：AI 概率 ${r.llm.ai}% · ${esc(r.llm.reason || '')}${r.llm.cached ? '（7 天内判过）' : ''}</div>`
      : state.llmLoading
        ? '<div class="llm">DeepSeek 正在分析该账号……</div>'
        : '';
    const btns = [];
    if (blocked) btns.push('<button class="pri" data-a="unblock">取消屏蔽</button>');
    else if (info.lv !== 'human') btns.push('<button class="danger" data-a="block">屏蔽此账号</button>');
    if (canLLM && !r.llm && !state.llmLoading) btns.push('<button data-a="llm">DeepSeek 精判</button>');
    if (!canLLM) btns.push('<button data-a="cfg">配置精判</button>');
    if (!white && info.lv !== 'human') btns.push('<button data-a="white">是人类</button>');
    card.innerHTML = `
<div class="hd"><b>账号鉴定</b><span class="meta">UID ${esc(p.mid)}</span><span class="x" data-a="close" title="关闭">×</span></div>
${blocked ? `<div class="notice">已在屏蔽名单 · 该账号的评论会被自动隐藏</div>` : white ? `<div class="notice">在白名单里，不会被处理</div>` : ''}
<div class="who"><img src="${esc((p.avatar || '').replace(/^http:/, 'https:'))}@132w_132h.webp" referrerpolicy="no-referrer"><div><div class="nm">${esc(p.uname)}</div><div class="meta">Lv${p.level} · ${fmtNum(p.fans)} 粉丝 · 投稿 ${p.archives}</div></div></div>
<div class="gauge"><i style="width:${r.score}%"></i></div>
<div class="lv"><b>${r.score}%</b> · ${blocked ? '已屏蔽' : info.label}</div>
<ul>${ev || '<li class="empty">没有发现 AI 特征</li>'}</ul>
${llm}
<div class="btns">${btns.join('')}</div>`;
    card.style.display = '';
  }

  card.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]');
    if (!a || !current) return;
    const act = a.dataset.a;
    const p = current.prof;
    if (act === 'close') {
      card.style.display = 'none';
    } else if (act === 'block') {
      if (DFY.callBg) await DFY.callBg({ type: 'bl-promote', mid: p.mid, name: p.uname, avatar: p.avatar, score: current.score });
      DFY.lists.block[p.mid] = { t: Date.now() };
      delete DFY.lists.white[p.mid];
      current.score = Math.max(current.score, 99);
      render(current);
    } else if (act === 'unblock') {
      if (DFY.callBg) await DFY.callBg({ type: 'bl-del', mid: p.mid });
      delete DFY.lists.block[p.mid];
      render(current);
    } else if (act === 'white') {
      if (DFY.callBg) await DFY.callBg({ type: 'wl-promote', mid: p.mid, name: p.uname });
      DFY.lists.white[p.mid] = { n: p.uname };
      current.score = 0;
      current.reasons.unshift({ w: -99, why: '你标记过这位是人类' });
      render(current);
    } else if (act === 'llm') {
      S.llm(current);
    } else if (act === 'cfg') {
      DFY.callBg({ type: 'open-options' });
    }
  });

  S.llm = async function (r) {
    render(r, { llmLoading: true });
    const res = await DFY.callBg({
      type: 'llm-space',
      model: DFY.settings.llmModel,
      vision: DFY.settings.llmVision,
      profile: {
        name: r.prof.uname,
        level: r.prof.level,
        sign: r.prof.sign,
        fans: r.prof.fans,
        archives: r.prof.archives,
        verify: r.prof.verifyDesc,
        recentTitles: r.prof.videos.slice(0, 12).map((v) => v.title),
        avatar: r.prof.avatar,
      },
    });
    if (!res || !res.ok) {
      render(r, {});
      return;
    }
    const j = res.result || {};
    r.llm = { ai: Math.max(0, Math.min(100, +j.ai || 0)), reason: j.reason || '' };
    if (j.avatar != null) r.reasons.push({ w: 0, why: `DeepSeek 看了头像：${j.avatar}` });
    r.score = DFY.lists.white[r.prof.mid] ? 0 : Math.round(r.offline * 0.3 + r.llm.ai * 0.7);
    DFY.bump('llmCalls');
    render(r);
  };

  S.run = async function (force) {
    const mid = S.midFromUrl();
    if (!mid || running) return;
    if (!force && current && current.prof.mid === mid) return;
    running = true;
    try {
      if (host && host.isConnected) host.remove();
      const r = await S.inspect(mid);
      if (!r) return;
      if (DFY.lists.white[mid]) {
        r.score = 0;
        r.reasons.unshift({ w: -99, why: '你标记过这位是人类' });
      }
      const cached = DFY.settings.llmEnabled && DFY.settings.llmKey ? DFY.memory.llmGet(mid) : null;
      if (cached) r.llm = { ai: cached.ai, reason: cached.r, cached: true }, (r.score = Math.round(r.offline * 0.3 + r.llm.ai * 0.7));
      current = r;
      render(r);
      DFY.bump('verdicts');
      const s = DFY.settings;
      if (s.llmEnabled && s.llmKey && s.llmAuto && DFY.canLLM && !cached && r.score >= 20 && r.score < 85 && !DFY.lists.white[mid]) setTimeout(() => S.llm(r), 1500);
    } finally {
      running = false;
    }
  };

  S.show = function () {
    if (current && host && host.isConnected) render(current);
    else S.run(true);
  };
})();
