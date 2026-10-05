// offer-coach 数据底座 —— Day 17 板块⑤：数据来源从「本地写死」换成「云函数接口」
//
// 改动前后对比：
//   改前：JOBS / SKILLS 两个数组直接写在本文件里（一份本地副本，也就是老师说的「假数据」）
//   改后：本文件只负责「去接口把数据取回来」，把结果放进 window.JOBS / window.SKILLS
//         —— 各页面的渲染代码一个字都不用改，因为接口返回的字段名跟原来完全一致
//            （这正是 Day 17 板块③ 里那两个「对不上的字段」要转成驼峰的原因）
//
// 为什么需要「等数据就绪」这一层：
//   取数据是异步的（请求发出去要等网络往返），而页面脚本紧接着就同步执行了。
//   如果页面脚本立刻开跑，数据还在路上，它就会误判成「加载失败」。
//   所以约定：页面脚本用 OCDataReady(回调) 注册自己的初始化逻辑，
//   数据到了（或确认失败）再执行 —— 三种状态：loading（还在路上）/ ready / error。
//
// Day 24 补充：接口不可用时（如跨域被拦），会自动加载 js/builtin-data.js 这份内置快照兜底，
//   让页面「可用但数据可能略旧」，而不是整页空白。见文件下方的「离线兜底」段。

// 接口地址（CloudBase 云函数，板块③ 已上线）
window.OC_API_BASE = "https://offer-coach-d0ge7jkzfc47e2079-1496995497.ap-shanghai.app.tcloudbase.com";
window.OC_API_PATH = "/api/jobs";

// 数据状态：loading（默认，还在取）/ ready（取到了）/ error（失败了）
window.OC_DATA_STATE = "loading";
window.OC_DATA_ERROR = null;  // 失败原因（给页面显示用）
window.JOBS = undefined;      // 岗位清单（接口返回的 data.jobs）
window.SKILLS = undefined;    // 技能总表（接口返回的 data.skills）

// 等待队列：数据还没到时，页面脚本的回调先排队；数据到了再统一执行
var ocWaiters = [];

/** 页面脚本用它注册初始化逻辑：数据就绪后执行 fn(state)，state 为 "ready" 或 "error" */
window.OCDataReady = function (fn) {
  if (window.OC_DATA_STATE === "loading") {
    ocWaiters.push(fn);
  } else {
    fn(window.OC_DATA_STATE); // 已经就绪（脚本加载慢的情况），立刻执行
  }
};

/** 通知所有等待者：数据有着落了 */
function ocNotify(state) {
  window.OC_DATA_STATE = state;
  var list = ocWaiters;
  ocWaiters = [];
  list.forEach(function (fn) { fn(state); });
}

// ---------------------------------------------------------------------------
// Day 23 板块③：错误翻译层 —— 把技术黑话翻成人话
//
// 为什么需要它：
//   浏览器抛出的原始报错是给开发者看的英文，比如断网时是 "Failed to fetch"、
//   超时是 "The operation was aborted"。直接甩给用户，用户只会一脸问号。
//   所以在这里统一「翻译」：用户看中文结果，英文原文只进控制台留档。
//
// 三类错误：
//   ① 网络类 —— 断网 / 超时（fetch 自身就失败了，请求根本没到服务器）
//   ② 服务类 —— HTTP 非 2xx（服务器收到了但处理失败，如 404 / 500）
//   ③ 数据类 —— 请求成功但返回的格式不对（不是 JSON、缺字段）
// ---------------------------------------------------------------------------
window.OCDescribeError = function (err) {
  var raw = (err && err.message) ? String(err.message) : String(err || "");

  // ⓪ 后端给的中文提示本来就是人话（如「服务暂时不可用，请稍后重试」），原样透传，不再翻译。
  //    判据收紧：整条消息以中文为主（中文占多数）、长度不超过 40 字、且不含报错痕迹
  //    （堆栈/文件路径/技术符号）。避免把「某个谁也没见过的怪错误」这种兜底也放行。
  var cnCount = (raw.match(/[\u4e00-\u9fa5]/g) || []).length;
  var looksTechnical = /at\s+\S+\(|\.js:|\.ts:|Error:|undefined|null/i.test(raw);
  if (cnCount > 0 && cnCount >= raw.length / 2 && raw.length <= 40 && !looksTechnical) {
    return raw;
  }

  // ① 网络类：fetch 在断网/域名解析失败时抛 "Failed to fetch"（各浏览器措辞略有不同）
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(raw)) {
    return "网络连接失败，请检查网络后重试";
  }
  // ① 网络类：我们设的 10 秒超时触发 abort
  if (/abort/i.test(raw)) {
    return "请求超时（超过 10 秒没有响应），请稍后重试";
  }
  // ② 服务类：HTTP 状态码非 2xx
  var httpMatch = raw.match(/^HTTP\s+(\d{3})$/i);
  if (httpMatch) {
    var code = httpMatch[1];
    if (code === "404") return "接口地址不对（404），请联系维护者";
    if (code.charAt(0) === "5") return "服务暂时不可用（" + code + "），请稍后重试";
    return "请求失败（HTTP " + code + "），请稍后重试";
  }
  // ③ 数据类：res.json() 解析失败，或响应不是预期结构
  if (/json|unexpected token|格式异常/i.test(raw)) {
    return "接口返回的数据看不懂（格式异常），请稍后重试";
  }
  // 兜底：实在认不出的错误，也别把英文直接甩给用户；原文留在控制台
  if (raw) console.warn("[offer-coach] 未归类的错误（仅开发者可见）：", raw);
  return "加载失败，请刷新页面重试";
};

