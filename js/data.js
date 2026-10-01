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

// 取数据。加 10 秒超时：网络卡住时给用户一个明确的失败提示，而不是一直转圈
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
      throw new Error((json && json.message) ? json.message : "接口返回格式异常");
    }
    window.JOBS = json.data.jobs || [];
    window.SKILLS = json.data.skills || [];
    ocNotify("ready");
  })
  .catch(function (err) {
    clearTimeout(ocTimer);
    window.OC_DATA_ERROR = (err && err.message) ? err.message : String(err);
    ocNotify("error");
  });
