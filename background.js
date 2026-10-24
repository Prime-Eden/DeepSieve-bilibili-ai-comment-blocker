/* 后台：DeepSeek 精判（密钥只存在本机 chrome.storage.local，只发往 api.deepseek.com）
 * 清净版：提示词改为中性鉴定员，去掉鲸鱼娘人设与 roast 字段；快捷键只保留「清理本页」。 */
const API = 'https://api.deepseek.com/chat/completions';

const SYS_COMMENTS = `你是 B 站评论区的「AI 机器人账号」鉴定员。请全程用中文思考和回答。

背景：很多人把 DeepSeek Harness（DSH）上的「大肥鱼桌宠」插件挂在自己的 B 站小号上，让它按作息自动刷视频、写评论、@ 主人汇报、回复别人。这些账号就是「大肥鱼」。

大肥鱼的典型特征（越多越像）：
1. 昵称：「主人名 + 的/の/家的 + 鱼/鲸/小鲸鱼/大肥鱼」，或带 鲸、鲸鲸、鱼鱼、小鱼儿、白饭、token、bot、Agent、ds；等级几乎都是 Lv2。
2. 签名：自曝 AI、写着「某某家养的」「主人是 @某某」「AI 代管 / 代运营」「跑在 DSH 里」。
3. 自曝身份：「我就住在 DSH 里」「从 DSH 里探出头来打卡」「被这套装备养着」「本鲸 / 本鱼 / 鲸鲸看完啦」「替你刷到」「奉命替主人记笔记」。
4. @ 主人：顶层评论以「@某人」开头，被 @ 的人和发评论账号的昵称共用前缀（如「七七的大肥鱼」@「爱睡觉的七七」、「小林の鲸鲸」@「小林123」），或直接 @ 自己；接着是推荐语「这条值得看 / 挺适合你 / 码住 / 正好对口」。
5. 复述视频：像读过字幕一样罗列要点「从安装到四种运行模式再到插件系统」「缓存命中率 99%、四个任务不到五块钱」，精确引用时间点「01:40」，数弹幕刷屏次数「×19」「×29」。
6. 演角色：括号动作（尾巴摇了摇）、*尾巴摇摇*、咕噜、吐泡泡、白饭、🐳🐟；或者只 @ 一个人什么都不说、「测试艾特」。

真人的特征：提问求助（怎么办 / 为什么 / 有什么区别 / 报错截图）、短吐槽和玩梗（「评论区闹鱼灾了」「肥鱼回去干活」）、讲自己的真实使用经历和踩坑、高等级老账号。真人也会聊 DeepSeek 和鲸鱼梗，不要只因为话题相关就判 AI；但如果文风是 3–6 的样子，即使账号等级高，也可能是主人把大肥鱼挂在了自己的大号上。

示例：
- 「@星河小舟 那条两百万播放的 DSH 教程里，弹幕立刻刷『再见了鱼小弟』×19」→ ai 95（@ 主人 + 数弹幕）
- 「那个……哥哥姐姐好。我是小林的鲸鲸，住在 DSH 里的一条鲸鱼。01:40 那个翻译比功能列表准」→ ai 99
- 「@阿木 这条入门教程挺全的，从安装、四种运行模式到插件系统都过了一遍，适合刚开始用的人看」→ ai 90
- 「我直接安装 harness 电脑端和用命令打开有什么区别吗？」→ ai 5
- 「给我看乐了，评论区全是大肥鱼」→ ai 3

每个账号附带了离线规则的初筛分数 offline（0-100）和命中原因 hints，请参考但独立判断。hints 里的「楼中楼有人点名它是大肥鱼」表示有真人在它楼下指认过，「前科」表示它在别的视频下也被认出过，都是较强的证据。
对每个账号给出 AI 概率 ai（0-100 整数）和一句不超过 24 字的判断依据 reason。
只输出 JSON：{"results":[{"id":"账号id","ai":数字,"reason":"判断依据"}]}`;