// ---------------------------------------------------------------------------
// Day 24 修复：离线兜底 —— 接口连不上时，用内置数据快照把页面撑起来
//
// 要修的是什么：
//   GitHub Pages 站点（xingho-vibecoding.github.io）不在接口的放行名单里，
//   浏览器按跨域规定拦掉了它发出的请求（CORS：响应里没有 Access-Control-Allow-Origin）。
//   结果就是：页面能打开，但数据全空、整站不可用。
//
// 为什么这么修：
//   接口侧补放行是走不通的 —— 云函数自己加跨域头会和网关叠成两个值反而更坏
//   （Day 17 踩过，见 index.js 里的注释）；免费套餐也不允许添加安全域名（Day 15 试过）。
//   所以从页面侧解：接口连不上时，加载一份随包发布的数据快照兜底。
//
// 为什么用「动态加载」而不是直接写在 HTML 里：
//   快照有 18KB，正常站点（接口通）根本用不上，写进 HTML 会让每次访问都白下载。
//   改成「只在兜底时才插入 <script>」，正常站点零开销，四个页面也一个字不用改。
//
// 重要：仍然先请求真实接口。接口哪天通了，自动回到最新数据，快照只是备胎。
// ---------------------------------------------------------------------------
window.OC_DATA_SOURCE = "api"; // api = 数据来自接口；builtin = 数据来自内置快照

/** 动态加载内置快照文件；成功返回 true，失败（文件缺失等）返回 false */
function ocLoadBuiltin() {
  return new Promise(function (resolve) {
    if (window.OC_BUILTIN_DATA) return resolve(true); // 已经加载过
    var s = document.createElement("script");
    s.src = "js/builtin-data.js";
    s.onload = function () { resolve(!!window.OC_BUILTIN_DATA); };
    s.onerror = function () { resolve(false); };
    document.head.appendChild(s);
  });
}

/** 页面顶部插一条诚实提示：现在看的是离线快照，数据可能不是最新的 */
function ocShowOfflineBanner() {
  function insert() {
    if (!document.body || document.getElementById("oc-offline-banner")) return;
    var bar = document.createElement("div");
    bar.id = "oc-offline-banner";
    bar.className = "offline-banner";
    bar.setAttribute("role", "status"); // 读屏软件也会念出来
    bar.textContent = "当前显示的是内置数据快照：接口暂时连不上（可能是网络问题，或本站点不在接口放行名单内）。数据可能不是最新的。";
    document.body.insertBefore(bar, document.body.firstChild);
  }
  if (document.body) insert();
  else document.addEventListener("DOMContentLoaded", insert);
}

var ocAbort = (typeof AbortController !== "undefined") ? new AbortController() : null;
var ocTimer = setTimeout(function () {
  if (ocAbort) ocAbort.abort();
}, 10000);
var ocOptions = ocAbort ? { signal: ocAbort.signal } : undefined;

fetch(window.OC_API_BASE + window.OC_API_PATH, ocOptions)
  .then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status); // 网络层不 OK（404 / 500 等）
    return res.json();
  })
  .then(function (json) {
    clearTimeout(ocTimer);
    // 业务层校验：按统一信封约定，code = 0 才算成功（见 api-contract.md）
    if (!json || json.code !== 0 || !json.data) {
      // 后端约定：失败时 message 已是中文（如「服务暂时不可用，请稍后重试」），直接透传
      throw new Error((json && json.message) ? json.message : "接口返回格式异常");
    }
    window.JOBS = json.data.jobs || [];
    window.SKILLS = json.data.skills || [];
    ocNotify("ready");
  })
  .catch(function (err) {
    clearTimeout(ocTimer);
    // Day 23 板块③：进控制台留英文原文（开发者排查用），页面上显示中文人话
    if (err && err.message) console.warn("[offer-coach] 数据加载失败，原文：", err.message);
    window.OC_DATA_ERROR = window.OCDescribeError(err);

    // Day 24 修复：先试着用内置快照兜底；连快照都没有（文件缺失）才落到错误态
    ocLoadBuiltin().then(function (ok) {
      if (ok && window.OC_BUILTIN_DATA) {
        var snap = window.OC_BUILTIN_DATA;
        window.JOBS = snap.jobs || [];
        window.SKILLS = snap.skills || [];
        window.OC_DATA_SOURCE = "builtin";
        console.warn("[offer-coach] 接口不可用，已切换到内置数据快照（" +
          window.JOBS.length + " 个岗位 / " + window.SKILLS.length + " 条技能）");
        ocShowOfflineBanner();
        ocNotify("ready"); // 对页面来说数据「就绪」了，正常渲染
      } else {
        console.warn("[offer-coach] 内置快照也不可用，页面落到错误态");
        ocNotify("error");
      }
    });
  });
