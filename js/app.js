// offer-coach 首页渲染 —— Day 8（四种页面状态：加载中 / 空 / 正常 / 错误）
// 加载态由 index.html 里 #job-list 的预置占位承担，本脚本执行时负责落到后三种之一：
//   window.JOBS 不存在（data.js 没加载成功）→ 错误态
//   JOBS 是空数组 → 空态
//   否则 → 正常态，渲染岗位卡片（数据来自本地 mock 文件 js/data.js）

(function () {
  "use strict";

  var grid = document.getElementById("job-list");

  if (!grid) return; // 找不到容器就不做事，避免报错刷屏

  // 错误态：数据文件没加载出来（文件缺失、路径写错、脚本加载失败等）
  if (typeof window.JOBS === "undefined") {
    grid.innerHTML =
      '<p class="state-tip state-error">岗位数据加载失败：读不到岗位清单（js/data.js 可能没加载成功）。请刷新页面试试；仍不行请检查文件是否存在。</p>';
    return;
  }

  var jobs = window.JOBS;

  // 空态：数据加载成功了，但清单里一个岗位都没有
  if (jobs.length === 0) {
    grid.innerHTML =
      '<p class="state-tip state-empty">岗位清单是空的：数据文件里还没有收录任何岗位。</p>';
    return;
  }

  // 正常态：先清掉「加载中」占位，再渲染岗位卡片
  grid.textContent = "";
  jobs.forEach(function (job) {
    var card = document.createElement("a");
    card.className = "job-card";
    card.href = "job.html?job=" + encodeURIComponent(job.name);

    var title = document.createElement("h2");
    title.textContent = job.name;

    var intro = document.createElement("p");
    intro.className = "job-intro";
    intro.textContent = job.intro || "";

    var meta = document.createElement("p");
    meta.className = "job-meta";
    meta.textContent = "要求 " + (job.requiredSkills ? job.requiredSkills.length : 0) + " 项技能";

    card.appendChild(title);
    card.appendChild(intro);
    card.appendChild(meta);
    grid.appendChild(card);
  });
})();
