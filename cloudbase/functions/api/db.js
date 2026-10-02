// =============================================================================
// offer-coach 数据访问层（db.js）—— Day 19
// =============================================================================
// 这个文件是「唯一懂数据库」的地方。它负责三件事：
//   1. 跟数据库建立连接（连库客户端只在这里初始化）
//   2. 告诉别人「数据怎么取、怎么写」（对外提供函数，不暴露表名和字段名）
//   3. 把数据库的原始行转成对外的驼峰字段，把数据库的报错翻译成人能看的文本
//
// 【边界约定 · 以后写代码照这个来】
//   想知道「表叫什么、字段叫什么、查询怎么写」 → 看本文件
//   想知道「用户传了什么、该回什么中文提示」   → 看 index.js
//   index.js 里【不许】出现表名、字段名、select/insert 这类字眼。
//
// 为什么要有这个文件：Day 18 排查「写库报 42501 权限不足」时，改的地方散在
// index.js 各处，来回翻很费劲。拆开之后，数据库的事集中一处，一眼看完。
// =============================================================================

const cloudbase = require("@cloudbase/node-sdk");

// -----------------------------------------------------------------------------
// 数据库客户端
// TCB_ENV 是平台自动注入的环境 ID（不是密钥，公开无害）；本地调试时可手动指定。
// 模块顶层初始化一次，让云函数实例复用，避免每次请求重建。
// -----------------------------------------------------------------------------
const ENV_ID = process.env.TCB_ENV || "offer-coach-d0ge7jkzfc47e2079";
const app = cloudbase.init({ env: ENV_ID });
// 【关键】必须显式指定 schema 为 public。
// 原因：SDK 里 rdb() 的默认值是 `database = envId`，而该值会作为
// Accept-Profile / Content-Profile 头（PostgREST 的 schema 参数）发出，
// 于是服务端报 "Invalid schema: offer-coach-..."。
const db = app.rdb({ database: "public" });

// 要取哪些列 —— 用字段清单代替 SELECT *，好处是查询结果稳定、不多取
const JOBS_COLUMNS = "name, intro, duty, required_skills";
const SKILLS_COLUMNS = "name, category, stage, note, aliases, related_jobs, source";

// -----------------------------------------------------------------------------
// 错误翻译：把 SDK 返回的 error 对象变成人能看的文本
// -----------------------------------------------------------------------------

// 简版：只取 message，用于日志
function describeError(e) {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  return e.message || JSON.stringify(e);
}

// 详版：把 code / details / hint 都摊开
// 为什么需要它：PostgREST 报错的关键信息在 code 里（如 42501=权限不足、23505=重复），
// 只取 message 会把最有用的线索丢掉。注意它只用于服务端日志，不返回给请求方。
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

// 判断是不是「唯一约束冲突」——PostgreSQL 的 SQLSTATE 就是 23505
function isDuplicateError(e) {
  if (!e) return false;
  if (e.code === "23505") return true;
  return /duplicate key|already exists/i.test(e.message || "");
}

// -----------------------------------------------------------------------------
// 行数据 → 对外 JSON（蛇形转驼峰）
// 数据库里叫 required_skills，对外叫 requiredSkills。
// 这段映射放在这里，是为了让 index.js 彻底不知道数据库的字段名长什么样。
// -----------------------------------------------------------------------------

function toJobJson(row) {
  return {
    name: row.name,
    intro: row.intro,
    duty: row.duty,
    requiredSkills: row.required_skills
  };
}

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

// -----------------------------------------------------------------------------
// 对外提供的数据库操作
// 每个函数只管一件事，出错就把错误往上抛（由 index.js 决定怎么回应）
// -----------------------------------------------------------------------------

// 查岗位清单（可按 limit 限制条数），返回已转好字段名的数组
async function listJobs(limit) {
  var q = db.from("jobs").select(JOBS_COLUMNS).order("id", { ascending: true });
  if (limit) {
    q = q.limit(limit);
  }
  var result = await q;
  if (result.error) throw new Error("查岗位失败：" + describeErrorFull(result.error));
  return (result.data || []).map(toJobJson);
}

// 查技能总表，返回已转好字段名的数组
async function listSkills() {
  var result = await db
    .from("skills")
    .select(SKILLS_COLUMNS)
    .order("id", { ascending: true });
  if (result.error) throw new Error("查技能失败：" + describeErrorFull(result.error));
  return (result.data || []).map(toSkillJson);
}

// 【防重复第一层】技能名是否已被占用。
// 之所以要单独查一次（而不是直接写库等数据库报错），是为了给用户一句中文人话。
// 只返回 true / false —— 调用方不需要知道「怎么查的、查出来长什么样」。
async function isSkillNameTaken(name) {
  var result = await db
    .from("skills")
    .select("name")
    .eq("name", name)
    .limit(1);
  if (result.error) throw new Error("查重失败：" + describeErrorFull(result.error));
  return !!(result.data && result.data.length > 0);
}

// 【防重复第二层】写库。传入驼峰的技能对象，本函数负责拼成数据库的行。
// 入库时的几个字段由服务端定死（不接受调用方传）：
//   aliases / related_jobs 留空数组，source 固定为「用户自定义」——
//   否则客户端可以伪造 source:"预设" 往技能总表里混假数据。
// 「先查后写」中间有时间窗口，并发时两条请求可能都查到「不存在」然后都去写，
// 这时第二条会被数据库的 UNIQUE 约束顶回来（报 23505）。
// 这里把 23505 也翻译成 { duplicate: true }，交给 index.js 统一回 1005。
async function insertSkill(skill) {
  var row = {
    name: skill.name,
    category: skill.category,
    stage: skill.stage,
    note: skill.note,
    aliases: [],
    related_jobs: [],
    source: "用户自定义"
  };
  var result = await db.from("skills").insert(row);
  if (result.error) {
    if (isDuplicateError(result.error)) {
      return { duplicate: true, skill: null };
    }
    throw new Error("写库失败：" + describeErrorFull(result.error));
  }
  return { duplicate: false, skill: toSkillJson(row) };
}

module.exports = {
  ENV_ID: ENV_ID,
  listJobs: listJobs,
  listSkills: listSkills,
  isSkillNameTaken: isSkillNameTaken,
  insertSkill: insertSkill
};
