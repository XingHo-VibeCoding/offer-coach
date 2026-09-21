// offer-coach 岗位详情页逻辑 —— Day 7 步骤 2c（对应 PRD P2 / F2、F3）
// 职责：从网址参数 ?job=岗位名 找到岗位 → 渲染职责与技能清单 → 勾选即写入 OCStorage

(function () {
  "use strict";

  var root = document.getElementById("job-detail");
  if (!root) return;

  // ---- 1. 从网址参数找岗位 ----
  var jobName = new URLSearchParams(location.search).get("job");
  var jobs = window.JOBS || [];
  var job = null;
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].name === jobName) { job = jobs[i]; break; }
  }

  if (!job) {
    root.innerHTML =
      '<p class="error-tip">没有找到这个岗位' +
      (jobName ? '（参数：' + jobName + '）' : "（网址里缺少 ?job= 参数）") +
      '。请从<a href="index.html">首页岗位清单</a>进入。</p>';
    return;
  }

  // ---- 2. 渲染岗位信息 ----
  document.title = job.name + "｜Offer 教练";
  document.getElementById("job-title").textContent = job.name;
  document.getElementById("job-intro").textContent = job.intro || "";

  var skillIndex = {};
  (window.SKILLS || []).forEach(function (s) { skillIndex[s.name] = s; });

  // Day 10 修复①：技能清单按学习阶段从低到高排（基础→进阶→高级），同阶段保持原有先后
  var required = (job.requiredSkills || []).slice(); // slice 拷贝一份，不污染原始数据
  var stageRank = { "基础": 0, "进阶": 1, "高级": 2 };
  required.sort(function (a, b) {
    var sa = skillIndex[a] && skillIndex[a].stage ? stageRank[skillIndex[a].stage] : 1;
    var sb = skillIndex[b] && skillIndex[b].stage ? stageRank[skillIndex[b].stage] : 1;
    return sa - sb;
  });

  // ---- 3. 渲染技能清单（可勾选）----
  var listEl = document.createElement("div");
  listEl.className = "skill-list";

  var countEl = document.createElement("p");
  countEl.className = "progress-count";

  var statusEl = document.createElement("p");
  statusEl.className = "save-status";

  function masteredCount() {
    var n = 0;
    required.forEach(function (name) {
      if (window.OCStorage.isMastered(name)) n++;
    });
    return n;
  }

  function refreshCount() {
    countEl.textContent = "已掌握 " + masteredCount() + " / " + required.length + " 项（勾选自动保存到本浏览器）";
  }

  required.forEach(function (skillName) {
    var skill = skillIndex[skillName] || {};

    var item = document.createElement("label");
    item.className = "skill-item";

    var box = document.createElement("input");
    box.type = "checkbox";
    box.checked = window.OCStorage.isMastered(skillName);
    box.addEventListener("change", function () {
      var ok = window.OCStorage.setMastered(skillName, box.checked);
      statusEl.textContent = ok
        ? "✓ 已保存（" + new Date().toLocaleTimeString() + "）"
        : "✗ 保存失败：浏览器存储不可用";
      statusEl.className = "save-status " + (ok ? "is-ok" : "is-bad");
      refreshCount();
    });

    var text = document.createElement("span");
    text.className = "skill-text";
    text.innerHTML = ""; // 下面用 DOM 方式拼，避免注入
    var nameEl = document.createElement("strong");
    nameEl.textContent = skillName;
    var stageEl = document.createElement("span");
    stageEl.className = "stage-badge stage-" + (skill.stage === "基础" ? "basic" : skill.stage === "高级" ? "adv" : "mid");
    stageEl.textContent = skill.stage || "进阶";
    var noteEl = document.createElement("small");
    noteEl.textContent = skill.note || "";
    text.appendChild(nameEl);
    text.appendChild(stageEl);
    text.appendChild(noteEl);

    item.appendChild(box);
    item.appendChild(text);
    listEl.appendChild(item);
  });

  // ---- 4. 差距分析入口（真链接，PRD 验收第 4 条的第二个入口）----
  var analyzeLink = document.createElement("a");
  analyzeLink.className = "btn-primary analyze-link";
  analyzeLink.href = "analyze.html?job=" + encodeURIComponent(job.name);
  analyzeLink.textContent = "用这个岗位做差距分析 →";

  // ---- 5. 组装 ----
  root.textContent = "";
  var dutyEl = document.createElement("p");
  dutyEl.className = "job-duty";
  dutyEl.textContent = job.duty || "";
  root.appendChild(dutyEl);
  root.appendChild(countEl);
  root.appendChild(listEl);
  root.appendChild(statusEl);
  root.appendChild(analyzeLink);

  refreshCount();
})();
