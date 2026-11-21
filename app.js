/* ============================================================
 * 情绪烘干机 · 前端交互逻辑
 * 单页应用：登录 / 情绪转化 / 树洞 / 我的记录
 * 接入 WorkBuddy Cloud Service：
 *   · Auth：微信扫码登录、WorkBuddy 账号登录（保留原 UI 入口）
 *   · Database：emotion_records（私密）、treehole_posts（公开可读）
 *   · LLM：云端大模型替代原后端 GLM
 * ============================================================ */

/* ===== WorkBuddy Cloud 客户端（启动时初始化一次） =====
 * endpoint 与 publishableKey 来自 publicConfig（见 index.html）。
 * 所有云数据库 / Auth / LLM 调用共用这一个实例。
 */
let cloud = null;
function initCloud() {
  if (cloud || !window.WorkBuddyCloud || !window.WB_PUBLIC_CONFIG) return;
  cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: window.WB_PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: window.WB_PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: window.WB_PUBLIC_CONFIG.publishableKey,
  });
}


/* ===== 后端地址（运行时自动探测，兼容本地 / 静态预览 / 云端） =====
 * 启动时依次探测候选地址，第一个 /api/health 可用的即采用。
 * 云端已改为「前端+API 单端口同源部署」：页面和 /api/* 在同一域名下，
 * 因此云端优先探测同源 ''，命中即用，无需跨域、无需等待 localhost 超时。
 * 候选顺序：
 *   1) window.API_BASE_OVERRIDE —— 手动指定（前后端分离部署时在 index.html 配置）
 *   2) 本地/预览 → http://localhost:3000 优先；云端 → 同源 '' 优先
 *   3) 另一个候选兜底
 */
function isLocalEnv() {
  const h = location.hostname;
  return location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1';
}
let API_BASE = (function () {
  if (window.API_BASE_OVERRIDE) return String(window.API_BASE_OVERRIDE).replace(/\/+$/, '');
  return isLocalEnv() ? 'http://localhost:3000' : '';
})();

// 探测后端地址：返回真正可用的 API_BASE
async function detectApiBase() {
  if (window.API_BASE_OVERRIDE) return API_BASE; // 手动指定则不再探测
  const candidates = [];
  const push = (v) => { if (!candidates.includes(v)) candidates.push(v); };
  // 本地/预览先试 localhost，云端先试同源，减少无谓超时等待
  if (isLocalEnv()) {
    push('http://localhost:3000');
    push('');
  } else {
    push('');
    push('http://localhost:3000');
  }
  for (const c of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(c + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) { API_BASE = c; return c; }
    } catch (e) { /* 该候选不通，试下一个 */ }
  }
  return API_BASE; // 都不通，保留初始值，让请求走兜底
}
console.log('[情绪烘干机] 初始 API_BASE =', API_BASE || '(同源/当前域名)', '（启动时自动探测中…）');

/* ===== 全局状态 ===== */
const State = {
  user: null,            // { provider, avatar, nick, gender }
  view: 'entry',
  lastInput: '',
  lastIntensity: 3,
  lastResult: null,      // { type, content }
  dryerStage: 'input',   // input | drying | result | share
  treeholeSort: 'latest',
};

/* ===== 工具函数 ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const target = $(`#view-${name}`);
  if (target) target.classList.add('active');
  State.view = name;
  // 主容器内导航高亮
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(msg, duration = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), duration);
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randStr(len = 3) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[randInt(0, chars.length - 1)];
  return s;
}
function genGuestNick() {
  return '游客 ' + randStr(randInt(2, 4));
}
function formatDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ===== 头像 SVG（内嵌，不依赖外部图片） ===== */
const AVATARS = {
  male: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="50" fill="#f1ece4"/>
    <!-- 短发 -->
    <path d="M22 46 Q24 22 50 20 Q76 22 78 46 L74 44 Q72 30 50 28 Q28 30 26 44 Z" fill="#5a4a3e"/>
    <!-- 脸 -->
    <ellipse cx="50" cy="54" rx="26" ry="28" fill="#f0d4b8"/>
    <!-- 眼睛 -->
    <circle cx="40" cy="52" r="2.6" fill="#4a4540"/>
    <circle cx="60" cy="52" r="2.6" fill="#4a4540"/>
    <!-- 嘴 -->
    <path d="M42 66 Q50 72 58 66" stroke="#c97b6a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <!-- 腮红 -->
    <circle cx="36" cy="60" r="4" fill="#ecc9ad" opacity="0.6"/>
    <circle cx="64" cy="60" r="4" fill="#ecc9ad" opacity="0.6"/>
  </svg>`,
  female: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="50" fill="#f1ece4"/>
    <!-- 长发 -->
    <path d="M24 40 Q22 70 30 82 L36 80 Q34 60 34 44 Q36 26 50 24 Q64 26 66 44 Q66 60 64 80 L70 82 Q78 70 76 40 Q74 18 50 16 Q26 18 24 40 Z" fill="#7a5c4a"/>
    <!-- 脸 -->
    <ellipse cx="50" cy="54" rx="24" ry="26" fill="#f5dcc4"/>
    <!-- 眼睛 -->
    <circle cx="41" cy="52" r="2.6" fill="#4a4540"/>
    <circle cx="59" cy="52" r="2.6" fill="#4a4540"/>
    <!-- 嘴 -->
    <path d="M44 66 Q50 71 56 66" stroke="#d99066" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <!-- 腮红 -->
    <circle cx="37" cy="60" r="4" fill="#ecc9ad" opacity="0.7"/>
    <circle cx="63" cy="60" r="4" fill="#ecc9ad" opacity="0.7"/>
  </svg>`,
};