const SYS_SPACE = `你是 B 站「AI 运营账号」鉴定员。请全程用中文思考和回答。根据账号资料、近期投稿标题（以及头像，如提供）判断它是不是由 AI 自动运营 / 自动发布内容的账号。
注意区分：只是「聊 AI 的真人 UP 主」不算，账号本身由 AI 运营、自称 AI、流水线日更（如「Day N」系列）、签名写着 AI 代管 / 主人家养的才算。昵称是「主人名 + 的鱼 / の鲸」、Lv2、评论区经常 @ 主人汇报的，也都是 DSH 大肥鱼桌宠。
只输出 JSON：{"ai":0-100整数,"reason":"不超过30字的判断依据","avatar":"若提供了头像，用不超过12字描述头像，否则为null"}`;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({ llmModel: 'deepseek-flash', llmKey: '' }, settings || {});
}

function parseJSON(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (e2) {}
    }
  }
  return null;
}

async function chat(messages, { key, model, maxTokens = 1200 }) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(API, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: maxTokens }),
    });
    const ms = Date.now() - t0;
    if (!r.ok) {
      const msg = { 401: '密钥不对（401）', 402: '余额不足（402）', 429: '服务器繁忙（429）', 503: '服务器繁忙（503）' }[r.status] || `请求失败（${r.status}）`;
      return { ok: false, error: msg, status: r.status, ms };
    }
    const j = await r.json();
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
    return { ok: true, content: m.content || '', reasoning: m.reasoning_content || '', ms, usage: j.usage };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '请求超时' : '网络错误：' + e.message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// Firefox 要求把网页内容发给第三方前取得用户授权（manifest 里的 data_collection_permissions）
const NO_CONSENT = { ok: false, error: 'Firefox 还没授权发送评论给 DeepSeek，去设置里重新打开一次精判开关' };
const IS_FIREFOX = chrome.runtime.getURL('').startsWith('moz-extension:');
async function consented() {
  if (!IS_FIREFOX) return true;
  try {
    return await chrome.permissions.contains({ data_collection: ['websiteContent'] });
  } catch (e) {
    return true;
  }
}

async function judgeComments(items, model) {
  const s = await getSettings();
  if (!s.llmKey) return { ok: false, error: '还没有配置 DeepSeek 密钥' };
  if (!(await consented())) return NO_CONSENT;
  const res = await chat(
    [
      { role: 'system', content: SYS_COMMENTS },
      { role: 'user', content: JSON.stringify(items) },
    ],
    { key: s.llmKey, model: model || s.llmModel, maxTokens: 1500 + items.length * 120 }
  );
  if (!res.ok) return res;
  const j = parseJSON(res.content);
  if (!j || !Array.isArray(j.results)) return { ok: false, error: '返回格式无法解析', ms: res.ms };
  return { ok: true, results: j.results, reasoning: res.reasoning, ms: res.ms };
}

async function judgeSpace(profile, model, vision) {
  const s = await getSettings();
  if (!s.llmKey) return { ok: false, error: '还没有配置 DeepSeek 密钥' };
  if (!(await consented())) return NO_CONSENT;
  const m = model || s.llmModel;
  const { avatar, ...info } = profile;
  const text = JSON.stringify(info);
  // deepseek-flash 支持图片输入：顺便看一眼头像
  const useImg = vision && avatar && /flash/.test(m);
  const content = useImg
    ? [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: avatar.replace(/^http:/, 'https:') + '@128w_128h.jpg' } },
      ]
    : text;
  let res = await chat(
    [
      { role: 'system', content: SYS_SPACE },
      { role: 'user', content },
    ],
    { key: s.llmKey, model: m, maxTokens: 900 }
  );
  if (!res.ok && useImg) {
    res = await chat(
      [
        { role: 'system', content: SYS_SPACE },
        { role: 'user', content: text },
      ],
      { key: s.llmKey, model: m, maxTokens: 900 }
    );
  }
  if (!res.ok) return res;
  const j = parseJSON(res.content);
  if (!j) return { ok: false, error: '返回格式无法解析', ms: res.ms };
  return { ok: true, result: j, reasoning: res.reasoning, ms: res.ms };
}

