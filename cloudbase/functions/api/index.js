// offer-coach 云函数：业务接口 —— Day 17（读）/ Day 18（写）/ Day 19（分层重构）/ Day 22（改·删）
// 形态：HTTP 函数（CloudBase 模板形态：Node.js 内置 http 模块起常驻服务，监听 9000 端口）
// 职责：一个函数按路径分发多个接口——
//   GET    /api/health       → 健康检查（保持 Day 15 已上线的扁平结构，一字不改）
//   GET    /api/jobs         → 读数据库，返回岗位清单 + 技能总表（统一信封结构，见 api-contract.md 3.2）
//   POST   /api/skills       → 写数据库，新增一条自定义技能（见 api-contract.md 3.5）—— Day 18
//   PATCH  /api/skills?id=N  → 修改一条自定义技能（见 api-contract.md 3.6.1）—— Day 22
//   DELETE /api/skills?id=N  → 删除一条自定义技能（见 api-contract.md 3.6.2）—— Day 22
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
// 【Day 22 要点 · 改/删的防呆三层】——为什么删除比新增更容易出事：
//   新增错了可以删掉重来；删除不可逆，还会让别处引用它的地方变成「悬空」（岗位里存的技能名找不到了）。
//   所以改 / 删接口固定三层防护，一层比一层靠前：
//     ① 参数层：id 缺失 / 非正整数 → 1001，不进数据库
//     ② 存在层：先按 id 查一条，查不到 → 1004（不能直接 UPDATE/DELETE：
//        数据库对「没匹配到行」不报错，只会静默影响 0 行，接口若照回「成功」就是骗用户）
//     ③ 权限层：source 不是「用户自定义」→ 1006（预设数据禁改禁删，防把技能总表改坏）
//   重名（改完跟别的技能重名）复用 1005；服务端锁死 source/aliases/relatedJobs，客户端伪造无效。
//
// 【Day 18 要点】防重复提交是两层，缺一不可：
//   第一层 = 写库前先按 name 查一次库，命中直接返回 code:1005 + 中文提示（给用户看的人话）；
//   第二层 = skills.name 上的 UNIQUE 约束兜底（两层都在 db.js 里实现，
//            本文件只根据 db.js 返回的结果决定回什么中文提示）。

const http = require("http");
// 数据访问层：凡是跟数据库有关的，都从这里取，本文件不直接接触数据库
const store = require("./db");

const SERVICE = "offer-coach-api";
const VERSION = "0.5.0";
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
// 【Day 29 · 写接口防滥用】两道闸门，都在「进入业务逻辑之前」拦
// 背景（BACKLOG 第 15 条）：/api/skills 的写接口对公网匿名开放，知道地址就能写，
//   此前只有「技能名唯一」一层保护，没有任何频率限制 —— 一个脚本狂调就能把库塞满。
// 为什么防线放在云函数、不放前端：前端校验能被绕过（curl 直接打接口），
//   只有服务端校验才是真防线。这与 Day 18「防重复两层」的思路一致。
// ---------------------------------------------------------------------------

// ---- 闸门 ①：Origin 校验（只拦写请求）----
// 放行规则：
//   · 请求没带 Origin → 放行（curl/Postman 等非浏览器客户端不带 Origin）。
//     为什么放行而不是拦：本期是课程作品，保留命令行自测能力（Day 17-22 的验收全靠 curl）；
//     真正的刷量防护靠下面的限流，Origin 只负责挡「别的网站上的页面盗用接口」这一种情况。
//   · Origin 在放行名单里 → 放行
//   · 其他 Origin → 拦（1002）
// 【重要】本闸门【只读不写】请求头 —— 绝不设置 Access-Control-Allow-Origin！
//   跨域响应头由 CloudBase 网关统一处理，函数层碰它会把头叠成两个值，
//   浏览器直接判跨域失败（Day 17 板块⑤ 踩过，见 sendJson 上方注释）。
var ALLOWED_ORIGINS = [
  "https://offer-coach-d0ge7jkzfc47e2079-1496995497.tcloudbaseapp.com", // 主站（静态托管）
  "https://xingho-vibecoding.github.io",                                 // 备用站（GitHub Pages）
  "http://127.0.0.1:8899"                                                // 本地调试
];

