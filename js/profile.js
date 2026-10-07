// offer-coach 我的进度页 —— Day 7 步骤 2d（对应 PRD P4 / F6）
// 两块内容：① 已掌握技能汇总（含自定义技能）② 添加/删除自定义技能
//
// 【Day 22】今天的重点：删除要加「二次确认」，并真调用云端接口
//   · 为什么加确认：删除不可逆、不能撤销，点错一下东西就没了（新增错了还能删，删错了没处找）
//   · 为什么接云端：自定义技能现在存在云数据库里（Day 18 起的写入接口），
//     页面上删了、库里还在，就会「删了又回来」——所以删除必须落到云端
//   · 找不到对应云端记录的（纯本地遗留技能）：只删本地并如实提示，不假装删了云端

// 【Day 27】把「添加」这一半也接上云端（BACKLOG 第 11 条 · P2）
//   · 改前：添加只写 localStorage，云端一行都没有 —— 换设备就丢，界面却照样说「已添加」
//   · 改后：先 POST 到 /api/skills，成功后把云端返回的记录（含 id）并入本地技能清单
//   · 为什么必须并入 id：删除是按 id 调 DELETE 的；不并入的话，自己刚加的技能
//     反而会被提示「这条只存在于你的浏览器里」——Day 22 那个老毛病
//   · 网络失败时沿用「诚实降级」：本地照常可用，但明确告知「没同步到云端」，不假装成功

