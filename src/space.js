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
.c{--ink:#1f2329;--mut:#667085;--faint:#98a2b3;--surface:#fff;--line:rgba(16,24,40,.08);--field:rgba(16,24,40,.06);--tint:rgba(37,70,184,.08);--tint-h:rgba(37,70,184,.14);--acc:#2546b8;--acc-h:#1d3a9c;--acc-t:#2546b8;--bad:#c2455a;--good:#1a9e6c;--lvc:#1a9e6c;
  position:fixed;top:76px;right:18px;z-index:2147483000;width:332px;padding:16px;border-radius:16px;
  background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(16,24,40,.06),0 18px 40px -14px rgba(16,24,40,.32);
  font:13px/1.55 -apple-system,BlinkMacSystemFont,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;color:var(--ink)}
.c.dk{--ink:#eceef3;--mut:#a3a9b8;--faint:#7c8392;--surface:#25272d;--line:rgba(255,255,255,.1);--field:rgba(255,255,255,.08);--tint:rgba(143,176,255,.12);--tint-h:rgba(143,176,255,.2);--acc:#4a6ee0;--acc-h:#5b7be8;--acc-t:#9db8ff;--bad:#e0707f;--good:#4cc38a}
.c[data-lv=fish]{--lvc:#e0566b}
.c[data-lv=suspect]{--lvc:#e8964a}
.hd{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.hd b{font-size:13.5px;font-weight:700}
.hd .uid{padding:0 7px;border-radius:999px;background:var(--field);color:var(--mut);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
.hd .x{margin-left:auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--mut);font-size:17px;line-height:1;border-radius:8px}
.hd .x:hover{background:var(--field);color:var(--ink)}
.notice{margin-bottom:12px;padding:7px 10px;border-radius:9px;background:var(--tint);color:var(--acc-t);font-size:12px}
.who{display:flex;gap:12px;align-items:center}
.avw{position:relative;width:46px;height:46px;border-radius:50%;flex:none;background:var(--tint);color:var(--acc-t);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;overflow:hidden}
.avw img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.who>div:last-child{min-width:0}
.nm{font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta{color:var(--mut);font-size:12px}
.verdict{display:flex;align-items:baseline;gap:8px;margin:14px 0 8px}
.verdict strong{font-size:30px;line-height:1;font-weight:700;color:var(--lvc);font-variant-numeric:tabular-nums}
.verdict strong small{font-size:15px;font-weight:600;margin-left:1px}
.verdict span{font-size:13px;color:var(--mut)}
.gauge{position:relative;height:6px;border-radius:3px;background:var(--field);margin-bottom:12px}
.gauge i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--lvc);transition:width .4s ease}
.gauge u{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--faint);opacity:.7}
ul{list-style:none;margin:0 0 12px;padding-top:10px;border-top:1px solid var(--line)}
li{display:flex;gap:10px;align-items:baseline;padding:3px 0;color:var(--mut);font-size:12.3px}
li b{flex:none;min-width:34px;text-align:center;padding:0 4px;border-radius:6px;background:var(--field);font-weight:600;font-variant-numeric:tabular-nums;color:var(--bad);font-size:11.5px}
li b.neg{color:var(--good)}
li span{min-width:0}
.llm{margin:0 0 12px;padding:9px 11px;border-radius:10px;background:var(--tint);font-size:12.3px;color:var(--ink)}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button{all:unset;box-sizing:border-box;cursor:pointer;height:32px;padding:0 13px;display:inline-flex;align-items:center;border-radius:9px;font-size:12.5px;font-weight:600;background:var(--tint);color:var(--acc-t);transition:background .12s}
button:hover{background:var(--tint-h)}
button.pri,button.danger{background:var(--acc);color:#fff}
button.pri:hover,button.danger:hover{background:var(--acc-h)}
button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.empty{color:var(--faint)}
@media (prefers-reduced-motion: reduce){.gauge i{transition:none}}
`;

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
    // 绑定卡片点击（原在顶层执行时 card=null，整个空间鉴定模块加载即崩）
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
    });;
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
    card.dataset.lv = info.lv;
    const ev = r.reasons
      .slice(0, 6)
      .map((x) => `<li><b>${x.w ? (x.w > 0 ? '+' : '') + x.w : '·'}</b><span>${esc(x.why)}</span></li>`)
      .join('');
    const canLLM = DFY.settings.llmEnabled && DFY.settings.llmKey && DFY.canLLM;
    const llm = r.llm
      ? `<div class="llm">DeepSeek：AI 概率 ${r.llm.ai}% · ${esc(r.llm.reason || '')}${r.llm.cached ? '（7 天内判过）' : ''}</div>`
      : state.llmLoading
        ? '<div class="llm">DeepSeek 分析中</div>'
        : '';
    const btns = [];
    if (blocked) btns.push('<button class="pri" data-a="unblock">取消屏蔽</button>');
    else if (info.lv !== 'human') btns.push('<button class="danger" data-a="block">屏蔽此账号</button>');
    if (canLLM && !r.llm && !state.llmLoading) btns.push('<button data-a="llm">DeepSeek 精判</button>');
    if (!canLLM) btns.push('<button data-a="cfg">配置精判</button>');
    if (!white && info.lv !== 'human') btns.push('<button data-a="white">是人类</button>');
    card.innerHTML = `
<div class="hd"><b>账号鉴定</b><span class="uid">UID ${esc(p.mid)}</span><span class="x" data-a="close" title="关闭" role="button" aria-label="关闭">×</span></div>
${blocked ? `<div class="notice">已在屏蔽名单里</div>` : white ? `<div class="notice">在放行名单里</div>` : ''}
<div class="who"><div class="avw"><span>${esc(String(p.uname || '?').slice(0, 1))}</span><img src="${esc((p.avatar || '').replace(/^http:/, 'https:'))}@132w_132h.webp" referrerpolicy="no-referrer"></div><div><div class="nm">${esc(p.uname)}</div><div class="meta">Lv${p.level} · ${fmtNum(p.fans)} 粉丝 · 投稿 ${p.archives}</div></div></div>
<div class="verdict"><strong>${r.score}<small>%</small></strong><span>${blocked ? '已屏蔽' : info.label}</span></div>
<div class="gauge"><i style="width:${r.score}%"></i><u style="left:${DFY.settings.threshold}%" title="当前门槛"></u></div>
<ul>${ev || '<li class="empty">没有发现 AI 特征</li>'}</ul>
${llm}
<div class="btns">${btns.join('')}</div>`;
    // 头像加载失败（被屏蔽 / 断网）时露出昵称首字占位；不用内联 onerror，避免被页面 CSP 拦截
    for (const im of card.querySelectorAll('.avw img')) im.addEventListener('error', () => (im.style.display = 'none'));
    card.style.display = '';
  }


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