function isOriginAllowed(origin) {
  // 只有「请求头完全不存在」才放行（curl/Postman 等非浏览器客户端不带 Origin）。
  // 注意区分 undefined 与空字符串：空串是「带了头但值畸形」，属于可疑输入，一律拦。
  if (origin === undefined || origin === null) return true;
  if (origin === "") return false;
  return ALLOWED_ORIGINS.indexOf(origin) !== -1;
}

// ---- 闸门 ②：滑动窗口限流（内存计数）----
// 规则：同一个来源 IP，在窗口期内最多写 N 次，超出返回 1007。
// 取值依据：人手动操作，正常 1 分钟能点 10 次就算很多了；给到 20 次留足余量。
// 【诚实说明 · 这不是严格限流】云函数可能被平台重启、也可能起多个实例，
//   每个实例各算各的内存计数。所以它是「尽力而为」的软限制：
//   能挡住脚本连续狂刷，挡不住精心设计的分布式绕过。
//   要严格限流得上 Redis/数据库计数，但会引入新依赖 + 消耗资源点（本期不做，见 BACKLOG 第 15 条）。
var RATE_LIMIT_MAX = 20;                    // 窗口内最多写多少次
var RATE_LIMIT_WINDOW_MS = 60 * 1000;       // 窗口长度：1 分钟
var rateBuckets = Object.create(null);      // { ip: [时间戳, ...] }