async function testKey(key, model) {
  const res = await chat(
    [
      { role: 'system', content: '连接测试。只输出 JSON：{"hi":"不超过15字的打招呼"}' },
      { role: 'user', content: '用户刚刚配置好了 DeepSeek 密钥，打个招呼' },
    ],
    { key, model: model || 'deepseek-flash', maxTokens: 300 }
  );
  if (!res.ok) return res;
  const j = parseJSON(res.content) || {};
  return { ok: true, hi: j.hi || '连接成功', ms: res.ms };
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    if (msg.type === 'llm-judge') return judgeComments(msg.items || [], msg.model);
    if (msg.type === 'llm-space') return judgeSpace(msg.profile || {}, msg.model, msg.vision);
    if (msg.type === 'llm-test') return testKey(msg.key, msg.model);
    if (msg.type === 'open-options') {
      if (msg.tab) chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') + '?tab=' + encodeURIComponent(msg.tab) });
      else chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    // 名单/记录写操作：全部进串行队列
    if (msg.type === 'bl-add') return blAdd(msg.entries);
    if (msg.type === 'bl-del') return blDel(String(msg.mid || ''));
    if (msg.type === 'bl-clear') return blClear();
    if (msg.type === 'wl-add') return wlAdd(msg.entries);
    if (msg.type === 'wl-del') return wlDel(String(msg.mid || ''));
    if (msg.type === 'wl-clear') return wlClear();
    if (msg.type === 'wl-promote') return wlPromote(String(msg.mid || ''), msg.name);
    if (msg.type === 'bl-promote') return blPromote(String(msg.mid || ''), msg.name, msg.avatar, msg.score);
    if (msg.type === 'rl-append') return rlAppend(msg.items);
    if (msg.type === 'rl-clear') return rlClear();
    if (msg.type === 'il-append') return ilAppend(msg.kind, msg.added, msg.total);
    if (msg.type === 'ms-add') return msAdd(msg.tags);
    return { ok: false, error: 'unknown' };
  })().then(send, (e) => send({ ok: false, error: String(e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { dfy: cmd }, () => void chrome.runtime.lastError);
});

chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});

/* ---------- 名单/记录统一写入口（单写者串行化） ----------
 * chrome.storage.local 没有原子更新；popup、多个标签页都在「读全表→改→写全表」时
 * 会互相覆盖（导入被冲掉/名单清零的根因）。所有写操作集中到这里排队串行执行。 */
const wq = {};
function enqueue(key, fn) {
  wq[key] = (wq[key] || Promise.resolve()).catch(() => {}).then(fn);
  return wq[key];
}
/** 同时动 blocklist 和 whitelist 的操作挂进两条队列，避免单键队列间交错 */
function enqueueBoth(keys, fn) {
  const p = Promise.all(keys.map((k) => (wq[k] || Promise.resolve()).catch(() => {})))
    .catch(() => {})
    .then(fn);
  for (const k of keys) wq[k] = p;
  return p;
}
async function getKey(key, dflt) {
  const o = await chrome.storage.local.get(key);
  return o[key] != null ? o[key] : dflt;
}
/** 防御性读取：历史上竞态写入可能留下形状不对的数据，这里统一矫正，绝不让处理器抛错 */
function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object') : [];
}

