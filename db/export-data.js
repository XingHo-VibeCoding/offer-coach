#!/usr/bin/env node
/**
 * =============================================================================
 * offer-coach · 数据导出（备份脚本）  db/export-data.js
 * =============================================================================
 * 干什么：把线上云数据库里的 jobs（岗位表）、skills（技能总表）全量导出成
 *         一份可以直接执行的 SQL 文件，存到 db/backup/ 下。
 *
 * 为什么要有它：
 *   · 回滚（ROLLBACK.md 第三节）只能救代码，救不了数据——数据被误删就真没了；
 *   · 唯一的补救办法是「有一份能重新导入的备份」，所以备份必须能一键生成；
 *   · 免费套餐到期/欠费时环境会被回收，代码在 GitHub 上没事，数据只在云上，
 *     所以数据也要定期导出一份放进仓库。
 *
 * 怎么用（在项目根目录）：
 *   node db/export-data.js                  # 导出，文件名自动带今天日期
 *   node db/export-data.js --out xxx.sql    # 指定输出文件
 *   node db/export-data.js --dry-run        # 只查库、打印摘要，不写文件
 *   node db/export-data.js --from-dir <dir> # 不进库：用 dir 里已保存的 jobs.json / skills.json 生成
 *                                           # （给「本机没有 tcb」或「受限环境」用的离线路径）
 *
 * 前置条件：本机已用 tcb CLI 登录过（tcb login），且 node 可用。
 *           脚本不读任何密钥文件，凭据由 tcb CLI 自己管（本仓库零密钥原则）。
 *
 * 依赖：只用 Node 自带模块 + 本机 tcb CLI。不用 grep/sed/curl 等 Unix 工具，
 *       保证在 Windows 的 CMD / PowerShell / Git Bash 里都能跑。
 * =============================================================================
 */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;

// ── 配置 ─────────────────────────────────────────────────────────────────────
var ENV = "offer-coach-d0ge7jkzfc47e2079"; // CloudBase 环境 ID
var ROOT = path.resolve(__dirname, "..");  // 项目根目录（本文件在 db/ 下）

// Windows 上 tcb 只是个 .cmd 包装脚本，execFileSync 直接调会失败；
// 改成用 node 跑它的 JS 入口，跨终端通用。
var TCB_JS = path.join(
  os.homedir(), "AppData", "Roaming", "npm", "node_modules",
  "@cloudbase", "cli", "bin", "tcb"
);

// 导出哪些表、按什么字段顺序导出。
// 字段顺序写死（不用 SELECT *），这样两次导出的文件才能逐行比对。
var TABLES = [
  {
    name: "jobs",
    cols: ["id", "name", "intro", "duty", "required_skills"]
  },
  {
    name: "skills",
    cols: ["id", "name", "category", "stage", "note", "aliases", "related_jobs", "source"]
  }
];

// 恢复时的顺序：先清空（含被引用的），再灌数据，最后把自增序列拨到最大值之后，
// 否则下一次新增技能会撞上「id 已存在」。
var SEQ_FIX = [
  "SELECT setval(pg_get_serial_sequence('jobs',   'id'), COALESCE((SELECT MAX(id) FROM jobs),   1));",
  "SELECT setval(pg_get_serial_sequence('skills', 'id'), COALESCE((SELECT MAX(id) FROM skills), 1));"
];

// ── 工具函数 ─────────────────────────────────────────────────────────────────

// 剥掉 tcb 输出里的 ANSI 颜色码（表格输出带 ESC[90m 这类控制符，会害 JSON.parse 失败）
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "").replace(/^\uFEFF/, "");
}

function findTcb() {
  if (fs.existsSync(TCB_JS)) return TCB_JS;
  return null;
}