/* ===== placeholder 轮换 ===== */
const PLACEHOLDERS = [
  '把今天的倒霉事写下来',
  '谁惹你了，扔这儿',
  '今天什么让你emo了',
  '说说吧，滚筒不外传',
  '把糟心事倒进来',
  '憋屈的话，倒出来吧',
];
function rotatePlaceholder() {
  const el = $('#emotion-input');
  if (!el) return;
  let idx = randInt(0, PLACEHOLDERS.length - 1);
  el.placeholder = PLACEHOLDERS[idx];
  setInterval(() => {
    if (State.view === 'dryer' && State.dryerStage === 'input') {
      idx = (idx + 1) % PLACEHOLDERS.length;
      el.placeholder = PLACEHOLDERS[idx];
    }
  }, 4000);
}

/* ============================================================
 * 一、登录与入口
 * ============================================================ */
function initEntry() {
  // 微信登录 → cloud.auth signInWithOAuth wechat（保留原 UI 视觉，仅升级行为）
  // 注意：OAuth 流程会跳转到 WeChat 扫码页，扫码后回到本站根路径，由 restoreAuth() 处理回调。
  const wxBtn = $('.btn-login[data-provider="wechat"]');
  if (wxBtn) {
    wxBtn.addEventListener('click', async () => {
      if (!cloud) { toast('云服务尚未就绪，请刷新重试'); return; }
      const overlay = $('#auth-overlay');
      overlay.classList.add('show');
      try {
        const { data, error } = await cloud.auth.signInWithOAuth({
          provider: 'wechat',
          redirectTo: location.origin,
        });
        if (error) {
          overlay.classList.remove('show');
          toast('微信登录未开启或失败：' + (error.message || error));
          return;
        }
        if (data && data.url) {
          location.assign(data.url); // 跳转 WeChat 扫码
        }
      } catch (e) {
        overlay.classList.remove('show');
        toast('微信登录异常：' + (e.message || e));
      }
    });
  }
  // QQ 登录按钮 → WorkBuddy 账号登录（保留原 UI 文案，因为 WorkBuddy 账号是平台统一登录）
  const qqBtn = $('.btn-login[data-provider="qq"]');
  if (qqBtn) {
    qqBtn.addEventListener('click', async () => {
      if (!cloud) { toast('云服务尚未就绪，请刷新重试'); return; }
      const overlay = $('#auth-overlay');
      overlay.classList.add('show');
      try {
        const back = new URL(location.href);
        back.pathname = '/';
        for (const key of ['code', 'state', 'provider']) back.searchParams.delete(key);
        const { data, error } = await cloud.auth.signInWithOAuth({
          provider: 'workbuddy',
          redirectTo: back.toString(),
        });
        if (error) {
          overlay.classList.remove('show');
          toast('WorkBuddy 登录未开启或失败：' + (error.message || error));
          return;
        }
        if (data && data.url) {
          location.assign(data.url);
        }
      } catch (e) {
        overlay.classList.remove('show');
        toast('WorkBuddy 登录异常：' + (e.message || e));
      }
    });
  }
  // 游客进入（不登录，不保存记录）
  $('.btn-guest').addEventListener('click', () => {
    enterSetup('guest');
  });
}

/* ===== OAuth 回调分发：在路由守卫之前处理 ?code=...&state=...&provider=... =====
 * 必须在 init() 启动早期调用，避免 unauthenticated 状态把回调 code 撕掉。
 */
async function restoreAuth() {
  if (!cloud) return false;
  const url = new URL(location.href);
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    return false; // 普通访问，不是回调
  }
  const provider = url.searchParams.get('provider');
  if (provider !== 'workbuddy' && provider !== 'wechat') {
    if (url.searchParams.has('error')) {
      toast('登录授权失败：' + (url.searchParams.get('error') || ''));
      for (const k of ['code', 'state', 'provider', 'error', 'error_description']) url.searchParams.delete(k);
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return false;
  }
  const handleCallback = provider === 'workbuddy'
    ? cloud.auth.handleWorkBuddyCallback
    : cloud.auth.handleWechatWebCallback;
  if (typeof handleCallback !== 'function') {
    toast('当前 SDK 版本不支持该登录方式，请联系应用管理员');
    return false;
  }
  try {
    const { data: session, error } = await handleCallback.call(cloud.auth);
    if (error) {
      toast('登录失败：' + (error.message || error));
    } else if (session) {
      // 清掉 code/state/provider，保留业务参数
      for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key);
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      enterSetupFromSession(session);
      return true;
    }
  } catch (e) {
    toast('登录回调异常：' + (e.message || e));
  }
  return false;
}

