// offer-coach 差距分析 —— Day 7 步骤 2e（对应 PRD P3 / F4、F5，路线 A：关键词匹配）
// 结构分两层：
//   逻辑层 window.AnalyzeLogic —— 纯计算，不碰页面，可用 Node 单独测试
//   页面层 —— 监听按钮、渲染三栏结果

(function () {
  "use strict";

  var STAGE_ORDER = { "基础": 0, "进阶": 1, "高级": 2 };

  // ---- 逻辑层 ----

  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** 判断一段文本里是否提到了某个词。
   *  英文词要求前后不是字母数字（避免 BSA 里认出 JS 这类误伤）；中文词直接查找。 */
  function mentioned(text, term) {
    var t = (text || "").toLowerCase();
    var k = (term || "").trim().toLowerCase();
    if (!k) return false;
    var isAscii = /^[\x00-\x7F]+$/.test(k);
    if (isAscii) {
      var re = new RegExp("(^|[^a-z0-9])" + escapeReg(k) + "($|[^a-z0-9])");
      return re.test(t);
    }
    return t.indexOf(k) !== -1;
  }

  /** 技能（含别名）是否被文本提到 */
  function skillMentioned(text, skill) {
    if (mentioned(text, skill.name)) return true;
    var aliases = skill.aliases || [];
    for (var i = 0; i < aliases.length; i++) {
      if (mentioned(text, aliases[i])) return true;
    }
    return false;
  }

  /** 已掌握集合 = 勾选的 + 自定义的（PRD F6：自定义技能即已掌握） */
  function buildMasteredSet() {
    var set = {};
    if (typeof window.OCStorage !== "undefined") {
      window.OCStorage.getMastered().forEach(function (n) { set[n] = true; });
      window.OCStorage.getCustom().forEach(function (n) { set[n] = true; });
    }
    return set;
  }

  /** 入口一：预设岗位 → 要求清单 */
  function analyzePreset(job) {
    var skills = {};
    (window.SKILLS || []).forEach(function (s) { skills[s.name] = s; });
    return (job.requiredSkills || []).map(function (name) {
      var s = skills[name] || {};
      return { name: name, stage: s.stage || "进阶", custom: false };
    });
  }

  /** 入口二：粘贴的岗位描述 → 要求清单（只认总表 + 自定义里有的名字） */
  function analyzeJD(text) {
    var reqs = [];
    (window.SKILLS || []).forEach(function (s) {
      if (skillMentioned(text, s)) {
        reqs.push({ name: s.name, stage: s.stage || "进阶", custom: false });
      }
    });
    if (typeof window.OCStorage !== "undefined") {
      window.OCStorage.getCustom().forEach(function (name) {
        if (mentioned(text, name)) {
          reqs.push({ name: name, stage: "进阶", custom: true });
        }
      });
    }
    return reqs;
  }

  /** 把要求清单按已掌握/缺口分栏，缺口按 基础→进阶→高级 排序（PRD M1） */
  function splitResult(reqs, masteredSet) {
    var have = [], gap = [];
    reqs.forEach(function (r, i) {
      (masteredSet[r.name] ? have : gap).push({ name: r.name, stage: r.stage, custom: r.custom, order: i });
    });
    gap.sort(function (a, b) {
      var d = (STAGE_ORDER[a.stage] !== undefined ? STAGE_ORDER[a.stage] : 1)
            - (STAGE_ORDER[b.stage] !== undefined ? STAGE_ORDER[b.stage] : 1);
      return d !== 0 ? d : a.order - b.order;
    });
    return { have: have, gap: gap };
  }

  window.AnalyzeLogic = {
    mentioned: mentioned,
    skillMentioned: skillMentioned,
    buildMasteredSet: buildMasteredSet,
    analyzePreset: analyzePreset,
    analyzeJD: analyzeJD,
    splitResult: splitResult
  };

  // ---- 页面层（Node 里没有 document，自动跳过）----
  if (typeof document === "undefined") return;

  var select = document.getElementById("job-select");
  var jdInput = document.getElementById("jd-input");
  var btn = document.getElementById("analyze-btn");
  var msg = document.getElementById("form-msg");
  var resultRoot = document.getElementById("result-root");

  // 改进②：技能名 → 一句话说明（来自 data.js 的 note 字段），给不认识的技能配注释
  var skillNotes = {};
  (window.SKILLS || []).forEach(function (s) { if (s.note) skillNotes[s.name] = s.note; });

  function setMsg(text, ok) {
    msg.textContent = text;
    msg.className = "form-msg " + (ok ? "is-ok" : "is-bad");
  }

  // 填充岗位下拉框；带 ?job= 参数时预选
  (window.JOBS || []).forEach(function (j) {
    var opt = document.createElement("option");
    opt.value = j.name;
    opt.textContent = j.name;
    select.appendChild(opt);
  });
  var preset = new URLSearchParams(location.search).get("job");
  if (preset && (window.JOBS || []).some(function (j) { return j.name === preset; })) {
    select.value = preset;
  }

  function stageBadgeClass(stage) {
    return "stage-badge stage-" + (stage === "基础" ? "basic" : stage === "高级" ? "adv" : "mid");
  }

  function renderResult(sourceLabel, reqs) {
    var masteredSet = buildMasteredSet();
    var res = window.AnalyzeLogic.splitResult(reqs, masteredSet);
    var pct = reqs.length ? Math.round(res.have.length / reqs.length * 100) : 0;

    resultRoot.textContent = "";

    var summary = document.createElement("p");
    summary.className = "summary-line";
    summary.textContent = sourceLabel + "：要求 " + reqs.length + " 项技能，已达标 " +
      res.have.length + " 项，缺口 " + res.gap.length + " 项（完成度 " + pct + "%）";
    resultRoot.appendChild(summary);

    var grid = document.createElement("div");
    grid.className = "result-grid";

    // 三栏：已达标 / 缺口 / 建议学习顺序
    [
      { cls: "col-have", title: "已达标（" + res.have.length + "）", items: res.have },
      { cls: "col-gap", title: "缺口（" + res.gap.length + "）", items: res.gap },
      { cls: "col-plan", title: "建议学习顺序", items: res.gap, numbered: true }
    ].forEach(function (col) {
      var box = document.createElement("div");
      box.className = "result-col " + col.cls;
      var h = document.createElement("h3");
      h.textContent = col.title;
      box.appendChild(h);

      if (col.items.length === 0) {
        var empty = document.createElement("p");
        empty.className = "result-empty";
        empty.textContent = col.cls === "col-gap" ? "全部达标，没有缺口 🎉" : "暂无内容";
        box.appendChild(empty);
      }
      // Day 11 交互C：学习顺序一键复制（只在该栏有内容时出现）
      if (col.cls === "col-plan" && col.items.length > 0) {
        var copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "copy-btn";
        copyBtn.textContent = "复制清单";
        copyBtn.addEventListener("click", function () {
          var lines = [sourceLabel + " · 建议学习顺序（" + col.items.length + " 项）"];
          col.items.forEach(function (item, i) {
            var note = skillNotes[item.name] ? "——" + skillNotes[item.name] : "";
            lines.push((i + 1) + ". " + item.name + "（" + item.stage + "）" + note);
          });
          var revert = function () {
            copyBtn.textContent = "复制清单";
            copyBtn.classList.remove("is-ok");
          };
          var done = function () {
            copyBtn.textContent = "✓ 已复制";
            copyBtn.classList.add("is-ok");
            setTimeout(revert, 2000);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(lines.join("\n")).then(done, function () {
              copyBtn.textContent = "✗ 复制失败";
              setTimeout(revert, 2000);
            });
          } else {
            copyBtn.textContent = "✗ 浏览器不支持";
            setTimeout(revert, 2000);
          }
        });
        box.appendChild(copyBtn);
      }
      col.items.forEach(function (item, idx) {
        var row = document.createElement("div");
        row.className = "result-item";
        if (col.numbered) {
          var no = document.createElement("span");
          no.className = "result-order";
          no.textContent = (idx + 1) + ".";
          row.appendChild(no);
        }
        var nameEl = document.createElement("span");
        nameEl.textContent = item.name;
        row.appendChild(nameEl);
        var badge = document.createElement("span");
        badge.className = stageBadgeClass(item.stage);
        badge.textContent = item.custom ? "自定义" : item.stage;
        row.appendChild(badge);
        // 改进②：缺口和学习顺序里给技能附一句「这是干嘛的」（已达标栏不加，你会的不用解释）
        if (col.cls !== "col-have" && skillNotes[item.name]) {
          var note = document.createElement("small");
          note.className = "result-note";
          note.textContent = skillNotes[item.name];
          row.appendChild(note);
        }
        box.appendChild(row);
      });
      grid.appendChild(box);
    });

    resultRoot.appendChild(grid);
    // Day 11 交互A：结果淡入（is-fresh 由 CSS 定义动画；节点每次重建，动画自然重新触发）
    resultRoot.classList.add("is-fresh");
  }

  // Day 11 交互A：按钮「分析中…」状态 + 防连点 + 结果淡入
  var analyzing = false;

  btn.addEventListener("click", function () {
    if (analyzing) return; // 连点保护：分析进行中忽略后续点击

    // 校验类错误（没选岗位/粘贴太短）直接提示，不进「分析中」状态
    var jd = jdInput.value.trim();
    if (jd && jd.length < 20) {
      setMsg("请粘贴完整的岗位描述再分析（目前 " + jd.length + " 字，至少 20 字）", false);
      return;
    }
    if (!jd && !select.value) {
      setMsg("请先选择一个岗位，或粘贴岗位描述", false);
      return;
    }

    // 进入分析中状态
    analyzing = true;
    btn.disabled = true;
    btn.classList.add("is-loading");
    var originalText = btn.textContent;
    btn.textContent = "分析中…";

    setTimeout(function () {
      try {
        if (jd) {
          var reqs = window.AnalyzeLogic.analyzeJD(jd);
          if (reqs.length === 0) {
            setMsg("没有从这段文字里认出技能要求，请检查内容或换个岗位试试", false);
            return;
          }
          setMsg("分析完成（粘贴的岗位描述）", true);
          renderResult("粘贴的岗位描述", reqs);
          return;
        }
        var job = (window.JOBS || []).filter(function (j) { return j.name === select.value; })[0];
        setMsg("分析完成（预设岗位：" + job.name + "）", true);
        renderResult("预设岗位「" + job.name + "」", window.AnalyzeLogic.analyzePreset(job));
      } finally {
        // 无论成败都恢复按钮，绝不让它卡在「分析中…」
        analyzing = false;
        btn.disabled = false;
        btn.classList.remove("is-loading");
        btn.textContent = originalText;
      }
    }, 400);
  });
})();