// 跑一条 SQL，返回「每行一个字符串数组」的结果
function query(sql) {
  var tcbPath = findTcb();
  if (!tcbPath) throw new Error("本机没找到 tcb CLI：" + TCB_JS + "\n请先安装并登录：npm i -g @cloudbase/cli && tcb login");

  var raw = stripAnsi(execFileSync(
    process.execPath,
    [tcbPath, "db", "execute", "-e", ENV, "--sql", sql, "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  ));
  return parseTcbJson(raw);
}

// 解析 tcb --json 的原始输出（也能直接吃「事先存下来的 tcb 输出文件」）
function parseTcbJson(raw) {
  raw = stripAnsi(raw);
  // 输出前面可能混有 CLI 的横幅，只截 JSON 本体
  var a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("tcb 输出不是 JSON，前 200 字：\n" + raw.slice(0, 200));

  var parsed = JSON.parse(raw.slice(a, b + 1));
  var data = parsed.data || parsed;
  if (!data.Rows) return { rows: [], types: (data.ColumnTypes || []).map(function (t) { return t; }) };
  return {
    rows: data.Rows.map(function (r) { return JSON.parse(r); }),
    types: (data.ColumnTypes || []).map(function (t) { return t; })
  };
}

// 拼 SQL 字面量：文本加单引号并把内部的 ' 变成 ''（PostgreSQL 标准写法）
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// 数组列（tcb 返回的是 PostgreSQL 数组字面量，如 {HTML,CSS,"嵌入式 Linux"}，
// 直接原样包成 '...'::text[] 就是合法 SQL，不用自己拼）
function arrayLit(v) {
  if (v === null || v === undefined || v === "") return "ARRAY[]::text[]";
  return lit(v) + "::text[]";
}

function nowStamp() {
  var d = new Date();
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return {
    date: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()),
    time: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
          p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  };
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

function main() {
  var argv = process.argv.slice(2);
  var dryRun = argv.indexOf("--dry-run") >= 0;
  var outIdx = argv.indexOf("--out");
  var dirIdx = argv.indexOf("--from-dir");
  var fromDir = dirIdx >= 0 ? path.resolve(ROOT, argv[dirIdx + 1] || "") : null;
  var stamp = nowStamp();

  console.log("offer-coach · 数据导出");
  console.log("环境：" + ENV);
  console.log("");

  // 1. 逐表取数（默认连库查；--from-dir 时读事先保存的查询结果）
  var data = {};
  TABLES.forEach(function (t) {
    var res;
    if (fromDir) {
      var f = path.join(fromDir, t.name + ".json");
      console.log("读 " + path.relative(ROOT, f).replace(/\\/g, "/") + " ...");
      res = parseTcbJson(fs.readFileSync(f, "utf8"));
    } else {
      console.log("查 " + t.name + " ...");
      res = query("select " + t.cols.join(", ") + " from " + t.name + " order by id;");
    }
    data[t.name] = res;
    console.log("  " + t.name + "：" + res.rows.length + " 行");
  });
  console.log("");

  // 2. 组装 SQL 文件
  var outPathFinal = outPath(stamp, outIdx);
  var outBase = path.basename(outPathFinal);
  var L = [];
  L.push("-- =============================================================================");
  L.push("-- offer-coach · 数据备份（自动生成，请勿手改）");
  L.push("-- =============================================================================");
  L.push("-- 生成时间：" + stamp.time + "（本机时间）");
  L.push("-- 来源环境：" + ENV + "（CloudBase · 上海 · 体验版）");
  L.push("-- 取数方式：" + (fromDir ? "离线生成（读 " + path.relative(ROOT, fromDir).replace(/\\/g, "/") + "/ 下的查询结果）"
                                   : "直连数据库（tcb db execute）"));
  TABLES.forEach(function (t) {
    L.push("-- 含表：" + t.name + "（" + data[t.name].rows.length + " 行）");
  });
  L.push("-- 生成脚本：db/export-data.js");
  L.push("--");
  L.push("-- 怎么用它恢复数据：");
  L.push("--   tcb db execute -e " + ENV + " --sql \"$(cat db/backup/" + outBase + ")\"");
  L.push("--   （Windows PowerShell 里换成：");
  L.push("--     tcb db execute -e " + ENV + " --sql \"$(Get-Content db/backup/" + outBase + " -Raw)\"）");
  L.push("--");
  L.push("-- ⚠️ 警告：本文件开头是 TRUNCATE（清空两表），执行它会覆盖线上现有数据。");
  L.push("--    恢复是「整体替换」而不是「合并」——导出的那一刻是什么样，恢复后就是什么样。");
  L.push("--");
  L.push("-- 隐私检查：两张表只有岗位与技能信息，没有用户表、没有账号/邮箱/手机号字段，");
  L.push("--           不含任何密钥（凭据由 tcb CLI 在本机保管，不进本文件）。");
  L.push("-- =============================================================================");
  L.push("");
  L.push("BEGIN;");
  L.push("");
  L.push("-- 1) 清空（保留表结构）");
  L.push("TRUNCATE TABLE skills, jobs RESTART IDENTITY CASCADE;");
  L.push("");

  TABLES.forEach(function (t) {
    var rows = data[t.name].rows;
    var types = data[t.name].types;
    L.push("-- 2) 灌入 " + t.name + "：" + rows.length + " 行");
    if (rows.length === 0) {
      L.push("-- （导出时该表为空，无需插入）");
      L.push("");
      return;
    }
    L.push("INSERT INTO " + t.name + " (" + t.cols.join(", ") + ") VALUES");
    var tupleStrings = rows.map(function (row, i) {
      var vals = row.map(function (v, ci) {
        var ty = types[ci] || "text";
        if (ty === "_text") return arrayLit(v);
        if (ty === "int4" || ty === "int8" || ty === "int2") return String(v);
        return lit(v);
      });
      return "  (" + vals.join(", ") + ")" + (i === rows.length - 1 ? ";" : ",");
    });
    L.push(tupleStrings.join("\n"));
    L.push("");
  });

  L.push("-- 3) 把自增序列拨到现有最大值之后（否则下次新增会撞 id）");
  SEQ_FIX.forEach(function (s) { L.push(s); });
  L.push("");
  L.push("COMMIT;");
  L.push("");
  L.push("-- 恢复后建议核对（应分别等于上面的行数）：");
  L.push("--   select count(*) from jobs;");
  L.push("--   select count(*) from skills;");
  L.push("-- =============================================================================");

  var sql = L.join("\n");
  var buf = Buffer.from(sql, "utf8");

  // 3. 写文件
  if (dryRun) {
    console.log("[--dry-run] 不写文件。将要写入 " + buf.length + " 字节，SHA256 前 16 位：" + sha256(buf));
    return;
  }

  fs.mkdirSync(path.dirname(outPathFinal), { recursive: true });
  fs.writeFileSync(outPathFinal, buf);

  var rel = path.relative(ROOT, outPathFinal).replace(/\\/g, "/");
  console.log("已写入：" + rel);
  console.log("大小：" + buf.length + " 字节　SHA256 前 16 位：" + sha256(buf));
  console.log("");
  console.log("恢复命令（谨慎，会覆盖线上数据）：");
  console.log("  tcb db execute -e " + ENV + " --sql \"$(cat " + rel + ")\"");
}

function outPath(stamp, outIdx) {
  if (outIdx >= 0 && process.argv.slice(2)[outIdx + 1]) {
    var p = process.argv.slice(2)[outIdx + 1];
    return path.isAbsolute(p) ? p : path.join(ROOT, p);
  }
  return path.join(ROOT, "db", "backup", stamp.date + "-jobs-skills.sql");
}

main();