/* ===== 已有会话恢复（普通访问时检查是否已登录） ===== */
async function tryRestoreSession() {
  if (!cloud) return null;
  try {
    const { data: session, error } = await cloud.auth.getSession();
    if (error || !session) return null;
    return session;
  } catch (e) {
    return null;
  }
}

function enterSetup(provider) {
  State.user = { provider, avatar: null, nick: '', gender: 'none' };
  // 默认随机选中一个头像
  const defaultAvatar = Math.random() < 0.5 ? 'male' : 'female';
  State.user.avatar = defaultAvatar;
  renderAvatarPicker(defaultAvatar);
  showView('setup');
}

/* OAuth 登录成功后，从 session 预填昵称/头像，进入"身份设置"页 */
function enterSetupFromSession(session) {
  const provider = (session && session.user && session.user.appProvider) || 'workbuddy';
  const u = (session && session.user) || {};
  State.user = {
    provider,
    avatar: null,
    nick: u.name || '',
    gender: 'none',
    session,
  };
  const defaultAvatar = Math.random() < 0.5 ? 'male' : 'female';
  State.user.avatar = defaultAvatar;
  renderAvatarPicker(defaultAvatar);
  // 预填昵称（用户可改）
  const nickInput = $('#input-nick');
  if (nickInput && u.name) nickInput.value = u.name;
  showView('setup');
}

/* ===== 身份设置 ===== */
function initSetup() {
  const picker = $('#avatar-picker');
  $$('.avatar-opt', picker).forEach(opt => {
    opt.innerHTML = AVATARS[opt.dataset.avatar];
    opt.addEventListener('click', () => {
      $$('.avatar-opt', picker).forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      State.user.avatar = opt.dataset.avatar;
    });
  });
  $('#gender-picker').addEventListener('click', e => {
    const btn = e.target.closest('.gender-opt');
    if (!btn) return;
    $$('.gender-opt').forEach(o => o.classList.remove('active'));
    btn.classList.add('active');
    State.user.gender = btn.dataset.gender;
  });
  $('#btn-setup-done').addEventListener('click', () => {
    const nick = $('#input-nick').value.trim();
    State.user.nick = nick || genGuestNick();
    if (!State.user.avatar) State.user.avatar = Math.random() < 0.5 ? 'male' : 'female';
    enterApp();
  });
}

function renderAvatarPicker(selected) {
  $$('.avatar-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.avatar === selected);
  });
}

/* ===== 进入主应用 ===== */
function enterApp() {
  $('#view-entry').classList.remove('active');
  $('#view-setup').classList.remove('active');
  $('#app-main').classList.remove('hidden');
  renderUserChip();
  // 游客隐藏"我的记录"
  const isGuest = State.user.provider === 'guest';
  $('.nav-records').classList.toggle('hidden', isGuest);
  showView('dryer');
  rotatePlaceholder();
  initDryerStages();
}

function renderUserChip() {
  const u = State.user;
  $('#user-avatar').innerHTML = AVATARS[u.avatar];
  $('#user-name').textContent = u.nick;
  const gEl = $('#user-gender');
  if (u.gender === 'male') {
    gEl.textContent = '男';
    gEl.className = 'user-gender';
  } else if (u.gender === 'female') {
    gEl.textContent = '女';
    gEl.className = 'user-gender female';
  } else {
    gEl.classList.add('hidden');
  }
}

/* ============================================================
 * 二、情绪烘干机主功能
 * ============================================================ */
function initDryerStages() {
  const slider = $('#intensity');
  const valEl = $('#intensity-val');
  slider.addEventListener('input', () => {
    valEl.textContent = slider.value;
    State.lastIntensity = parseInt(slider.value);
  });

  $('#btn-dry').addEventListener('click', startDry);
  $('#btn-retry').addEventListener('click', () => {
    // 重新生成，不重新输入
    showDryerStage('drying');
    generateResult(State.lastInput, State.lastIntensity).then(result => {
      State.lastResult = result;
      showResult(result);
      saveRecord(result);
    });
  });
  $('#btn-shred').addEventListener('click', shred);
  $('#btn-back-home').addEventListener('click', backToInput);
}

function startDry() {
  const input = $('#emotion-input').value.trim();
  if (!input) {
    toast('先写点什么吧，滚筒不能空转呀');
    return;
  }
  if (input.length < 2) {
    toast('多说几个字，才好烘干嘛');
    return;
  }
  State.lastInput = input;

  // 敏感词检测
  if (detectSensitive(input)) {
    showSafetyPrompt();
    return;
  }

  showDryerStage('drying');
  generateResult(input, State.lastIntensity).then(result => {
    State.lastResult = result;
    showResult(result);
    saveRecord(result);
  });
}

