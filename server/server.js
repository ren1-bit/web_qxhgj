/**
 * 情绪烘干机 - 极简后端
 * 提供两类接口：
 *   1. 树洞匿名留言（内存存储，GET/POST /api/treehole 及点赞、回复）
 *   2. 情绪转化（POST /api/transform，调用智谱 GLM glm-4-flash）
 *
 * 环境变量（云端平台需在设置页配置，本地写在 server/.env）：
 *   - GLM_API_KEY  智谱 API Key（必填，否则 /api/transform 不可用）
 *   - PORT         服务端口（选填，默认 3000）
 *   注意：API Key 只存后端环境变量，绝不写进前端代码。
 *
 * 部署步骤（Cloudy / Railway / Render / 本地均可）：
 * 1. 进入 server 目录：cd server
 * 2. 安装依赖：npm install
 * 3. 启动服务：npm start
 * 4. 前端 app.js 顶部常量 API_BASE 改为本服务地址
 *    - 本地开发：http://localhost:3000
 *    - 部署后：https://你的后端域名
 *
 * 说明：树洞为内存存储，重启后清空，属演示阶段预期行为。
 *       日志只打印接口名与时间，绝不打印用户输入与言论内容。
 */
// 简易 .env 加载（无需 dotenv 依赖，自动读取 server/.env）
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  });
}

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 允许前端跨域访问
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/* ===== 树洞：公共匿名留言墙（内存存储） =====
 * 内存变量存储，重启后清空，属演示阶段预期行为。
 * 日志只打印接口调用与时间，绝不打印言论内容，守住匿名承诺。
 */
let treeholePosts = [];

// 生成匿名标识，不关联任何身份信息
function genAnonTag() {
  return '匿名网友 #' + Math.random().toString(36).slice(2, 5);
}

// 返回按时间倒序的列表副本
function sortedTreehole() {
  return treeholePosts.slice().sort((a, b) => b.time - a.time);
}

// 获取所有言论
app.get('/api/treehole', (req, res) => {
  console.log(`[treehole/get] time=${new Date().toISOString()}`);
  res.json({ posts: sortedTreehole() });
});

// 发表言论：服务端生成 id、时间戳、匿名标识
app.post('/api/treehole', (req, res) => {
  const content = req.body && req.body.content;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '内容为空' });
  }
  const post = {
    id: 'th_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    content: content.trim().slice(0, 200),
    anon: genAnonTag(),
    time: Date.now(),
    likes: 0,
    replies: [],
  };
  treeholePosts.unshift(post);
  // 日志不打印 content
  console.log(`[treehole/post] id=${post.id} time=${new Date(post.time).toISOString()}`);
  res.json({ posts: sortedTreehole() });
});

// 点赞 toggle：body { liked: true/false }，true +1，false -1
app.post('/api/treehole/:id/like', (req, res) => {
  const id = req.params.id;
  const liked = !!(req.body && req.body.liked);
  const post = treeholePosts.find(p => p.id === id);
  if (!post) return res.status(404).json({ error: 'not found' });
  if (liked) post.likes = (post.likes || 0) + 1;
  else post.likes = Math.max(0, (post.likes || 0) - 1);
  console.log(`[treehole/like] id=${id} liked=${liked} time=${new Date().toISOString()}`);
  res.json({ likes: post.likes });
});

// 匿名回复：body { content }
app.post('/api/treehole/:id/reply', (req, res) => {
  const id = req.params.id;
  const content = req.body && req.body.content;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '内容为空' });
  }
  const post = treeholePosts.find(p => p.id === id);
  if (!post) return res.status(404).json({ error: 'not found' });
  post.replies = post.replies || [];
  post.replies.push({
    content: content.trim().slice(0, 100),
    anon: genAnonTag(),
    time: Date.now(),
  });
  // 日志不打印 content
  console.log(`[treehole/reply] id=${id} time=${new Date().toISOString()}`);
  res.json({ posts: sortedTreehole() });
});

/* ===== 情绪转化：调用智谱 GLM API =====
 * API Key 从环境变量 process.env.GLM_API_KEY 读取（云端平台配置或本地 server/.env）。
 * 绝不硬编码在代码中，绝不暴露给前端。
 * 请求地址：https://open.bigmodel.cn/api/paas/v4/chat/completions （智谱官方，按量付费 Key 用此地址）
 * Node 18+ 内置全局 fetch，无需额外依赖。
 */
const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const GLM_MODEL = 'glm-4-flash';
const GLM_SYSTEM_PROMPT = '你是一个温暖、幽默的解压助手。用户会向你倾诉生活和职场的烦恼。请你把他的话改写成一段搞笑脱口秀或者一首豁达的诗。要求：不说教、不评判，带一点发疯文学或苏东坡的豁达感，字数100字以内。';

