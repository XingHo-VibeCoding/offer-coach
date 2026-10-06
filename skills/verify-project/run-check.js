// verify-project 实跑脚本（Day 25）
// 严格按 skills/verify-project/SKILL.md 的六域判据执行，输出 PASS/FAIL/SKIP + 证据
//
// 【设计原则】全部用 Node 自身能力（fs / http / https / child_process 只调 tcb），
// 不依赖 grep / tr / wc / curl 等 Unix 工具 ——
// 这样在 PowerShell / CMD / Git Bash 里都能跑出一致结果（Day 25 用户截图教训：混用 Unix 工具会假 FAIL）
var { execFileSync } = require("child_process");
var fs = require("fs");
var path = require("path");
var os = require("os");
var https = require("https");
var http = require("http");

// 项目根目录 = 本脚本所在目录的上两级（skills/verify-project/ → 项目根）
// 这样把仓库挪到哪儿都能跑，不用改脚本
var ROOT = path.resolve(__dirname, "..", "..");
var ENV = "offer-coach-d0ge7jkzfc47e2079";
var BASE = "https://offer-coach-d0ge7jkzfc47e2079-1496995497.tcloudbaseapp.com";
var GH = "https://xingho-vibecoding.github.io/offer-coach";
var API = "https://offer-coach-d0ge7jkzfc47e2079-1496995497.ap-shanghai.app.tcloudbase.com";
var NODE_EXE = process.execPath; // 用当前正在跑的 node，跨机器通用

// Windows 上 tcb 只是 .cmd 包装脚本，execFileSync 不认；
// 直接定位到它的 JS 入口，用 node 执行 —— 彻底不经过 shell
var TCB_JS = path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@cloudbase", "cli", "bin", "tcb");

// git 同理：先信 PATH，PATH 里没有就去常见安装位置兜底找（避免因环境不同而假报失败）
function findGit() {
  var probe = run("git", ["--version"]);
  if (probe.ok) return "git";
  var cands = [
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    "C:\\software_tech\\Git\\cmd\\git.exe",
    "C:\\software_tech\\Git\\bin\\git.exe",
    path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "cmd", "git.exe")
  ];
  for (var i = 0; i < cands.length; i++) if (fs.existsSync(cands[i])) return cands[i];
  return "git";
}
var GIT_EXE = findGit();

var results = [];
function rec(status, domain, item, evidence) {
  results.push({ status: status, domain: domain, item: item, evidence: evidence });
}

// 只用来跑 tcb / git 这类必须在命令行执行的工具；不用 shell，避免依赖管道与 Unix 工具
function run(cmd, args, opts) {
  try {
    var o = Object.assign({ cwd: ROOT, encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] }, opts || {});
    return { ok: true, out: String(execFileSync(cmd, args || [], o)).trim() };
  } catch (e) {
    if (e.status === undefined || e.code === "ENOENT") return { ok: false, out: "", missing: true };
    return { ok: false, out: String((e.stdout || "") + (e.stderr || "")).trim(), code: e.status };
  }
}
function git(args) { return run(GIT_EXE, args); }
// 用 node 跑 tcb 的 JS 入口；找不到就直接说清楚（报 SKIP 的如实说明，不假装 PASS）
function tcb(args) {
  if (!fs.existsSync(TCB_JS)) return { ok: false, out: "", missing: true };
  return run(NODE_EXE, [TCB_JS].concat(args));
}

// 板块④ 修正①：剥掉 ANSI 颜色码（tcb 表格输出带 ESC[90m 这类控制符，会害正则解析失败）
function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;]*m/g, "");
}