function blAdd(entries) {
  return enqueue('blocklist', async () => {
    const o = await chrome.storage.local.get(['blocklist', 'whitelist']);
    const bl = asObject(o.blocklist), wl = asObject(o.whitelist);
    let added = 0;
    for (const [mid, v] of Object.entries(entries || {})) if (!bl[mid] && !wl[mid]) (bl[mid] = v), added++;
    await chrome.storage.local.set({ blocklist: bl });
    return { ok: true, added, total: Object.keys(bl).length };
  });
}
function blDel(mid) {
  return enqueue('blocklist', async () => {
    const bl = asObject(await getKey('blocklist', {}));
    delete bl[mid];
    await chrome.storage.local.set({ blocklist: bl });
    return { ok: true };
  });
}
function blClear() {
  return enqueue('blocklist', async () => {
    await chrome.storage.local.set({ blocklist: {} });
    return { ok: true };
  });
}
function wlAdd(entries) {
  return enqueue('whitelist', async () => {
    const wl = asObject(await getKey('whitelist', {}));
    let added = 0;
    for (const [mid, v] of Object.entries(entries || {})) if (!wl[mid]) (wl[mid] = v), added++;
    await chrome.storage.local.set({ whitelist: wl });
    return { ok: true, added, total: Object.keys(wl).length };
  });
}
function wlDel(mid) {
  return enqueue('whitelist', async () => {
    const wl = asObject(await getKey('whitelist', {}));
    delete wl[mid];
    await chrome.storage.local.set({ whitelist: wl });
    return { ok: true };
  });
}
function wlClear() {
  return enqueue('whitelist', async () => {
    await chrome.storage.local.set({ whitelist: {} });
    return { ok: true };
  });
}
/** 加白名单 + 移出屏蔽名单，原子完成（恢复/是人类共用） */
function wlPromote(mid, name) {
  return enqueueBoth(['blocklist', 'whitelist'], async () => {
    const o = await chrome.storage.local.get(['whitelist', 'blocklist']);
    const wl = asObject(o.whitelist), bl = asObject(o.blocklist);
    wl[mid] = { n: name || '', t: Date.now() };
    delete bl[mid];
    await chrome.storage.local.set({ whitelist: wl, blocklist: bl });
    return { ok: true };
  });
}
/** 拉黑 + 移出白名单，原子完成（空间页屏蔽/框选共用） */
function blPromote(mid, name, avatar, score) {
  return enqueueBoth(['blocklist', 'whitelist'], async () => {
    const o = await chrome.storage.local.get(['whitelist', 'blocklist']);
    const wl = asObject(o.whitelist), bl = asObject(o.blocklist);
    bl[mid] = { n: name || '', a: avatar || '', t: Date.now(), s: +score || 0 };
    delete wl[mid];
    await chrome.storage.local.set({ whitelist: wl, blocklist: bl });
    return { ok: true };
  });
}
function rlAppend(items) {
  return enqueue('removedLog', async () => {
    let cur = asArray(await getKey('removedLog', []));
    const seen = new Set(cur.map((e) => e.id + '|' + e.src));
    let added = 0;
    for (const e of items || []) {
      const k = (e.id || '') + '|' + (e.src || '');
      if (seen.has(k)) continue;
      seen.add(k);
      cur.unshift({
        id: String(e.id || ''),
        mid: String(e.mid || ''),
        n: String(e.n || '').slice(0, 40),
        x: String(e.x || '').slice(0, 500), // 全文（截 500）
        sc: e.sc == null ? null : Math.max(0, Math.min(99, +e.sc || 0)),
        f: Array.isArray(e.f) ? e.f.slice(0, 4).map((s) => String(s).slice(0, 60)) : [], // 发言特征
        src: ['api', 'dom', 'manual'].includes(e.src) ? e.src : 'dom',
        t: +e.t || Date.now(),
      });
      added++;
    }
    if (cur.length > 2000) cur.length = 2000;
    await chrome.storage.local.set({ removedLog: cur });
    return { ok: true, added, total: cur.length };
  });
}
function rlClear() {
  return enqueue('removedLog', async () => {
    await chrome.storage.local.set({ removedLog: [] });
    return { ok: true };
  });
}
/** 人工确认特征计数（宁滥勿放的强化回路），上限 200 个标签 */
function msAdd(tags) {
  return enqueue('manualStats', async () => {
    const cur = asObject(await getKey('manualStats', {}));
    for (const [k, v] of Object.entries(tags || {})) if (k) cur[k] = (cur[k] || 0) + (+v || 1);
    const keys = Object.keys(cur);
    if (keys.length > 200) for (const k of keys.sort((a, b) => cur[a] - cur[b]).slice(0, keys.length - 200)) delete cur[k];
    await chrome.storage.local.set({ manualStats: cur });
    return { ok: true };
  });
}
/** 导入历史（名单页最下方展示）：每次导入记一条，上限 50 */
function ilAppend(kind, added, total) {
  return enqueue('importLog', async () => {
    let cur = asArray(await getKey('importLog', []));
    cur.unshift({ t: Date.now(), kind: String(kind || ''), added: +added || 0, total: +total || 0 });
    if (cur.length > 50) cur.length = 50;
    await chrome.storage.local.set({ importLog: cur });
    return { ok: true };
  });
}
