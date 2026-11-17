/* ============================================================
 * 情绪烘干机 · 前端交互逻辑
 * 单页应用：登录模拟 / 情绪转化 / 树洞 / 在线统计
 * ============================================================ */

/* ===== 后端地址（运行时自动探测，兼容本地 / 静态预览 / 云端） =====
 * 启动时依次探测候选地址，第一个 /api/health 可用的即采用。
 * 候选顺序：
 *   1) window.API_BASE_OVERRIDE —— 手动指定（前后端分离部署时在 index.html 配置）
 *   2) http://localhost:3000     —— 本地开发 / WorkBuddy 预览 / 静态快照
 *   3) ''（同源）                —— 云端前后端同源部署
 * 这样无论从哪个地址打开，都能自动找到后端，不再依赖域名猜测。
 */
let API_BASE = (function () {
  if (window.API_BASE_OVERRIDE) return String(window.API_BASE_OVERRIDE).replace(/\/+$/, '');
  // 初始猜一个：本地地址优先（覆盖绝大多数本地/预览场景）
  const h = location.hostname;
  const isLocal = location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1';
  return isLocal ? 'http://localhost:3000' : '';
})();

// 探测后端地址：返回真正可用的 API_BASE
async function detectApiBase() {
  if (window.API_BASE_OVERRIDE) return API_BASE; // 手动指定则不再探测
  const candidates = [];
  const push = (v) => { if (!candidates.includes(v)) candidates.push(v); };
  push('http://localhost:3000'); // 本地/预览
  push('');                       // 同源（云端）
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
  // 微信/QQ 模拟登录
  $$('.btn-login').forEach(btn => {
    btn.addEventListener('click', () => {
      const provider = btn.dataset.provider;
      const overlay = $('#auth-overlay');
      overlay.classList.add('show');
      setTimeout(() => {
        overlay.classList.remove('show');
        enterSetup(provider);
      }, 1600);
    });
  });
  // 游客进入
  $('.btn-guest').addEventListener('click', () => {
    enterSetup('guest');
  });
}

function enterSetup(provider) {
  State.user = { provider, avatar: null, nick: '', gender: 'none' };
  // 默认随机选中一个头像
  const defaultAvatar = Math.random() < 0.5 ? 'male' : 'female';
  State.user.avatar = defaultAvatar;
  renderAvatarPicker(defaultAvatar);
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

/* ===== 转化结果生成（调用后端 GLM AI） ===== */
async function generateResult(input, intensity) {
  try {
    const res = await fetchWithTimeout(API_BASE + '/api/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, intensity }),
    }, 15000); // AI 生成较慢，给 15 秒
    const data = await res.json();
    if (res.ok && data && data.content) {
      return { type: 'ai', content: data.content };
    }
    // 后端返回了错误信息，打印到控制台方便排查
    const errMsg = (data && (data.errorDetail || data.error)) || 'AI 返回为空';
    console.error('[transform/前端] 后端报错:', data && data.error, '| 详情:', errMsg);
    if (data && data.error) toast('AI 转化失败：' + data.error + '（详情见控制台 F12）');
    // 仍返回兜底文案，保证体验不中断
    return { type: 'ai', content: '烘干机今天有点累，但它还是想告诉你：不管怎样，你已经做得很好了。' };
  } catch (e) {
    // 后端完全不可达（网络错误/CORS/后端未部署）
    console.error('[transform/前端] 请求失败:', e.name, e.message,
      '| 请求地址:', (API_BASE || location.origin) + '/api/transform');
    toast('AI 转化失败：连不上后端（请确认后端已部署，详见控制台 F12）');
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
 * 三、我的情绪记录（仅登录用户）
 * ============================================================ */
function getRecords() {
  try { return JSON.parse(localStorage.getItem('dryer_records') || '[]'); }
  catch { return []; }
}
function saveRecords(list) {
  localStorage.setItem('dryer_records', JSON.stringify(list));
}
function saveRecord(result) {
  if (State.user.provider === 'guest') return; // 游客不保存
  const list = getRecords();
  list.unshift({
    id: 'r_' + Date.now() + '_' + randStr(4),
    input: State.lastInput,
    result: result.content || '',
    resultType: result.type,
    resultHtml: result.html || null,
    time: Date.now(),
  });
  // 最多保留 50 条
  if (list.length > 50) list.length = 50;
  saveRecords(list);
}
function renderRecords() {
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
  const list = getRecords();
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
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const filtered = getRecords().filter(r => r.id !== id);
      saveRecords(filtered);
      renderRecords();
      toast('已删除');
    });
  });
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
function initRecords() {
  $('#btn-clear-records').addEventListener('click', () => {
    if (confirm('确定清空全部记录吗？此操作不可恢复。')) {
      saveRecords([]);
      renderRecords();
      toast('已清空全部记录');
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

// 从后端拉取全部言论
async function fetchTreehole() {
  try {
    const res = await fetchWithTimeout(API_BASE + '/api/treehole', {}, 6000);
    const data = await res.json();
    return data.posts || [];
  } catch (e) {
    console.error('[treehole/前端] 拉取失败:', e.name, e.message, '| 地址:', (API_BASE || location.origin) + '/api/treehole');
    return null; // 后端不可用时返回 null，调用方据此显示失败态
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
  // 点赞：调后端 toggle，本地用 th_liked_ids 记红心
  $$('.th-like').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      let likedIds = getLikedIds();
      const isLiked = likedIds.includes(id);
      btn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/api/treehole/' + id + '/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ liked: !isLiked }),
        });
        const data = await res.json();
        if (isLiked) likedIds = likedIds.filter(i => i !== id);
        else likedIds.push(id);
        setLikedIds(likedIds);
        // 同步更新本地缓存的赞数，避免等轮询才变
        const post = State.treeholePosts.find(p => p.id === id);
        if (post) post.likes = data.likes;
        renderTreehole(State.treeholePosts);
      } catch (e) {
        toast('网络异常，稍后再试');
      } finally {
        btn.disabled = false;
      }
    });
  });
  // 回复：调后端，用返回的最新列表重渲染
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
      btn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/api/treehole/' + id + '/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });
        const data = await res.json();
        State.treeholePosts = data.posts || [];
        State.treeholeSignature = thSignature(State.treeholePosts);
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
  if (posts === null) {
    if (!silent) $('#th-list').innerHTML = '<div class="th-empty">加载失败，稍后再试</div>';
    return;
  }
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
  // 发表言论：POST 到后端，服务端生成 id/时间戳/匿名标识
  $('#btn-th-post').addEventListener('click', async () => {
    const input = $('#th-input');
    const text = input.value.trim();
    if (!text) { toast('写点什么吧'); return; }
    if (detectSensitive(text)) {
      toast('检测到敏感内容，如需帮助请拨打心理援助热线 12356');
      return;
    }
    const btn = $('#btn-th-post');
    btn.disabled = true;
    try {
      const res = await fetch(API_BASE + '/api/treehole', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      // 用后端返回的最新列表刷新（新帖已在顶部，按时间倒序）
      State.treeholePosts = data.posts || [];
      State.treeholeSignature = thSignature(State.treeholePosts);
      input.value = '';
      renderTreehole(State.treeholePosts);
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
  checkFileProtocol();
  // 先探测可用后端地址，再初始化各模块（确保树洞/AI 发往正确地址）
  await detectApiBase();
  console.log('[情绪烘干机] 最终 API_BASE =', API_BASE || '(同源/当前域名)');
  initEntry();
  initSetup();
  initNav();
  initDryerStages();
  initTreehole();
  initRecords();
}
document.addEventListener('DOMContentLoaded', init);
