// offer-coach 云函数：业务接口 —— Day 17（读）/ Day 18（写）/ Day 19（分层重构）
// 形态：HTTP 函数（CloudBase 模板形态：Node.js 内置 http 模块起常驻服务，监听 9000 端口）
// 职责：一个函数按路径分发多个接口——
//   GET  /api/health → 健康检查（保持 Day 15 已上线的扁平结构，一字不改）
//   GET  /api/jobs   → 读数据库，返回岗位清单 + 技能总表（统一信封结构，见 api-contract.md 3.2）
//   POST /api/skills → 写数据库，新增一条自定义技能（见 api-contract.md 3.5）—— Day 18
//
// 【Day 19 分层重构 · 重要】
//   本文件（接口层）从此【不再碰数据库】。所有表名、字段名、查询语句都搬到了
//   ./db.js（数据访问层）。本文件只负责：解析请求 → 校验参数 → 调 db.js 的函数
//   → 拼响应。所以在这里搜不到 select / insert / 表名 / 蛇形字段名，这是刻意的。
//   改动约定：改数据库相关（表结构、字段、查询条件）→ 改 db.js；
//             改接口相关（参数校验、中文提示、响应形状）→ 改本文件。
//
// 【板块③ 上线记录】部署与路由有 3 个坑，重新部署时照做：
//   1. 部署命令：tcb fn deploy api --httpFn --force -e <envId>（别加 --path，路由已存在）
//   2. 网关路由：/api/jobs → api，类型必须是 WEB_SCF（HTTP 函数），且「路径透传」要打开；
//      CLI 的 --path 会误建为 SCF 类型，导致 FUNCTIONS_PARAM_INVALID
//   3. 访问域名要用 API 服务域名 <envId>-1496995497.ap-shanghai.app.tcloudbase.com；
//      CLI 打印的 <envId>.service.tcloudbase.com 那条路走不通
//
// 边界：Day 18 只做「新增一条自定义技能」这一个写接口；
//       PATCH / DELETE（修改、删除）与批量写入一律留到第 4 周。
//
// 【Day 18 要点】防重复提交是两层，缺一不可：
//   第一层 = 写库前先按 name 查一次库，命中直接返回 code:1005 + 中文提示（给用户看的人话）；
//   第二层 = skills.name 上的 UNIQUE 约束兜底（两层都在 db.js 里实现，
//            本文件只根据 db.js 返回的结果决定回什么中文提示）。

const http = require("http");
// 数据访问层：凡是跟数据库有关的，都从这里取，本文件不直接接触数据库
const store = require("./db");

const SERVICE = "offer-coach-api";
const VERSION = "0.4.0";
const PORT = process.env.PORT || 9000;

// 统一的 JSON 响应出口
function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // 【注意】这里【不要】再设 Access-Control-Allow-Origin！
  // CloudBase 网关（tcbgw）自带跨域处理：请求带 Origin 时它会回显 origin 并叠加我们返回的头，
  // 叠出来 "origin,*" 两个值 —— 这个头只允许单值，浏览器会直接判定跨域失败（Failed to fetch）。
  // 跨域交给网关，函数层一个跨域头都不要碰（Day 17 板块⑤ 踩过的坑）。
  res.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// GET /api/health —— 健康检查（与 Day 15 上线的结构保持完全一致）
// ---------------------------------------------------------------------------
function handleHealth(res) {
  sendJson(res, 200, {
    status: "ok",
    service: SERVICE,
    version: VERSION,
    env: process.env.TCB_ENV || "unknown",
    time: new Date().toISOString()
  });
}

// ---------------------------------------------------------------------------
// GET /api/jobs —— 岗位清单 + 技能总表
// 支持查询参数（余力加练）：?limit=N  限制返回的岗位条数（1-100）
// 本函数只做「校验参数 + 拼响应」，取数据交给 db.js
// ---------------------------------------------------------------------------
async function handleJobs(req, res, query) {
  // 查询参数：limit 限制作业条数，缺省返回全部
  var limit = null;
  if (query.limit !== undefined && query.limit !== "") {
    var n = Number(query.limit);
    if (!Number.isFinite(n) || n < 1) {
      return sendJson(res, 200, {
        code: 1002,
        message: "limit 参数不合法，请传 1-100 之间的整数",
        data: null
      });
    }
    limit = Math.min(Math.floor(n), 100);
  }

  try {
    // 取数交给数据访问层，本层只关心「拿到什么、怎么回」
    var jobs = await store.listJobs(limit);
    var skills = await store.listSkills();

    sendJson(res, 200, {
      code: 0,
      message: "ok",
      data: {
        jobs: jobs,
        skills: skills
      }
    });
  } catch (err) {
    console.error("[api/jobs] query failed:", err && err.message);
    sendJson(res, 200, {
      code: 2001,
      message: "服务暂时不可用，请稍后重试",
      data: null
    });
  }
}

// （原 describeError / describeErrorFull / isDuplicateError 已搬到 db.js ——
//  它们都是「怎么理解数据库的报错」，属于数据访问层的知识）

// ---------------------------------------------------------------------------
// POST /api/skills —— 新增一条自定义技能（Day 18）
// 契约：api-contract.md 3.5
// 本函数只做「校验 + 调 db.js + 拼响应」，防重复的两层判断在 db.js 里
// ---------------------------------------------------------------------------

