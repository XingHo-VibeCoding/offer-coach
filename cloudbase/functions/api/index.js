// offer-coach 云函数：业务接口 —— Day 17
// 形态：HTTP 函数（CloudBase 模板形态：Node.js 内置 http 模块起常驻服务，监听 9000 端口）
// 职责：一个函数按路径分发多个接口——
//   GET /api/health → 健康检查（保持 Day 15 已上线的扁平结构，一字不改）
//   GET /api/jobs   → 读数据库，返回岗位清单 + 技能总表（统一信封结构，见 api-contract.md 3.2）
// 【板块③ 上线记录】部署与路由有 3 个坑，重新部署时照做：
//   1. 部署命令：tcb fn deploy api --httpFn --force -e <envId>（别加 --path，路由已存在）
//   2. 网关路由：/api/jobs → api，类型必须是 WEB_SCF（HTTP 函数），且「路径透传」要打开；
//      CLI 的 --path 会误建为 SCF 类型，导致 FUNCTIONS_PARAM_INVALID
//   3. 访问域名要用 API 服务域名 <envId>-1496995497.ap-shanghai.app.tcloudbase.com；
//      CLI 打印的 <envId>.service.tcloudbase.com 那条路走不通
//
// 边界：本期只做读接口；写入接口（收藏/进度）留到 Day 18。
//
// 【板块② 改动】连库方式从「pg 直连 + 环境变量传密码」改为「官方 Node SDK」。
// 原因：实测发现本环境根本没有超级用户、默认账号也无建角色权限（自建账号走不通），
//       而平台给云函数预留了专用数据库角色，官方 Node SDK 只要环境 ID 就能读库，零密码。
// 这样也顺带消掉了原来的两个风险：服务端 SSL 是关的、数据库地址是公网地址。

const http = require("http");
const cloudbase = require("@cloudbase/node-sdk");

const SERVICE = "offer-coach-api";
const VERSION = "0.2.0";
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
