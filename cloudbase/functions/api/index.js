// offer-coach 云函数：业务接口 —— Day 17（读）/ Day 18（写）
// 形态：HTTP 函数（CloudBase 模板形态：Node.js 内置 http 模块起常驻服务，监听 9000 端口）
// 职责：一个函数按路径分发多个接口——
//   GET  /api/health → 健康检查（保持 Day 15 已上线的扁平结构，一字不改）
//   GET  /api/jobs   → 读数据库，返回岗位清单 + 技能总表（统一信封结构，见 api-contract.md 3.2）
//   POST /api/skills → 写数据库，新增一条自定义技能（见 api-contract.md 3.5）—— Day 18
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
//   第二层 = skills.name 上的 UNIQUE 约束兜底 —— 「先查后写」中间有时间窗口，
//            并发时两条请求可能都查到「不存在」然后都去写，这时第二条会被数据库顶回来；
//            数据库报的 23505 也翻译成同一个 1005，绝不让用户看到英文报错。
//
// 【板块② 改动】连库方式从「pg 直连 + 环境变量传密码」改为「官方 Node SDK」。
// 原因：实测发现本环境根本没有超级用户、默认账号也无建角色权限（自建账号走不通），
//       而平台给云函数预留了专用数据库角色，官方 Node SDK 只要环境 ID 就能读库，零密码。
// 这样也顺带消掉了原来的两个风险：服务端 SSL 是关的、数据库地址是公网地址。

const http = require("http");
const cloudbase = require("@cloudbase/node-sdk");

const SERVICE = "offer-coach-api";
const VERSION = "0.3.0";
const PORT = process.env.PORT || 9000;

// ---------------------------------------------------------------------------
// 数据库客户端
// TCB_ENV 是平台自动注入的环境 ID（不是密钥，公开无害）；本地调试时可手动指定。
// 模块顶层初始化一次，让云函数实例复用，避免每次请求重建。
// ---------------------------------------------------------------------------
const ENV_ID = process.env.TCB_ENV || "offer-coach-d0ge7jkzfc47e2079";
const app = cloudbase.init({ env: ENV_ID });
// 【关键】必须显式指定 schema 为 public。
// 原因：SDK 里 rdb() 的默认值是 `database = envId`，而该值会作为
// Accept-Profile / Content-Profile 头（PostgREST 的 schema 参数）发出，
// 于是服务端报 "Invalid schema: offer-coach-...".
const db = app.rdb({ database: "public" });

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
// ---------------------------------------------------------------------------
var JOBS_COLUMNS = "name, intro, duty, required_skills";
var SKILLS_COLUMNS = "name, category, stage, note, aliases, related_jobs, source";

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
    // 岗位：按 id 升序（保证每次返回顺序稳定）
    var jobsQuery = db.from("jobs").select(JOBS_COLUMNS).order("id", { ascending: true });
    if (limit) {
      jobsQuery = jobsQuery.limit(limit);
    }
    var jobsResult = await jobsQuery;

    // 技能总表：随岗位一起下发，不分设接口
    var skillsResult = await db
      .from("skills")
      .select(SKILLS_COLUMNS)
      .order("id", { ascending: true });

    if (jobsResult.error) throw new Error("jobs: " + describeError(jobsResult.error));
    if (skillsResult.error) throw new Error("skills: " + describeError(skillsResult.error));

    var jobs = (jobsResult.data || []).map(function (r) {
      return {
        name: r.name,
        intro: r.intro,
        duty: r.duty,
        requiredSkills: r.required_skills
      };
    });

    var skills = (skillsResult.data || []).map(function (r) {
      return {
        name: r.name,
        category: r.category,
        stage: r.stage,
        note: r.note,
        aliases: r.aliases,
        relatedJobs: r.related_jobs,
        source: r.source
      };
    });

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

// 把 SDK 返回的 error 对象压成一行可读文本，方便看日志
function describeError(e) {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  return e.message || JSON.stringify(e);
}

// 写库/查库失败时用这个——describeError 只取 message，
// 而 PostgREST 报错的关键信息在 code（如 42501=权限不足）和 details 里，只走服务端日志，不返回给请求方。
function describeErrorFull(e) {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  var parts = [];
  if (e.code) parts.push("code=" + e.code);
  if (e.message) parts.push("message=" + e.message);
  if (e.details) parts.push("details=" + e.details);
  if (e.hint) parts.push("hint=" + e.hint);
  return parts.length ? parts.join(" ｜ ") : JSON.stringify(e);
}

// ---------------------------------------------------------------------------
// POST /api/skills —— 新增一条自定义技能（Day 18）
// 契约：api-contract.md 3.5
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

// 服务端日志（今日「余力加练」）：每笔写入都留一行，以后排查问题不用瞎猜
function logWrite(action, detail) {
  console.log(
    "[api/skills] " + new Date().toISOString() + " " + action + "｜" + detail
  );
}

// 判断是不是「唯一约束冲突」——PostgreSQL 的 SQLSTATE 就是 23505
function isDuplicateError(e) {
  if (!e) return false;
  if (e.code === "23505") return true;
  return /duplicate key|already exists/i.test(e.message || "");
}

// 把数据库的行映射成对外的驼峰字段，形状必须与 GET /api/jobs 里的 skills 元素一致
function toSkillJson(row) {
  return {
    name: row.name,
    category: row.category,
    stage: row.stage,
    note: row.note,
    aliases: row.aliases,
    relatedJobs: row.related_jobs,
    source: row.source
  };
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

  // source / aliases / related_jobs 由服务端定死，客户端传什么都不认——
  // 否则客户端可以伪造 source:"预设" 往技能总表里混假数据
  var row = {
    name: name,
    category: category,
    stage: stage,
    note: note,
    aliases: [],
    related_jobs: [],
    source: "用户自定义"
  };

  try {
    // ---- 第三步（防重复第一层）：写库前先查一次重名，为的是给用户一句人话 ----
    var dupResult = await db.from("skills").select("name").eq("name", name).limit(1);
    if (dupResult.error) {
      throw new Error("查重失败：" + describeErrorFull(dupResult.error));
    }
    if (dupResult.data && dupResult.data.length > 0) {
      logWrite("重复提交被拒（查重层）", "技能名=" + name);
      return sendBizError(res, 1005, "这个技能已经在清单里了，不用重复添加");
    }

    // ---- 第四步（防重复第二层）：写库，唯一约束兜底 ----
    var insertResult = await db.from("skills").insert(row);
    if (insertResult.error) {
      if (isDuplicateError(insertResult.error)) {
        // 并发时两条请求都通过了查重，第二条会走到这里
        logWrite("重复提交被拒（数据库层）", "技能名=" + name);
        return sendBizError(res, 1005, "这个技能已经在清单里了，不用重复添加");
      }
      throw new Error("写库失败：" + describeErrorFull(insertResult.error));
    }

    logWrite("写入成功", "技能名=" + name + "／分类=" + category + "／阶段=" + stage);
    sendJson(res, 200, {
      code: 0,
      message: "ok",
      data: { skill: toSkillJson(row) }
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