function takeClientIp(req) {
  // 网关会把真实来源放在 x-forwarded-for，取第一个（最靠近客户端的那个）
  var xff = req.headers["x-forwarded-for"];
  if (xff) {
    var first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  var direct = req.socket && req.socket.remoteAddress;
  return direct || "unknown";
}

/** 记一次写操作；返回 true=放行，false=超限 */
function rateLimitAllow(ip) {
  var now = Date.now();
  var hits = rateBuckets[ip] || [];
  // 滑动窗口：先把窗口外的旧记录清掉
  var fresh = hits.filter(function (t) { return now - t < RATE_LIMIT_WINDOW_MS; });
  if (fresh.length >= RATE_LIMIT_MAX) {
    rateBuckets[ip] = fresh;                // 顺手更新，保留有效记录
    return false;
  }
  fresh.push(now);
  rateBuckets[ip] = fresh;
  return true;
}

/** 写请求的统一前置检查：过了返回 null；没过返回该回给客户端的 payload */
function guardWrite(req) {
  var origin = req.headers["origin"];
  if (!isOriginAllowed(origin)) {
    console.log("[api/guard] 拒绝来源不明的写请求 origin=" + origin);
    return { code: 1002, message: "这个请求来源不被允许", data: null };
  }
  var ip = takeClientIp(req);
  if (!rateLimitAllow(ip)) {
    console.log("[api/guard] 触发限流 ip=" + ip + " 窗口=" +
      RATE_LIMIT_WINDOW_MS + "ms 上限=" + RATE_LIMIT_MAX);
    return { code: 1007, message: "操作太频繁了，请等一会儿再试", data: null };
  }
  return null;
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
// 【Day 22】改 / 删两个接口的公共前半段：「取 id + 查这条记录 + 校验能不能动」
// ---------------------------------------------------------------------------
// 为什么抽出来：PATCH 和 DELETE 的前三步一模一样（取 id → 查记录 → 卡预设数据），
// 只有最后「怎么改 / 怎么删」不同。抽出来避免两处抄一遍、改一处忘一处。
// 返回 { ok: false, code, message } → 调用方照原样回错误；
//      返回 { ok: true, id, skill }   → 调用方继续做自己的事。
async function loadEditableSkill(res, query) {
  // ---- 第①层：参数校验（便宜的先做，别为了一个空 id 去查库）----
  var rawId = query.id;
  if (rawId === undefined || rawId === "") {
    return { ok: false, code: 1001, message: "缺少要操作的技能编号" };
  }
  // Number("38") = 38；Number("38abc") = NaN；Number("") 上面已挡掉
  var id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return { ok: false, code: 1001, message: "技能编号不合法" };
  }

  // ---- 第②层：这条记录真的存在吗 ----
  // 不查就改 / 删，数据库会「影响 0 行而不报错」，接口就会把没干成的事说成干成了
  var skill = await store.getSkillById(id);
  if (!skill) {
    return { ok: false, code: 1004, message: "这条技能不存在，可能已被删除" };
  }

  // ---- 第③层：这条记录允许动吗 ----
  // 预设技能被改名会让岗位详情页指向不存在的名字（悬空引用），被删更是直接少一项，
  // 所以预设定为「只读」。source 由服务端从数据库读出判定，客户端无权声明。
  if (skill.source !== "用户自定义") {
    return {
      ok: false,
      code: 1006,
      message: "预设技能不能修改或删除，只能改自己添加的技能"
    };
  }

  return { ok: true, id: id, skill: skill };
}

// ---------------------------------------------------------------------------
// PATCH /api/skills?id=N —— 修改一条自定义技能（Day 22）
// 契约：api-contract.md 3.6.1
// 支持部分更新：请求体里只传要改的字段，其余保持原值
// ---------------------------------------------------------------------------
async function handleUpdateSkill(req, res, query) {
  // ---- 前半段（三层防呆里的前两层 + 预设校验）----
  var target;
  try {
    target = await loadEditableSkill(res, query);
  } catch (err) {
    logWrite("修改失败（查记录时出错）", "原因=" + (err && err.message));
    return sendBizError(res, 2001, "服务暂时不可用，请稍后重试");
  }
  if (!target.ok) {
    return sendBizError(res, target.code, target.message);
  }

  // ---- 读请求体 ----
  var body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    var why = e && e.message;
    if (why === "too-large") {
      return sendBizError(res, 1002, "提交内容太长了，请精简后再试");
    }
    return sendBizError(res, 1002, "请求格式不对，请检查提交内容");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return sendBizError(res, 1002, "请求格式不对，请检查提交内容");
  }

  // ---- 挑出「真要改的字段」，顺手做校验 ----
  // 注意：只认 name / category / stage / note 四个业务字段。
  // id / source / aliases / relatedJobs 即使客户端传了也一律无视（服务端锁定）。
  var patch = {};

  if (body.name !== undefined) {
    var name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return sendBizError(res, 1001, "请把技能名填上");
    if (name.length > NAME_MAX_LEN) return sendBizError(res, 1002, "技能名太长了，请控制在 40 字以内");
    patch.name = name;
  }

  if (body.category !== undefined) {
    var category = typeof body.category === "string" ? body.category.trim() : "";
    if (!category) return sendBizError(res, 1001, "请选择技能分类");
    if (SKILL_CATEGORIES.indexOf(category) === -1) {
      return sendBizError(res, 1002, "分类只能是：语言、框架、工具、其他");
    }
    patch.category = category;
  }

  if (body.stage !== undefined) {
    var stage = typeof body.stage === "string" ? body.stage.trim() : "";
    if (!stage) return sendBizError(res, 1001, "请选择学习阶段");
    if (SKILL_STAGES.indexOf(stage) === -1) {
      return sendBizError(res, 1002, "学习阶段只能是：基础、进阶、高级");
    }
    patch.stage = stage;
  }

  if (body.note !== undefined) {
    var note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) return sendBizError(res, 1001, "请写一句话说明这个技能是做什么的");
    if (note.length > NOTE_MAX_LEN) return sendBizError(res, 1002, "说明太长了，请控制在 200 字以内");
    patch.note = note;
  }

  // 一个可改字段都没传：与其静默回「成功」，不如直说没东西可改
  if (Object.keys(patch).length === 0) {
    return sendBizError(res, 1002, "没有要修改的内容");
  }

  try {
    var updated = await store.updateSkill(target.id, patch);
    if (updated.duplicate) {
      logWrite("修改被拒（重名）", "id=" + target.id + "／技能名=" + patch.name);
      return sendBizError(res, 1005, "这个技能已经在清单里了，不用重复添加");
    }
    if (updated.notFound) {
      // 查过之后、写之前被人删掉了（并发窗口）
      return sendBizError(res, 1004, "这条技能不存在，可能已被删除");
    }
    logWrite("修改成功", "id=" + target.id + "／改了=" + Object.keys(patch).join(","));
    sendJson(res, 200, { code: 0, message: "ok", data: { skill: updated.skill } });
  } catch (err) {
    logWrite("修改失败", "id=" + target.id + "／原因=" + (err && err.message));
    console.error("[api/skills] update failed:", err && err.message);
    sendBizError(res, 2001, "服务暂时不可用，请稍后重试");
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/skills?id=N —— 删除一条自定义技能（Day 22）
// 契约：api-contract.md 3.6.2
// 无请求体
// ---------------------------------------------------------------------------
async function handleDeleteSkill(req, res, query) {
  var target;
  try {
    target = await loadEditableSkill(res, query);
  } catch (err) {
    logWrite("删除失败（查记录时出错）", "原因=" + (err && err.message));
    return sendBizError(res, 2001, "服务暂时不可用，请稍后重试");
  }
  if (!target.ok) {
    return sendBizError(res, target.code, target.message);
  }

  try {
    var removed = await store.deleteSkill(target.id);
    if (removed.notFound) {
      return sendBizError(res, 1004, "这条技能不存在，可能已被删除");
    }
    logWrite("删除成功", "id=" + target.id + "／技能名=" + removed.deleted.name);
    // 删除不可逆，回执带上被删的 id + 名字，前端才好提示「已删除『xxx』」
    sendJson(res, 200, { code: 0, message: "ok", data: { deleted: removed.deleted } });
  } catch (err) {
    logWrite("删除失败", "id=" + target.id + "／原因=" + (err && err.message));
    console.error("[api/skills] delete failed:", err && err.message);
    sendBizError(res, 2001, "服务暂时不可用，请稍后重试");
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

  // 【Day 29】写接口的三道防线顺序（在进入任何业务逻辑之前）：
  //   ① 先看是不是写方法（POST/PATCH/DELETE）→ 不是就走下面的 404
  //   ② guardWrite：来源校验 + 限流 → 没过就返回，不进业务函数
  //   ③ 才轮到各业务函数做参数校验（1001/1002/1004/1005/1006）
  // 为什么统一在这里拦、而不是分散到三个 handleXxx 里：
  //   三个写接口的防滥用规则完全一样，写一处不易漏；将来加限流阈值也只改一个地方。
  var WRITE_METHODS = ["POST", "PATCH", "DELETE"];
  var isWriteRequest = pathname === "/api/skills" && WRITE_METHODS.indexOf(req.method) !== -1;

  if (pathname === "/api/skills" && isWriteRequest) {
    var blocked = guardWrite(req);
    if (blocked) {
      console.log("[api/guard] 已拦截 " + req.method + " " + pathname +
        " code=" + blocked.code);
      return sendJson(res, 200, blocked);   // 沿用约定：业务错误 HTTP 仍为 200
    }
  }

  if (pathname === "/api/skills" && req.method === "POST") {
    return handleCreateSkill(req, res);
  }
  // 【Day 22】同一个路径 /api/skills，按 HTTP 方法分给不同处理函数：
  //   PATCH  = 改一条、DELETE = 删一条，靠 ?id=N 定位是哪一条
  // 用查询参数而不是 /api/skills/38，是因为网关路由是精确匹配的，
  // 带 id 的路径得再登记一条路由；查询参数能复用已登记的这条（见 api-contract.md 1.2）。
  if (pathname === "/api/skills" && req.method === "PATCH") {
    return handleUpdateSkill(req, res, query);
  }
  if (pathname === "/api/skills" && req.method === "DELETE") {
    return handleDeleteSkill(req, res, query);
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