(function () {
  "use strict";
  // ---- Day 17 板块⑤：数据改为从接口异步取，等就绪后再渲染 ----
  window.OCDataReady(function (state) {
    if (state === "error") {
      showDataError();
      return;
    }
    init();
  });

  function showDataError() {
    var box = document.getElementById("profile-root");
    if (!box) return;
    box.innerHTML = '<p class="state-tip state-error">进度数据加载失败：接口没有正常返回（' +
      (window.OC_DATA_ERROR || "未知原因") + '）。请刷新页面试试。</p>';
  }

  function init() {

    var root = document.getElementById("profile-root");
    if (!root) return;

    // Day 13：数据或存储脚本没加载成功时显示错误态，不再白屏假加载（此前会卡在「正在加载进度…」）
    if (typeof window.OCStorage === "undefined" || typeof window.SKILLS === "undefined") {
      root.innerHTML =
        '<p class="state-tip state-error">进度数据加载失败：读不到技能总表或本地存储模块（js/data.js 或 js/storage.js 可能没加载成功）。请刷新页面试试。</p>';
      return;
    }

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

    // 【Day 27 修正】自定义技能的来源有两个，展示时都要算上：
    //   · 云端：GET /api/jobs 的 skills[] 里 source =「用户自定义」的那些（换设备、换浏览器也看得到）
    //   · 本地：oc_custom_skills（Day 18 之前的老数据；离线兜底时新加的）
    // 只看本地会出问题：云端明明加进去了、列表却是空的 —— Day 27 实测撞到的正是这个现象。
    function listCustomNames() {
      var names = [];
      (window.SKILLS || []).forEach(function (s) {
        if (s && s.source === "用户自定义" && s.name && names.indexOf(s.name) === -1) names.push(s.name);
      });
      window.OCStorage.getCustom().forEach(function (n) {
        if (n && names.indexOf(n) === -1) names.push(n);
      });
      return names;
    }

    function refreshCustomList() {
      customList.textContent = "";
      var customs = listCustomNames();
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
          // 【Day 22】点删除不再直接删 —— 先弹确认框
          askConfirm(name, function () {
            removeCustomSkill(name);
          });
        });
        chip.appendChild(del);
        customList.appendChild(chip);
      });
    }

    // ---- 【Day 22】删除前二次确认：自绘弹窗（不用浏览器原生 confirm，样式可控、截图好看）----
    // 为什么要自绘：原生 confirm 样式由浏览器决定、无法说明「删的是什么」；
    // 自绘弹窗能把技能名明确写进去，让用户看清自己删的是哪一条。
    var lastFocus = null; // 记下弹窗打开前焦点在哪，关掉后还回去（键盘用户不迷失）

    function askConfirm(skillName, onOk) {
      lastFocus = document.activeElement;

      var mask = document.createElement("div");
      mask.className = "confirm-mask";

      var dialog = document.createElement("div");
      dialog.className = "confirm-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      var title = document.createElement("h3");
      title.className = "confirm-title";
      title.textContent = "确定删除这个技能吗？";

      var text = document.createElement("p");
      text.className = "confirm-text";
      // 把技能名原样显示出来（加引号），避免用户看错行删错东西
      text.textContent = "「" + skillName + "」将从你的自定义技能里移除。删除后不可恢复。";

      var row = document.createElement("div");
      row.className = "confirm-actions";

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn-ghost";
      cancelBtn.textContent = "取消";

      var okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "btn-danger";
      okBtn.textContent = "确定删除";

      function close() {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        document.removeEventListener("keydown", onKey);
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }

      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(); }
      }

      cancelBtn.addEventListener("click", close);
      // 点遮罩空白处 = 取消（常见的「我反悔了」操作，不能让它变成删除）
      mask.addEventListener("click", function (e) {
        if (e.target === mask) close();
      });
      okBtn.addEventListener("click", function () {
        close();
        onOk();
      });
      document.addEventListener("keydown", onKey);

      row.appendChild(cancelBtn);
      row.appendChild(okBtn);
      dialog.appendChild(title);
      dialog.appendChild(text);
      dialog.appendChild(row);
      mask.appendChild(dialog);
      document.body.appendChild(mask);
      // 焦点默认落在「取消」上：误按回车时安全的那一边先响应
      cancelBtn.focus();
    }

    // ---- 【Day 22】真删除：先找云端记录 → 调 DELETE → 再删本地 ----
    // 找不到云端记录（纯本地遗留技能）→ 只删本地，并如实告知「这条只存在你的浏览器里」。
    // 为什么这么设计：本地和云端本来就可能对不上（老数据在浏览器、新数据在库里），
    // 强行「假装删了云端」或「因为云端没有所以不删」都是错的，如实告知才是对的。
    function removeCustomSkill(skillName) {
      var cloudSkill = (window.SKILLS || []).filter(function (s) {
        return s.name === skillName && s.source === "用户自定义";
      })[0];

      if (!cloudSkill || cloudSkill.id === undefined) {
        window.OCStorage.removeCustom(skillName);
        refreshCustomList();
        refreshMasteredList();
        formMsg.textContent = "✓ 已移除「" + skillName + "」（这条只存在于你的浏览器里，云端没有记录）";
        formMsg.className = "form-msg is-ok";
        return;
      }

      formMsg.textContent = "正在删除「" + skillName + "」…";
      formMsg.className = "form-msg";

      fetch(window.OC_API_BASE + "/api/skills?id=" + encodeURIComponent(cloudSkill.id), {
        method: "DELETE"
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (json) {
          // 按统一信封：code=0 才算删成功（见 api-contract.md 3.6.2）
          if (!json || json.code !== 0) {
            var msg = (json && json.message) ? json.message : "删除失败，请重试";
            // 1004（已被删掉）不算坏事：库里本来就没有，接着把本地也清掉
            if (json && json.code === 1004) {
              window.OCStorage.removeCustom(skillName);
              dropSkill(skillName);
              refreshCustomList();
              refreshMasteredList();
              formMsg.textContent = "这条技能云端已经不存在了，已帮你从本地清单移除";
              formMsg.className = "form-msg is-ok";
              return;
            }
            formMsg.textContent = msg;
            formMsg.className = "form-msg is-bad";
            return;
          }
          // 云端删成功 → 再把本地记录删掉，两边保持一致
          window.OCStorage.removeCustom(skillName);
          dropSkill(skillName);
          refreshCustomList();
          refreshMasteredList();
          var deleted = json.data && json.data.deleted;
          formMsg.textContent = "✓ 已删除「" + ((deleted && deleted.name) || skillName) + "」（云端 + 本地都已移除）";
          formMsg.className = "form-msg is-ok";
        })
        .catch(function (err) {
          // 网络层失败：本地不动，避免出现「本地没了、云端还在」的不一致
          // Day 23 板块③：err.message 是英文技术黑话（如 "Failed to fetch"），
          // 用 data.js 的错误翻译层换成中文，别把英文甩给用户
          if (err && err.message) console.warn("[offer-coach] 删除请求失败，原文：", err.message);
          var why = (window.OCDescribeError) ? window.OCDescribeError(err) : "网络异常";
          formMsg.textContent = "删除失败：" + why +
            "。请检查网络后重试（本地清单未改动）";
          formMsg.className = "form-msg is-bad";
        });
    }

    // ---- 【Day 27】添加自定义技能：改为「先同步云端，再落本地」----
    // 修的是什么（BACKLOG 第 11 条 · P2）：此前只写浏览器本地，云端一行都没有——
    //   换设备/清缓存就丢，而界面照样说「已添加」，属于最伤信任的那类「以为存了、其实没存」。
    // 为什么这么设计（与 Day 22 删除的「诚实降级」保持一致）：
    //   · 云端成功    → 本地也记一份（本机立即可用），并把云端返回的记录并入 SKILLS
    //                   —— 关键：删除要按 id 调 DELETE，不并入就永远找不到 id
    //   · 云端 1005   → 云端已有同名（可能别人加的）：本地也记一份，如实说明
    //   · 网络/服务不可用 → 本地照常添加（不剥夺可用功能），但明说「没同步到云端」
    //   · 其他业务错误 → 不动本地，原样显示云端的中文提示
    // 为什么发默认值：页面只有一个输入框，而接口要求分类/阶段/说明三项。
    //   stage 用「进阶」与页面提示一致（自定义技能统一按进阶参与排序）；category 归「其他」；
    //   note 写明来源，不编造技能说明。
    var CUSTOM_DEFAULTS = {
      category: "其他",
      stage: "进阶",
      note: "用户在「我的进度」页手动添加的技能（未填写说明）"
    };

    function setFormMsg(text, kind) {
      formMsg.textContent = text;
      formMsg.className = "form-msg" + (kind ? " is-" + kind : "");
    }

    /** 把云端返回的技能并入本地技能清单（同名的替换，没有的追加） */
    function upsertSkill(skill) {
      if (!skill || !skill.name) return;
      var list = window.SKILLS || (window.SKILLS = []);
      var replaced = false;
      list.forEach(function (s, i) {
        if (s.name === skill.name) { list[i] = skill; replaced = true; }
      });
      if (!replaced) list.push(skill);
      skillIndex[skill.name] = skill;
    }

    /** 从本地技能清单里摘掉（云端删除成功后调用）
     *  为什么必须摘：列表现在也读云端来的自定义技能，不摘的话「删掉了却还挂在列表上」 */
    function dropSkill(skillName) {
      var list = window.SKILLS || [];
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i] && list[i].name === skillName) list.splice(i, 1);
      }
      delete skillIndex[skillName];
    }

    /** 总表里已有同名技能时的提示（列出关联岗位，用户不用一个个点进去找） */
    function showCatalogDuplicate(name, skill) {
      var jobs = (skill && skill.relatedJobs) || [];
      if (jobs.length === 0) {
        setFormMsg("「" + name + "」已经在技能总表里，去岗位详情页勾选即可，不用重复添加", "bad");
        return;
      }
      setFormMsg("「" + name + "」已经在技能总表里，去 ", "bad");
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

    function submitCustom() {
      var name = input.value.trim();
      if (!name) { setFormMsg("请先输入技能名", "bad"); return; }

      // 本地先拦掉两种重名（不用等网络往返，反馈更快）
      var existing = (window.SKILLS || []).filter(function (s) { return s.name === name; })[0];
      if (existing && existing.source !== "用户自定义") { showCatalogDuplicate(name, existing); return; }
      if ((existing && existing.source === "用户自定义") || window.OCStorage.isCustom(name)) {
        setFormMsg("「" + name + "」你已经添加过了", "bad");
        return;
      }

      setFormMsg("正在添加「" + name + "」…");

      function finishLocally(suffix, kind, cloudSkill) {
        // 【顺序很关键 —— Day 27 实测踩到过】必须先写本地、再把云端记录并入 SKILLS。
        // 反过来的话，addCustom 的重名检查会把「自己刚加的技能」当成「总表已有的技能」而拒绝写本地，
        // 结果绿字提示照常出现、列表里却是空的：越像成功越难发现。
        window.OCStorage.addCustom(name);           // ① 本地记一份，本机立即可用
        if (cloudSkill) upsertSkill(cloudSkill);    // ② 再把云端记录（含 id）并入清单
        refreshCustomList();
        refreshMasteredList();
        input.value = "";
        setFormMsg("✓ 已添加「" + name + "」（" + suffix + "）", kind);
      }

      fetch(window.OC_API_BASE + "/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          category: CUSTOM_DEFAULTS.category,
          stage: CUSTOM_DEFAULTS.stage,
          note: CUSTOM_DEFAULTS.note
        })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (json) {
          if (json && json.code === 0) {
            // 并入云端记录（含 id）：本机立即可用，将来删除才能按 id 落到云端
            finishLocally("已记入云端数据，默认按进阶阶段参与分析", "ok", json.data && json.data.skill);
            return;
          }
          if (json && json.code === 1005) {
            // 云端已有这条同名技能：本机也加上，两边保持一致
            finishLocally("云端已有这条技能，已加入你的清单", "ok");
            return;
          }
          setFormMsg((json && json.message) ? json.message : "添加失败，请重试", "bad");
          refreshCustomList();
          refreshMasteredList();
        })
        .catch(function (err) {
          if (err && err.message) console.warn("[offer-coach] 添加请求失败，原文：", err.message);
          var why = (window.OCDescribeError) ? window.OCDescribeError(err) : "网络异常";
          // 诚实降级：本机照常可用，但绝不假装同步成功 —— 直说这条只在这台设备上
          finishLocally("只存在这台设备，没同步到云端：" + why, "bad");
        });
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

          if (listCustomNames().indexOf(name) !== -1) {
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
  }
})();
