// offer-coach 我的进度页 —— Day 7 步骤 2d（对应 PRD P4 / F6）
// 两块内容：① 已掌握技能汇总（含自定义技能）② 添加/删除自定义技能

(function () {
  "use strict";

  var root = document.getElementById("profile-root");
  if (!root) return;

  var skillIndex = {};
  (window.SKILLS || []).forEach(function (s) { skillIndex[s.name] = s; });

  // ---- 第一部分：自定义技能表单 ----
  var customSection = document.createElement("section");
  customSection.className = "panel";

  var customTitle = document.createElement("h2");
  customTitle.textContent = "自定义技能";
  customTitle.className = "panel-title";

  var customTip = document.createElement("p");
  customTip.className = "panel-tip";
  customTip.textContent = "总表里没有、但你已经掌握的技能，加在这里（差距分析时同样算数）。自定义技能统一按「进阶」阶段参与排序。";

  var formRow = document.createElement("div");
  formRow.className = "form-row";
  var input = document.createElement("input");
  input.type = "text";
  input.className = "text-input";
  input.placeholder = "输入技能名，例如：Kubernetes";
  input.maxLength = 30;
  var addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn-primary";
  addBtn.textContent = "添加";

  var formMsg = document.createElement("p");
  formMsg.className = "form-msg";

  var customList = document.createElement("div");
  customList.className = "chip-list";

  function refreshCustomList() {
    customList.textContent = "";
    var customs = window.OCStorage.getCustom();
    if (customs.length === 0) {
      customList.innerHTML = '<span class="chip-empty">还没有自定义技能</span>';
      return;
    }
    customs.forEach(function (name) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = name + " ";
      var del = document.createElement("button");
      del.type = "button";
      del.className = "chip-del";
      del.textContent = "×";
      del.title = "删除这个自定义技能";
      del.addEventListener("click", function () {
        window.OCStorage.removeCustom(name);
        refreshCustomList();
        refreshMasteredList();
      });
      chip.appendChild(del);
      customList.appendChild(chip);
    });
  }

  function submitCustom() {
    var name = input.value.trim();
    if (!name) {
      formMsg.textContent = "请先输入技能名";
      formMsg.className = "form-msg is-bad";
      return;
    }
    var res = window.OCStorage.addCustom(name);
    if (res.ok) {
      formMsg.textContent = "✓ 已添加「" + name + "」（默认按进阶阶段参与分析）";
      formMsg.className = "form-msg is-ok";
      input.value = "";
    } else if (res.reason === "duplicate-catalog") {
      // 改进①：重名时直接列出该技能关联的岗位链接，用户不用一个个点进去找
      var skill = (window.SKILLS || []).filter(function (s) { return s.name === name; })[0];
      var jobs = (skill && skill.relatedJobs) || [];
      formMsg.className = "form-msg is-bad";
      if (jobs.length === 0) {
        // 兜底：总表里查不到关联岗位时，退回通用提示
        formMsg.textContent = "「" + name + "」已经在技能总表里，去岗位详情页勾选即可，不用重复添加";
      } else {
        formMsg.textContent = "「" + name + "」已经在技能总表里，去 ";
        jobs.forEach(function (jn, i) {
          var a = document.createElement("a");
          a.href = "job.html?job=" + encodeURIComponent(jn);
          a.textContent = jn;
          formMsg.appendChild(a);
          if (i < jobs.length - 1) formMsg.appendChild(document.createTextNode("、"));
        });
        formMsg.appendChild(document.createTextNode(
          (jobs.length > 1 ? " 任一" : "") + "个详情页勾选即可，不用重复添加"));
      }
    } else {
      formMsg.textContent = res.reason === "duplicate-custom" ? "「" + name + "」你已经添加过了" : "添加失败，请重试";
      formMsg.className = "form-msg is-bad";
    }
    refreshCustomList();
    refreshMasteredList();
  }

  addBtn.addEventListener("click", submitCustom);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitCustom();
  });

  formRow.appendChild(input);
  formRow.appendChild(addBtn);
  customSection.appendChild(customTitle);
  customSection.appendChild(customTip);
  customSection.appendChild(formRow);
  customSection.appendChild(formMsg);
  customSection.appendChild(customList);

  // ---- 第二部分：已掌握技能汇总 ----
  var masteredSection = document.createElement("section");
  masteredSection.className = "panel";

  var masteredTitle = document.createElement("h2");
  masteredTitle.className = "panel-title";
  var masteredTip = document.createElement("p");
  masteredTip.className = "panel-tip";
  masteredTip.textContent = "在岗位详情页勾选的技能会汇总在这里；取消勾选即从进度中移除。";

  var masteredList = document.createElement("div");
  masteredList.className = "mastered-list";

  function refreshMasteredList() {
    masteredList.textContent = "";
    var mastered = window.OCStorage.getMastered();
    if (mastered.length === 0) {
      masteredList.innerHTML =
        '<p class="chip-empty">还没有勾选任何技能。去<a href="index.html">岗位详情页</a>把你会的勾上吧。</p>';
    } else {
      mastered.forEach(function (name) {
        var skill = skillIndex[name] || {};
        var row = document.createElement("div");
        row.className = "mastered-item";

        var nameEl = document.createElement("strong");
        nameEl.textContent = name;
        row.appendChild(nameEl);

        if (window.OCStorage.isCustom(name)) {
          var tag = document.createElement("span");
          tag.className = "stage-badge stage-custom";
          tag.textContent = "自定义";
          row.appendChild(tag);
        } else if (skill.stage) {
          var stage = document.createElement("span");
          stage.className = "stage-badge stage-" +
            (skill.stage === "基础" ? "basic" : skill.stage === "高级" ? "adv" : "mid");
          stage.textContent = skill.stage;
          row.appendChild(stage);
        }

        if (skill.relatedJobs && skill.relatedJobs.length) {
          var jobs = document.createElement("small");
          jobs.textContent = "关联岗位：" + skill.relatedJobs.join("、");
          row.appendChild(jobs);
        }
        masteredList.appendChild(row);
      });
    }
    masteredTitle.textContent = "已掌握技能（" + mastered.length + " 项）";
  }

  masteredSection.appendChild(masteredTitle);
  masteredSection.appendChild(masteredTip);
  masteredSection.appendChild(masteredList);

  // ---- 组装 ----
  root.textContent = "";
  root.appendChild(customSection);
  root.appendChild(masteredSection);
  refreshCustomList();
  refreshMasteredList();
})();