function showDryerStage(stage) {
  State.dryerStage = stage;
  $('#stage-input').classList.toggle('hidden', stage !== 'input');
  $('#stage-drying').classList.toggle('hidden', stage !== 'drying');
  $('#stage-result').classList.toggle('hidden', stage !== 'result');
  $('#stage-share').classList.toggle('hidden', stage !== 'share');
}

function showResult(result) {
  const tagEl = $('#result-type-tag');
  const bodyEl = $('#result-body');
  const typeMap = { poem: '苏东坡风格 · 诗', joke: '脱口秀 · 段子', color: '治愈 · 情绪色卡', ai: 'AI · 烘干产物' };
  tagEl.textContent = typeMap[result.type];
  tagEl.className = 'result-type-tag type-' + result.type;
  bodyEl.className = 'result-body ' + result.type + (result.type === 'color' ? '-card' : '');
  if (result.type === 'color') {
    bodyEl.innerHTML = result.html;
  } else {
    bodyEl.textContent = result.content;
  }
  showDryerStage('result');
}

function backToInput() {
  $('#emotion-input').value = '';
  State.lastInput = '';
  State.lastResult = null;
  showDryerStage('input');
  rotatePlaceholder();
}

/* ===== 敏感词检测 ===== */
const SENSITIVE_WORDS = [
  '自杀', '轻生', '想死', '不想活', '活不下去', '结束生命', '割腕', '跳楼',
  '吃药死', '安眠药', '了结', '解脱一切', '消失算了', '没有意义活着',
];
function detectSensitive(text) {
  return SENSITIVE_WORDS.some(w => text.includes(w));
}
function showSafetyPrompt() {
  const stage = $('#dryer-stage');
  $('#stage-input').classList.add('hidden');
  $('#stage-drying').classList.add('hidden');
  $('#stage-result').classList.add('hidden');
  $('#stage-share').classList.add('hidden');
  // 插入安全提示
  let card = $('#safety-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'safety-card';
    card.className = 'safety-card';
    stage.appendChild(card);
  }
  card.innerHTML = `
    <div class="s-icon">🫂</div>
    <div class="s-title">如果撑不住，可以找人说说话</div>
    <div class="s-text">你写的话我们读到了。有些沉重不是一台烘干机能转走的，<br/>但你不该一个人扛。</div>
    <div class="s-hotline">全国心理援助热线 12356</div>
    <div style="margin-top:18px"><button class="btn btn-ghost" id="btn-safety-back">我知道了</button></div>
  `;
  card.classList.remove('hidden');
  $('#btn-safety-back').addEventListener('click', () => {
    card.classList.add('hidden');
    $('#emotion-input').value = '';
    $('#stage-input').classList.remove('hidden');
    State.dryerStage = 'input';
  });
}

/* ===== 转化结果生成（调用云端 LLM，替代原后端 GLM） ===== */
/* 优先选用 GLM 系列（与原项目一致），否则取第一个可用模型。
 * LLM API 强制 stream:true，这里仍以"一次性收集完整文本"的形式返回，
 * 与原 generateResult 的调用约定保持一致，避免改动 UI 流程。
 */
let _cachedLlmModel = null;
async function pickLlmModel() {
  if (_cachedLlmModel) return _cachedLlmModel;
  if (!cloud) return null;
  try {
    const models = await cloud.llm.models.list();
    if (!Array.isArray(models) || models.length === 0) return null;
    // 优先 GLM 系列日常主力
    const preferred =
      models.find(m => m.disabled !== true && m.id === 'glm-4.6') ||
      models.find(m => m.disabled !== true && /^glm-/.test(m.id)) ||
      models.find(m => m.disabled !== true);
    _cachedLlmModel = preferred || null;
    return _cachedLlmModel;
  } catch (e) {
    console.error('[llm] 获取模型列表失败:', e.message || e);
    return null;
  }
}

const LLM_SYSTEM_PROMPT = '你是一个温暖、幽默的解压助手。用户会向你倾诉生活和职场的烦恼。请你把他的话改写成一段搞笑脱口秀或者一首豁达的诗。要求：不说教、不评判，带一点发疯文学或苏东坡的豁达感，字数100字以内。';

