// offer-coach 首页渲染 —— Day 7 骨架版
// 职责只有一个：把 js/data.js 里的 8 个岗位渲染成首页卡片（对应 PRD F1 / P1）
// 存储走 storage.js、差距分析走 analyze.js —— 都是后续步骤的事，本文件不碰

(function () {
  "use strict";

  var jobs = window.JOBS || [];
  var grid = document.getElementById("job-list");

  if (!grid) return; // 找不到容器就不做事，避免报错刷屏

  if (jobs.length === 0) {
    grid.textContent = "岗位数据为空：请检查 js/data.js";
    return;
  }

  jobs.forEach(function (job) {
    var card = document.createElement("a");
    card.className = "job-card";
    // 详情页 job.html 在下一步（2c）实现；先用带参数的链接占位
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