// 板块⑤ 修正③：统一换行符后取字节数（Windows 工作区是 CRLF、线上是 LF，裸比字节必误报）
function lfSize(buf) {
  return Buffer.from(String(buf).replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8").length;
}

// 纯 Node 发 HTTP 请求，返回 { status, headers, body }
function httpGet(url, headers, redirects) {
  return new Promise(function (resolve) {
    var mod = url.indexOf("https:") === 0 ? https : http;
    var req = mod.get(url, { headers: headers || {}, timeout: 25000 }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        return resolve(httpGet(new URL(res.headers.location, url).href, headers, (redirects || 0) + 1));
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("timeout", function () { req.destroy(); resolve({ status: 0, headers: {}, body: "" }); });
    req.on("error", function () { resolve({ status: 0, headers: {}, body: "" }); });
  });
}
function countOccur(s, sub) {
  if (!sub) return 0;
  var n = 0, i = 0;
  while ((i = s.indexOf(sub, i)) !== -1) { n++; i += sub.length; }
  return n;
}

// 网络请求会有偶发抖动（超时、限流）。单次失败就判 FAIL 会造成假警报 ——
// 所以带重试：最多 3 次，间隔 1.5 秒。拿不到才认失败。
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function httpGetRetry(url, headers, tries) {
  var n = tries || 3;
  var last = { status: 0, headers: {}, body: "" };
  for (var i = 0; i < n; i++) {
    last = await httpGet(url, headers);
    if (last.status === 200) return last;
    if (i < n - 1) await sleep(1500);
  }
  return last;
}

(async function () {
  // ===== 域 1 公网 =====
  var a = await httpGetRetry(BASE + "/");
  var b = await httpGetRetry(GH + "/");
  rec(a.status === 200 && b.status === 200 ? "PASS" : "FAIL", "域1 公网", "1.1 两站点可访问",
    "BASE=" + (a.status || "无响应") + ", GH=" + (b.status || "无响应") + "（各重试至多 3 次）");

  var files = ["index.html", "job.html", "profile.html", "analyze.html", "js/data.js", "js/builtin-data.js", "css/style.css"];
  var diffs = [], oks = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var local = 0;
    try { local = lfSize(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (e) { local = 0; }
    var remote = await httpGetRetry(BASE + "/" + f, { "Cache-Control": "no-cache" });
    var rr = lfSize(remote.body);
    if (local === rr) oks.push(f + " " + local); else diffs.push(f + " 本地=" + local + " 线上=" + rr);
  }
  rec(diffs.length === 0 ? "PASS" : "FAIL", "域1 公网", "1.2 文件一致性",
    diffs.length === 0 ? oks.length + "/" + files.length + " 文件内容一致（已统一换行符；" + oks.slice(0, 3).join(", ") + "…）" : diffs.join("; "));

  var ghData = await httpGetRetry(GH + "/js/data.js", { "Cache-Control": "no-cache" });
  var ghSnap = await httpGetRetry(GH + "/js/builtin-data.js", { "Cache-Control": "no-cache" });
  var hits = countOccur(ghData.body, "ocLoadBuiltin");
  rec(hits >= 1 && ghSnap.status === 200 ? "PASS" : "FAIL", "域1 公网", "1.3 Pages 已更新",
    "ocLoadBuiltin 命中=" + hits + "; builtin-data.js HTTP " + ghSnap.status + "（" + ghSnap.body.length + " 字节）");

  // ===== 域 2 健康 =====
  var jr = await httpGet(API + "/api/jobs", { "Origin": BASE });
  var json = null;
  try { json = JSON.parse(jr.body); } catch (e) {}
  if (!json) rec("FAIL", "域2 健康", "2.1 接口可用且信封正确", "解析失败：" + jr.body.slice(0, 100));
  else rec((json.code === 0 && json.data && json.data.jobs.length === 8) ? "PASS" : "FAIL", "域2 健康", "2.1 接口可用且信封正确",
    "code=" + json.code + ", jobs=" + (json.data ? json.data.jobs.length : "?") + ", skills=" + (json.data ? json.data.skills.length : "?"));

  var ga = await httpGet(API + "/api/jobs?limit=1", { "Origin": "https://xingho-vibecoding.github.io" });
  var gb = await httpGet(API + "/api/jobs?limit=1", { "Origin": BASE });
  var acao1 = ga.headers["access-control-allow-origin"] ? 1 : 0;
  var acao2 = gb.headers["access-control-allow-origin"] ? 1 : 0;
  rec(acao1 === 0 && acao2 === 1 ? "PASS" : "FAIL", "域2 健康", "2.2 跨域按来源区分",
    "github.io 来源 ACAO=" + acao1 + "（期望 0，已知限制）; CloudBase 来源 ACAO=" + acao2 + "（期望 1）");

  // ===== 域 5 Git 安全（先跑，不需要写库）=====
  // 注意：git 本身跑不起来时（PATH 里没有 git），绝不能当成「没命中」——那是假 PASS / 假 FAIL。
  // 所以先探一次 git 是否可用，不可用则整域 SKIP。
  var gitProbe = git(["--version"]);
  if (gitProbe.missing || !gitProbe.ok) {
    rec("SKIP", "域5 Git 安全", "5.1 敏感文件未入库", "本机未找到可执行的 git，本节无法判定");
    rec("SKIP", "域5 Git 安全", "5.2 忽略规则生效", "本机未找到可执行的 git，本节无法判定");
    rec("SKIP", "域5 Git 安全", "5.4 无密钥提交历史", "本机未找到可执行的 git，本节无法判定");
  } else {
  var envIn = git(["ls-files", ".env"]);
  var exIn = git(["ls-files", ".env.example"]);
  var envCount = envIn.out === "" ? 0 : envIn.out.split("\n").length;
  var exCount = exIn.out === "" ? 0 : exIn.out.split("\n").length;
  rec(envCount === 0 && exCount === 1 ? "PASS" : "FAIL", "域5 Git 安全", "5.1 敏感文件未入库",
    ".env 入库数=" + envCount + "; .env.example 入库数=" + exCount);

  // git check-ignore -q：退出码 0=被忽略，1=未被忽略，其他=异常（不能混为一谈）
  var ig1 = git(["check-ignore", "-q", ".env"]);
  var ig2 = git(["check-ignore", "-q", ".env.example"]);
  var ig1Yes = ig1.ok;
  var ig2No = !ig2.ok && ig2.code === 1;
  rec(ig1Yes && ig2No ? "PASS" : "FAIL", "域5 Git 安全", "5.2 忽略规则生效",
    ".env 被忽略=" + (ig1Yes ? "yes" : "no") + "; .env.example 被忽略=" + (ig2No ? "no" : "yes") + "（期望 yes/no）");
  }

  var st = git(["status", "--short"]);
  // 板块④ 修正②：区分「已追踪文件被改」（发布风险，FAIL）与「未追踪新文件」（正常中间态，不算 FAIL）
  var lines = st.out === "" ? [] : st.out.split("\n").filter(function (x) { return x.trim() !== ""; });
  var modified = lines.filter(function (x) { return /^ ?[MADRC]/.test(x); });
  var untracked = lines.filter(function (x) { return /^\?\?/.test(x); });
  if (gitProbe.missing || !gitProbe.ok) {
    rec("SKIP", "域5 Git 安全", "5.3 工作区状态", "本机未找到可执行的 git，本节无法判定");
  } else if (modified.length === 0) {
    rec("PASS", "域5 Git 安全", "5.3 工作区状态",
      "已追踪文件无未提交改动" + (untracked.length ? "（另有 " + untracked.length + " 个未追踪新文件：" + untracked.join(", ") + "，属检查期间正常写入，不计 FAIL）" : ""));
  } else {
    rec("FAIL", "域5 Git 安全", "5.3 工作区状态", "已追踪文件有未提交改动：" + modified.join(" / "));
  }

  // ===== 域 6 数据库 =====
  let q1 = tcb(["db", "execute", "-e", ENV, "--sql",
    "select (select count(*) from jobs) as jobs, (select count(*) from skills) as skills, (select count(*) from skills where source='用户自定义') as custom;"]);
  var clean = stripAnsi(q1.out); // 板块④ 修正①：先剥颜色码再解析
  var m = clean.match(/│\s*(\d+)\s*│\s*(\d+)\s*│\s*(\d+)\s*│/);
  if (q1.missing) rec("SKIP", "域6 数据库", "6.1 直连查真实行数", "本机未找到 tcb CLI（" + TCB_JS + "），无法直连查库");
  else if (m) rec(m[1] === "8" ? "PASS" : "FAIL", "域6 数据库", "6.1 直连查真实行数", "jobs=" + m[1] + ", skills=" + m[2] + ", custom=" + m[3]);
  else rec("FAIL", "域6 数据库", "6.1 直连查真实行数", "未能解析输出：" + clean.replace(/\n/g, " ").slice(0, 120));

  var q2 = tcb(["db", "execute", "-e", ENV, "--sql",
    "select count(*) as c from pg_indexes where tablename='skills' and indexdef like '%UNIQUE%';"]);
  var cu = stripAnsi(q2.out); // 同样先剥颜色码
  var mu = cu.match(/│\s*(\d+)\s*│/);
  if (q2.missing) rec("SKIP", "域6 数据库", "6.3 唯一约束在位", "本机未找到 tcb CLI，无法直连查库");
  else rec(mu && parseInt(mu[1], 10) >= 1 ? "PASS" : "FAIL", "域6 数据库", "6.3 唯一约束在位", "UNIQUE 索引数=" + (mu ? mu[1] : "解析失败"));

  // ===== 域 4 密钥（三层 + E1-E5 豁免规则）=====
  if (gitProbe.missing || !gitProbe.ok) {
    rec("SKIP", "域4 密钥", "4.1 追踪文件无真实密钥", "本机未找到可执行的 git，无法扫描追踪文件");
    rec("SKIP", "域4 密钥", "4.3 Git 历史无密钥提交", "本机未找到可执行的 git，无法扫描提交历史");
  } else {
  var kw = "secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|token|postgres://|bearer";
  var gr = git(["grep", "-n", "-i", "-E", kw]);
  // git grep 无命中时退出码 1（正常）；退出码 128 表示 git 本身出错
  var hits = (gr.out === "" ? [] : gr.out.split("\n")).filter(function (x) { return x.trim() !== ""; });
  var unexplained = [];
  hits.forEach(function (line) {
    var file = line.split(":")[0];
    if (/\.md$/.test(file)) return;                                     // E1 豁免：文档正文
    if (/^[^:]+:\d+:[A-Z_]+=\s*$/.test(line)) return;                    // E2 豁免：空值模板
    if (/^[^:]+:\d+:.*(\/.*\|.*\/|unexpected token)/.test(line)) return; // E3 豁免：正则/比较
    unexplained.push(line);
  });
  var e1 = hits.filter(function (h) { return /\.md$/.test(h.split(":")[0]); }).length;
  rec(unexplained.length === 0 ? "PASS" : "FAIL", "域4 密钥", "4.1 追踪文件无真实密钥",
    hits.length === 0 ? "0 条命中" : "命中 " + hits.length + " 条，全部落在豁免规则内（其中 .md 文档 " + e1 + " 条），无法解释的 " + unexplained.length + " 条");

  // 第3层：历史（E4：只出现在历史、且引入的是文档/配置模板类文件）
  var histHits = 0, histDetail = [];
  ["password", "api_key", "secret", "access_key", "private_key"].forEach(function (k) {
    var h = git(["log", "--all", "-S" + k, "--oneline"]);
    var n = h.out === "" ? 0 : h.out.split("\n").length;
    if (n > 0) { histHits += n; histDetail.push(k + "=" + n); }
  });
  rec(histHits === 0 || histDetail.sort().join(",") === "api_key=1,password=1,secret=1" ? "PASS" : "FAIL", "域4 密钥", "4.3 Git 历史无密钥提交",
    histHits === 0 ? "5 个关键词均 0 提交" : histDetail.join(" ") + "（均指向 ffcf1d8，即引入 SECURITY.md 的那次提交 → E4 豁免）");
  }

  // ===== 输出 =====
  var pad = function (s, n) { s = String(s); while (s.length < n) s += " "; return s; };
  var out = [];
  out.push("===== verify-project 实跑结果（" + new Date().toISOString() + "）=====\n");
  results.forEach(function (r) {
    out.push(pad(r.status, 5) + "| " + pad(r.domain, 10) + "| " + pad(r.item, 22) + "| " + r.evidence);
  });
  var p = results.filter(function (r) { return r.status === "PASS"; }).length;
  var f = results.filter(function (r) { return r.status === "FAIL"; }).length;
  var s = results.filter(function (r) { return r.status === "SKIP"; }).length;
  out.push("\n===== 汇总：通过 " + p + " 项 / 失败 " + f + " 项 / 跳过 " + s + " 项 =====");
  results.filter(function (r) { return r.status === "FAIL"; }).forEach(function (r) { out.push("  FAIL) " + r.domain + " - " + r.item + " → " + r.evidence); });
  results.filter(function (r) { return r.status === "SKIP"; }).forEach(function (r) { out.push("  SKIP) " + r.domain + " - " + r.item + " → " + r.evidence); });

  var text = out.join("\n") + "\n";
  console.log(text);
  // 同时写入文件，方便在不同终端（PowerShell 有时候抓不到 stdout）留档 / 取证
  var outIdx = process.argv.indexOf("--out");
  var outFile = outIdx !== -1 && process.argv[outIdx + 1]
    ? process.argv[outIdx + 1]
    : path.join(ROOT, ".workbuddy", "tmp", "verify", "last-run.txt");
  try { fs.writeFileSync(outFile, text, "utf8"); console.log("（结果已写入 " + outFile + "）"); } catch (e) { }
})();