async function generateResult(input, intensity) {
  if (!cloud) {
    toast('云服务未就绪，AI 转化不可用');
    return { type: 'ai', content: '烘干机今天有点累，但它还是想告诉你：不管怎样，你已经做得很好了。' };
  }
  try {
    const model = await pickLlmModel();
    if (!model) {
      toast('当前没有可用的 AI 模型');
      return { type: 'ai', content: '烘干机今天有点累，但它还是想告诉你：不管怎样，你已经做得很好了。' };
    }
    const messages = [
      { role: 'system', content: LLM_SYSTEM_PROMPT },
      { role: 'user', content: input.trim().slice(0, 500) },
    ];
    let content = '';
    for await (const chunk of cloud.llm.chat.completions.create({
      model: model.id,
      messages,
      stream: true,
      temperature: 1,
      stream_options: { include_usage: true },
    })) {
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) content += delta.content;
    }
    content = (content || '').trim();
    if (!content) {
      toast('AI 返回为空，请重试');
      return { type: 'ai', content: '烘干机今天有点累，但它还是想告诉你：不管怎样，你已经做得很好了。' };
    }
    return { type: 'ai', content };
  } catch (e) {
    console.error('[llm] 调用失败:', e && (e.message || e));
    const code = e && e.error && e.error.code;
    if (code && code.indexOf('auth_') === 0) toast('云服务鉴权失败，请稍后重试');
    else if (code && code.indexOf('quota_') === 0) toast('AI 配额已用尽');
    else toast('AI 转化失败：' + (e && (e.message || e)));
    return { type: 'ai', content: '烘干机今天有点累，但它还是想告诉你：不管怎样，你已经做得很好了。' };
  }
}

// 通用随机选取工具（showShareCard 等仍会用到）
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

/* —— 模拟模板已移除，改用后端 GLM AI 生成 —— */

/* ===== 一键粉碎 + 飞灰动画 ===== */
function shred() {
  const card = $('#result-card');
  const rect = card.getBoundingClientRect();
  startAshAnimation(rect, () => {
    // 动画结束后显示分享卡片
    showShareCard();
  });
}

function showShareCard() {
  const emojis = ['🍃', '✨', '🌤️', '🌿', '☀️'];
  $('#share-emoji').textContent = pick(emojis);
  const texts = [
    '今天的霉运，到此为止。',
    '烘干完毕，一身轻松。',
    '烦恼已碎，重新出发。',
    '今日份的快乐，已到账。',
  ];
  $('#share-text').textContent = pick(texts);
  $('#share-date').textContent = formatDate(Date.now());
  showDryerStage('share');
}