app.post('/api/transform', async (req, res) => {
  const input = req.body && req.body.input;
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return res.status(400).json({ error: '内容为空' });
  }
  // 日志不打印用户输入内容，守住隐私承诺
  console.log(`[transform] time=${new Date().toISOString()}`);

  // 实时读取环境变量（避免模块加载时机问题，兼容云端延迟注入）
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error('[transform/error] 环境变量 GLM_API_KEY 未配置或为空');
    return res.status(500).json({
      error: '后端未配置 GLM_API_KEY 环境变量',
      errorDetail: 'process.env.GLM_API_KEY is empty. 请在云平台环境变量中配置 GLM_API_KEY',
    });
  }

  try {
    const resp = await fetch(GLM_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        messages: [
          { role: 'system', content: GLM_SYSTEM_PROMPT },
          { role: 'user', content: input.trim().slice(0, 500) },
        ],
      }),
    });

    // 先读取响应体文本（无论成功失败），再统一解析
    const respText = await resp.text();
    let respData = null;
    try { respData = JSON.parse(respText); } catch (_) { /* 非 JSON 响应 */ }

    if (!resp.ok) {
      // 智谱错误格式通常为 { "error": { "code": "1113", "message": "余额不足" } } 或 { "msg": "..." }
      const glmErr = respData && (respData.error || {});
      const errMsg = (glmErr.message) || (respData && respData.msg) || respText;
      console.error(`[transform/error] HTTP ${resp.status} | 智谱返回:`, errMsg);
      return res.status(resp.status).json({
        error: `GLM 接口返回 HTTP ${resp.status}`,
        errorDetail: typeof errMsg === 'string' ? errMsg.slice(0, 500) : JSON.stringify(errMsg).slice(0, 500),
        glmCode: glmErr.code || (respData && respData.code) || null,
      });
    }

    const content = respData &&
      respData.choices &&
      respData.choices[0] &&
      respData.choices[0].message &&
      respData.choices[0].message.content;

    if (!content || !content.trim()) {
      console.error('[transform/error] GLM 返回内容为空，原始响应:', respText.slice(0, 500));
      return res.status(502).json({
        error: 'GLM 返回内容为空',
        errorDetail: respText.slice(0, 500),
      });
    }

    res.json({ type: 'ai', content: content.trim() });
  } catch (e) {
    // 网络异常、超时、DNS 解析失败等
    // Node fetch 的底层原因在 e.cause（如 ENOTFOUND / ECONNREFUSED / ETIMEDOUT / TLS 错误）
    const cause = e && e.cause;
    const causeCode = cause && (cause.code || cause.errno) || '';
    const causeMsg = cause && (cause.message || cause.reason) || '';
    const detail = `${e.name}: ${e.message}` + (cause ? ` | cause: ${causeCode} ${causeMsg}` : '');
    console.error('[transform/error] 网络异常:', detail);
    res.status(500).json({
      error: '调用 GLM 网络异常',
      errorDetail: detail,
    });
  }
});

/* ===== 网络诊断接口：排查沙箱出站网络是否可达智谱 =====
 * 返回 Node 版本、fetch 可用性，以及对智谱域名 / 一个通用域名的实测请求结果。
 * 只读诊断，不打印 Key。供云端排查 fetch failed 根因。
 */
app.get('/api/diag', async (req, res) => {
  const out = {
    node: process.version,
    hasFetch: typeof fetch === 'function',
    glmKeySet: !!(process.env.GLM_API_KEY && process.env.GLM_API_KEY.trim()),
    tests: {},
  };
  const probe = async (name, url, opts) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await r.text();
      out.tests[name] = { ok: true, status: r.status, bodyHead: text.slice(0, 200) };
    } catch (e) {
      const c = e && e.cause;
      out.tests[name] = {
        ok: false,
        error: `${e.name}: ${e.message}`,
        cause: c ? `${c.code || c.errno || ''} ${c.message || c.reason || ''}`.trim() : null,
      };
    }
  };
  // 通用外网连通性
  await probe('example', 'https://example.com');
  // 智谱域名连通性（GET，非鉴权，仅测网络可达）
  await probe('glm', GLM_URL, { method: 'GET' });
  res.json(out);
});

/* ===== 托管前端静态文件（单端口同源部署）=====
 * 云端 Cloady / 单端口平台：同一个 Express 服务同时提供 API 与前端页面，
 * 前端 API_BASE 探测同源 /api/health 即可命中，无需跨域、无需单独静态托管。
 * 安全：只白名单 index.html / styles.css / app.js 三个文件，
 *       绝不暴露 server 目录或 .env（内含 API Key）。
 */
const FRONTEND_ROOT = path.join(__dirname, '..');
const STATIC_WHITELIST = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/styles.css': 'styles.css',
  '/app.js': 'app.js',
  '/favicon.ico': 'favicon.ico',
};
for (const [route, file] of Object.entries(STATIC_WHITELIST)) {
  app.get(route, (req, res) => {
    const full = path.join(FRONTEND_ROOT, file);
    if (fs.existsSync(full)) {
      res.sendFile(full);
    } else {
      res.status(404).send('Not Found');
    }
  });
}

app.listen(PORT, () => {
  console.log(`情绪烘干机后端已启动：http://localhost:${PORT}`);
  console.log('前端页面与 API 均由本服务提供（同源部署）。');
  // 打印 GLM_API_KEY 配置状态（只显示前4位用于核对，不泄露完整 Key）
  const k = process.env.GLM_API_KEY || '';
  if (k) {
    console.log(`GLM_API_KEY 已配置 (前4位: ${k.slice(0, 4)}... 长度 ${k.length})`);
  } else {
    console.warn('⚠️  GLM_API_KEY 未配置！/api/transform 将无法调用智谱 AI。');
    console.warn('   本地：在 server/.env 写入 GLM_API_KEY=你的key');
    console.warn('   云端：在平台环境变量中配置 GLM_API_KEY');
  }
});