// 允许的取值，与 db/schema.sql 里的 CHECK 约束保持一致（改这里必须同步改表约束）
var SKILL_CATEGORIES = ["语言", "框架", "工具", "其他"];
var SKILL_STAGES = ["基础", "进阶", "高级"];
var NAME_MAX_LEN = 40;
var NOTE_MAX_LEN = 200;
var MAX_BODY_BYTES = 10 * 1024; // 请求体上限 10KB，防止超大请求把函数拖死

// 【板块① 新增】读请求体。
// Day 17 只有 GET（数据都在 URL 上），代码里没有任何解析请求体的能力，必须补上。
// 原生 http 的请求体是一个「流」，要一小块一小块收（data 事件），收完了才触发 end。
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      var raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return reject(new Error("empty"));
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("bad-json"));
      }
    });
    req.on("error", function () {
      reject(new Error("read-error"));
    });
  });
}

// 业务错误统一出口：HTTP 一律 200，成败看 code（api-contract.md 1.4）
function sendBizError(res, code, message) {
  return sendJson(res, 200, { code: code, message: message, data: null });
}

// 服务端日志（Day 18「余力加练」）：每笔写入都留一行，以后排查问题不用瞎猜
function logWrite(action, detail) {
  console.log(
    "[api/skills] " + new Date().toISOString() + " " + action + "｜" + detail
  );
}

async function handleCreateSkill(req, res) {
  // ---- 第一步：把请求体读出来并解析成对象 ----
  var body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    var why = e && e.message;
    if (why === "too-large") {
      return sendBizError(res, 1002, "提交内容太长了，请精简后再试");
    }
    // 空 body / JSON 语法错误 / 读流失败，在用户看来都是「格式不对」
    return sendBizError(res, 1002, "请求格式不对，请检查提交内容");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendBizError(res, 1002, "请求格式不对，请检查提交内容");
  }

  // ---- 第二步：逐个字段校验（先便宜的后贵的，全部在写库之前拦掉）----
  var name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return sendBizError(res, 1001, "请把技能名填上");
  }
  if (name.length > NAME_MAX_LEN) {
    return sendBizError(res, 1002, "技能名太长了，请控制在 40 字以内");
  }

  var category = typeof body.category === "string" ? body.category.trim() : "";
  if (!category) {
    return sendBizError(res, 1001, "请选择技能分类");
  }
  if (SKILL_CATEGORIES.indexOf(category) === -1) {
    return sendBizError(res, 1002, "分类只能是：语言、框架、工具、其他");
  }

  var stage = typeof body.stage === "string" ? body.stage.trim() : "";
  if (!stage) {
    return sendBizError(res, 1001, "请选择学习阶段");
  }
  if (SKILL_STAGES.indexOf(stage) === -1) {
    return sendBizError(res, 1002, "学习阶段只能是：基础、进阶、高级");
  }

  var note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) {
    return sendBizError(res, 1001, "请写一句话说明这个技能是做什么的");
  }
  if (note.length > NOTE_MAX_LEN) {
    return sendBizError(res, 1002, "说明太长了，请控制在 200 字以内");
  }

  try {
    // ---- 第三步（防重复第一层）：写库前先查一次重名，为的是给用户一句人话 ----
    // 「aliases / source 这些入库字段怎么填」归 db.js 管，本层只管「重名了该回什么话」
    var taken = await store.isSkillNameTaken(name);
    if (taken) {
      logWrite("重复提交被拒（查重层）", "技能名=" + name);
      return sendBizError(res, 1005, "这个技能已经在清单里了，不用重复添加");
    }

    // ---- 第四步（防重复第二层）：写库，唯一约束兜底 ----
    // db.js 会把数据库的 23505 翻译成 duplicate:true，本层据此回同一句中文提示
    var saved = await store.insertSkill({
      name: name,
      category: category,
      stage: stage,
      note: note
    });
    if (saved.duplicate) {
      // 并发时两条请求都通过了查重，第二条会走到这里
      logWrite("重复提交被拒（数据库层）", "技能名=" + name);
      return sendBizError(res, 1005, "这个技能已经在清单里了，不用重复添加");
    }

    logWrite("写入成功", "技能名=" + name + "／分类=" + category + "／阶段=" + stage);
    sendJson(res, 200, {
      code: 0,
      message: "ok",
      data: { skill: saved.skill }
    });
  } catch (err) {
    logWrite("写入失败", "技能名=" + name + "／原因=" + (err && err.message));
    console.error("[api/skills] create failed:", err && err.message);
    // 对外只回笼统提示，数据库原始报错只留在服务端日志里，不暴露给请求方
    sendJson(res, 200, {
      code: 2001,
      message: "服务暂时不可用，请稍后重试",
      data: null
    });
  }
}

// ---------------------------------------------------------------------------
// 路径分发
// ---------------------------------------------------------------------------
var server = http.createServer(function (req, res) {
  var url = new URL(req.url, "http://localhost");
  var pathname = url.pathname;
  var query = {};
  url.searchParams.forEach(function (v, k) {
    query[k] = v;
  });

  if (pathname === "/api/health") {
    return handleHealth(res);
  }
  if (pathname === "/api/jobs") {
    return handleJobs(req, res, query);
  }
  if (pathname === "/api/skills" && req.method === "POST") {
    return handleCreateSkill(req, res);
  }

  // 未注册的路径
  sendJson(res, 404, {
    code: 1004,
    message: "接口不存在：" + pathname,
    data: null
  });
});

server.listen(PORT, function () {
  console.log("offer-coach api listening on port " + PORT);
});