/* ===== 飞灰 Canvas 动画 ===== */
let ashAnimating = false;
function startAshAnimation(rect, onDone) {
  const canvas = $('#ash-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  canvas.style.pointerEvents = 'auto';

  const particles = [];
  const count = 120;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 4;
    particles.push({
      x: rect.left + Math.random() * rect.width,
      y: rect.top + Math.random() * rect.height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 2 + Math.random() * 4,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
      color: ['#8a8580', '#b5b0a8', '#d99066', '#9db4c0', '#c47a52'][randInt(0, 4)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
    });
  }

  // 同时让结果卡片淡出
  const card = $('#result-card');
  card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  card.style.opacity = '0';
  card.style.transform = 'scale(0.95)';

  ashAnimating = true;
  const startTime = Date.now();

  function frame() {
    if (!ashAnimating) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = 0;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06; // 重力
      p.vx *= 0.99;
      p.life -= p.decay;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      ctx.restore();
    });
    if (alive > 0 && Date.now() - startTime < 2500) {
      requestAnimationFrame(frame);
    } else {
      // 结束
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.pointerEvents = 'none';
      ashAnimating = false;
      card.style.opacity = '';
      card.style.transform = '';
      card.style.transition = '';
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(frame);
}

/* ============================================================
 * 三、我的情绪记录（仅登录用户，云端持久化）
 * ============================================================ */
/* 数据库字段映射：
 *   emotion_records.id            ← 云端自增主键
 *   emotion_records.owner_id       ← auth.uid() 自动填充（前端不传）
 *   emotion_records.emotion_input  ← State.lastInput
 *   emotion_records.result_content ← result.content
 *   emotion_records.result_type    ← result.type
 *   emotion_records.result_html    ← result.html（仅色卡类型有值）
 *   emotion_records.intensity      ← State.lastIntensity
 *   emotion_records.created_at      ← now() 自动填充
 */
async function getRecords() {
  if (!cloud) return [];
  const { data, error } = await cloud.database
    .from('emotion_records')
    .select('id, emotion_input, result_content, result_type, result_html, intensity, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[records] 读取云端失败:', error.message || error);
    return [];
  }
  return (data || []).map(r => ({
    id: String(r.id),
    input: r.emotion_input || '',
    result: r.result_content || '',
    resultType: r.result_type || 'ai',
    resultHtml: r.result_html || null,
    time: new Date(r.created_at).getTime(),
  }));
}
async function saveRecord(result) {
  if (State.user.provider === 'guest') return; // 游客不保存
  if (!cloud) { toast('云服务未就绪，记录未保存'); return; }
  const { error } = await cloud.database
    .from('emotion_records')
    .insert({
      emotion_input: State.lastInput,
      result_content: result.content || '',
      result_type: result.type || 'ai',
      result_html: result.html || null,
      intensity: State.lastIntensity || null,
      owner_name: (State.user.nick) || null,
    });
  if (error) {
    console.error('[records] 写入云端失败:', error.message || error);
    if (error.code === '42501') toast('登录已失效，请重新登录后再保存');
    else toast('记录保存失败：' + (error.message || error));
  }
}
async function deleteRecord(id) {
  if (!cloud) return false;
  const { data, error } = await cloud.database
    .from('emotion_records')
    .delete()
    .eq('id', Number(id))
    .select();
  if (error) {
    console.error('[records] 删除失败:', error.message || error);
    return false;
  }
  return Array.isArray(data) ? data.length > 0 : true;
}
async function clearAllRecords() {
  if (!cloud) return false;
  // 删除当前 owner 全部记录（RLS 自动限定 owner_id = auth.uid()）
  const { data, error } = await cloud.database
    .from('emotion_records')
    .delete()
    .neq('id', -1) // 占位条件，触发删除所有可见行
    .select();
  if (error) {
    console.error('[records] 清空失败:', error.message || error);
    return false;
  }
  return true;
}
async function renderRecords() {
  const wrap = $('#records-list');
  if (State.user.provider === 'guest') {
    $('#records-list').innerHTML = '';
    $('#btn-clear-records').classList.add('hidden');
    if (!$('#records-login-tip')) {
      const tip = document.createElement('div');
      tip.id = 'records-login-tip';
      tip.className = 'records-login-tip';
      tip.innerHTML = `
        <div class="tip-icon">🔒</div>
        <p class="tip-text">登录后可保存你的烘干记录<br/>看看自己是怎么一次次把霉运转走的</p>
        <button class="btn btn-primary" id="btn-to-login">去登录</button>
      `;
      wrap.parentNode.appendChild(tip);
      $('#btn-to-login').addEventListener('click', () => {
        $('#app-main').classList.add('hidden');
        $('#view-entry').classList.add('active');
        $('#view-records').innerHTML = '';
      });
    }
    return;
  }
  const tip = $('#records-login-tip');
  if (tip) tip.remove();
  // 加载态
  wrap.innerHTML = '<div class="records-empty">加载中…</div>';
  $('#btn-clear-records').classList.add('hidden');
  const list = await getRecords();
  $('#btn-clear-records').classList.toggle('hidden', list.length === 0);
  if (list.length === 0) {
    wrap.innerHTML = '<div class="records-empty">还没有记录，去烘干一次吧</div>';
    return;
  }
  wrap.innerHTML = list.map(r => {
    const typeLabel = { poem: '诗', joke: '段子', color: '色卡' }[r.resultType] || '产物';
    let resultDisplay;
    if (r.resultType === 'color' && r.resultHtml) {
      resultDisplay = `<div class="record-result">${r.resultHtml}</div>`;
    } else {
      resultDisplay = `<div class="record-result ${r.resultType}">${escapeHtml(r.result)}</div>`;
    }
    return `
      <div class="record-item">
        <div class="record-orig">
          <div class="record-orig-label">原文 · 仅你可见</div>
          ${escapeHtml(r.input)}
        </div>
        ${resultDisplay}
        <div class="record-foot">
          <span class="record-time">${formatDate(r.time)} · ${typeLabel}</span>
          <button class="record-del" data-id="${r.id}">删除</button>
        </div>
      </div>
    `;
  }).join('');
  $$('.record-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const ok = await deleteRecord(id);
      if (ok) {
        toast('已删除');
        renderRecords();
      } else {
        toast('删除失败，请重试');
      }
    });
  });
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function initRecords() {
  $('#btn-clear-records').addEventListener('click', async () => {
    if (confirm('确定清空全部记录吗？此操作不可恢复。')) {
      const ok = await clearAllRecords();
      if (ok) {
        renderRecords();
        toast('已清空全部记录');
      } else {
        toast('清空失败，请重试');
      }
    }
  });
}

/* ============================================================
 * 四、树洞（公共匿名留言墙）
 * ============================================================ */
/* 树洞数据改走后端内存存储，前端不再用 localStorage 存帖子内容。
 * 仅用 localStorage 记录"本浏览器点过赞的帖子 id"，用于显示红心。
 * 旧版本（v1）在 localStorage 写过假数据 dryer_treehole，这里用版本号清理一次。 */
const TH_VERSION = 'v2';
(function cleanOldTreeholeData() {
  if (localStorage.getItem('th_version') !== TH_VERSION) {
    localStorage.removeItem('dryer_treehole'); // 清空旧的假数据
    localStorage.setItem('th_version', TH_VERSION);
  }
})();
// 扩展 State：缓存后端返回的树洞列表、签名（用于轮询对比）、加载态
State.treeholePosts = [];
State.treeholeSignature = '';
State.treeholeLoading = false;

// 本浏览器已点赞的帖子 id（后端无用户系统，用本地存储标记红心显示）
function getLikedIds() {
  try { return JSON.parse(localStorage.getItem('th_liked_ids') || '[]'); } catch { return []; }
}
function setLikedIds(arr) {
  localStorage.setItem('th_liked_ids', JSON.stringify(arr));
}

// 通用 fetch：带超时保护，避免请求挂起导致界面一直"加载中"
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 从云端数据库拉取全部言论
async function fetchTreehole() {
  if (!cloud) return [];
  try {
    const { data, error } = await cloud.database
      .from('treehole_posts')
      .select('id, content, likes, replies, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('[treehole] 读取失败:', error.message || error);
      return [];
    }
    return (data || []).map(p => ({
      id: String(p.id),
      content: p.content || '',
      anon: '匿名网友', // 云端不暴露作者身份
      time: new Date(p.created_at).getTime(),
      likes: p.likes || 0,
      replies: Array.isArray(p.replies) ? p.replies : [],
    }));
  } catch (e) {
    console.error('[treehole] 读取异常:', e.message || e);
    return [];
  }
}

// 生成数据签名：长度+首条id+总赞数+总回复数+全部id，用于轮询时判断是否有变化
function thSignature(posts) {
  if (!posts || posts.length === 0) return 'empty';
  return posts.length + '|' + posts[0].id + '|' +
    posts.reduce((s, p) => s + (p.likes || 0), 0) + '|' +
    posts.reduce((s, p) => s + (p.replies || []).length, 0) + '|' +
    posts.map(p => p.id).join(',');
}
function renderTreehole(posts) {
  const list = posts || State.treeholePosts;
  const sort = State.treeholeSort;
  const sorted = list.slice().sort((a, b) => {
    if (sort === 'hot') return (b.likes || 0) - (a.likes || 0);
    return b.time - a.time;
  });
  const wrap = $('#th-list');
  const likedIds = getLikedIds();
  // 加载中
  if (State.treeholeLoading) {
    wrap.innerHTML = '<div class="th-empty">加载中…</div>';
    return;
  }
  // 空状态
  if (sorted.length === 0) {
    wrap.innerHTML = '<div class="th-empty">树洞还很安静，来说第一句话吧</div>';
    return;
  }
  wrap.innerHTML = sorted.map(item => {
    const isLiked = likedIds.includes(item.id);
    const replies = (item.replies || []).map(r =>
      `<div class="th-reply"><span class="anon">${escapeHtml(r.anon || '匿名网友')}：</span>${escapeHtml(r.content)}</div>`
    ).join('');
    const replyForm = `
      <div class="th-reply-form">
        <input class="th-reply-input" placeholder="匿名回复…" maxlength="100" data-id="${item.id}" />
        <button class="btn btn-ghost btn-sm th-reply-btn" data-id="${item.id}">回复</button>
      </div>
    `;
    return `
      <div class="th-item" data-id="${item.id}">
        <div class="th-item-content">${escapeHtml(item.content)}</div>
        <div class="th-item-meta">
          <button class="th-like ${isLiked ? 'liked' : ''}" data-id="${item.id}">
            <span class="heart">${isLiked ? '❤️' : '🤍'}</span>
            <span>${item.likes || 0}</span>
          </button>
          <span>${timeAgo(item.time)}</span>
        </div>
        ${replies ? `<div class="th-replies">${replies}${replyForm}</div>` : replyForm}
      </div>
    `;
  }).join('');
  bindTreeholeEvents();
}

// 绑定点赞与回复（每次渲染后重新绑定）
function bindTreeholeEvents() {
  // 点赞：调云端 RPC like_post/unlike_post，本地用 th_liked_ids 记红心
  $$('.th-like').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      let likedIds = getLikedIds();
      const isLiked = likedIds.includes(id);
      btn.disabled = true;
      try {
        if (!cloud) { toast('云服务未就绪'); return; }
        const rpcName = isLiked ? 'unlike_post' : 'like_post';
        const { data, error } = await cloud.database.rpc(rpcName, { post_id: Number(id) });
        if (error) {
          if (error.code === '42501' || (error.message && error.message.indexOf('auth') >= 0)) {
            toast('请先登录后再点赞');
          } else {
            toast('点赞失败：' + (error.message || error));
          }
          return;
        }
        if (isLiked) likedIds = likedIds.filter(i => i !== id);
        else likedIds.push(id);
        setLikedIds(likedIds);
        // 同步更新本地缓存的赞数，避免等轮询才变
        const post = State.treeholePosts.find(p => p.id === id);
        if (post) post.likes = (typeof data === 'number') ? data : (post.likes + (isLiked ? -1 : 1));
        renderTreehole(State.treeholePosts);
      } catch (e) {
        toast('网络异常，稍后再试');
      } finally {
        btn.disabled = false;
      }
    });
  });
  // 回复：调云端 RPC reply_post
  $$('.th-reply-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const input = $(`.th-reply-input[data-id="${id}"]`);
      const text = input.value.trim();
      if (!text) { toast('写点什么再回复吧'); return; }
      if (detectSensitive(text)) {
        toast('检测到敏感内容，如需帮助请拨打心理援助热线 12356');
        return;
      }
      if (!cloud) { toast('云服务未就绪'); return; }
      btn.disabled = true;
      try {
        const { data, error } = await cloud.database.rpc('reply_post', {
          post_id: Number(id),
          reply_content: text,
        });
        if (error) {
          if (error.code === '42501' || (error.message && error.message.indexOf('auth') >= 0)) {
            toast('请先登录后再回复');
          } else {
            toast('回复失败：' + (error.message || error));
          }
          btn.disabled = false;
          return;
        }
        // data 是更新后的 replies JSONB 数组
        const post = State.treeholePosts.find(p => p.id === id);
        if (post && Array.isArray(data)) post.replies = data;
        renderTreehole(State.treeholePosts);
        toast('回复成功');
      } catch (e) {
        toast('网络异常，稍后再试');
        btn.disabled = false;
      }
    });
  });
}

// 拉取并渲染；silent=true 时仅在有变化才重渲染（轮询用，避免闪烁）
async function loadTreehole(silent = false) {
  if (!silent) {
    State.treeholeLoading = true;
    renderTreehole([]);
  }
  const posts = await fetchTreehole();
  State.treeholeLoading = false;
  const sig = thSignature(posts);
  State.treeholePosts = posts;
  if (silent) {
    // 轮询：签名未变则不重渲染，避免闪烁
    if (sig !== State.treeholeSignature) {
      State.treeholeSignature = sig;
      renderTreehole(posts);
    }
  } else {
    State.treeholeSignature = sig;
    renderTreehole(posts);
  }
}

// 每 12 秒轮询一次（仅在树洞页可见时拉取）
function startTreeholePolling() {
  setInterval(() => {
    if (State.view === 'treehole') loadTreehole(true);
  }, 12000);
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return formatDate(ts).slice(0, 10);
}
function initTreehole() {
  // 发表言论：写入云端 treehole_posts（需登录，RLS 自动填充 owner_id）
  $('#btn-th-post').addEventListener('click', async () => {
    const input = $('#th-input');
    const text = input.value.trim();
    if (!text) { toast('写点什么吧'); return; }
    if (detectSensitive(text)) {
      toast('检测到敏感内容，如需帮助请拨打心理援助热线 12356');
      return;
    }
    if (!cloud) { toast('云服务未就绪'); return; }
    const btn = $('#btn-th-post');
    btn.disabled = true;
    try {
      const { error } = await cloud.database
        .from('treehole_posts')
        .insert({ content: text.trim().slice(0, 200) });
      if (error) {
        if (error.code === '42501' || (error.message && error.message.indexOf('auth') >= 0)) {
          toast('发表树洞需要先登录');
        } else {
          toast('发表失败：' + (error.message || error));
        }
        btn.disabled = false;
        return;
      }
      input.value = '';
      await loadTreehole();
      toast('已匿名发表');
    } catch (e) {
      toast('发表失败，请检查网络');
    } finally {
      btn.disabled = false;
    }
  });
  // 最新/最热切换：用本地缓存重渲染，无需重新拉取
  $$('.th-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.th-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      State.treeholeSort = tab.dataset.sort;
      renderTreehole(State.treeholePosts);
    });
  });
  // 首次加载拉取一次
  loadTreehole();
  // 启动轮询
  startTreeholePolling();
}

/* ============================================================
 * 五、导航
 * ============================================================ */
function initNav() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'records') renderRecords();
      if (nav === 'treehole') loadTreehole();
      showView(nav);
    });
  });
  $('.header-brand').addEventListener('click', () => {
    showView('dryer');
  });
}

/* file:// 协议检测：直接双击打开网页会导致请求被拦截，主动提示 */
function checkFileProtocol() {
  if (location.protocol === 'file:') {
    alert('检测到您正在直接打开网页文件（file://），这会导致：\n' +
          '· 树洞加载失败 / 发表失败\n' +
          '· AI 转化无法使用\n' +
          '· 数据无法保存\n\n' +
          '请通过本地服务器访问：\n' +
          '1. 双击运行项目根目录的 start.bat\n' +
          '2. 在浏览器访问 http://localhost:8080');
    return true;
  }
  return false;
}

/* ============================================================
 * 启动
 * ============================================================ */
async function init() {
  // 初始化 cloud 客户端（endpoint/publishableKey 已嵌入 index.html）
  initCloud();

  // 先绑定所有事件监听器（不依赖视图状态）
  initEntry();
  initSetup();
  initNav();
  initDryerStages();
  initTreehole();
  initRecords();

  // 再处理 OAuth 回调或恢复已有会话（决定显示哪个视图）
  // OAuth 回调必须在任何路由守卫之前处理，避免 code 被撕掉
  const isCallback = await restoreAuth();
  if (!isCallback) {
    const session = await tryRestoreSession();
    if (session) {
      enterSetupFromSession(session);
    } else {
      // 未登录：显示入口页
      showView('entry');
    }
  }
}
document.addEventListener('DOMContentLoaded', init);
