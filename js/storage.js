// offer-coach 存储唯一出入口 —— Day 7 步骤 2c
// 规矩（TECH_DESIGN 第二节）：任何页面不许直接碰 localStorage，
// 读自己的进度一律走 window.OCStorage。
// 第 15 天接 CloudBase 时，只改这个文件内部，页面代码不动。

(function () {
  "use strict";

  var KEY_PROGRESS = "oc_progress";      // 已掌握的技能名数组
  var KEY_CUSTOM = "oc_custom_skills";   // 自定义技能，2d 步启用（先占位）

  // 读取一个 key，返回字符串数组；数据损坏或不存在一律返回 []（PRD 验收第 9 条）
  function readList(key) {
    try {
      var raw = localStorage.getItem(key);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeList(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false; // 存储被禁用等异常，由调用方提示
    }
  }

  window.OCStorage = {
    /** 返回已掌握技能名的数组 */
    getMastered: function () {
      return readList(KEY_PROGRESS);
    },

    /** 某个技能是否已掌握 */
    isMastered: function (skillName) {
      return readList(KEY_PROGRESS).indexOf(skillName) !== -1;
    },

    /** 设置/取消掌握；返回 true 表示保存成功 */
    setMastered: function (skillName, mastered) {
      var list = readList(KEY_PROGRESS);
      var i = list.indexOf(skillName);
      if (mastered && i === -1) {
        list.push(skillName);
        return writeList(KEY_PROGRESS, list);
      }
      if (!mastered && i !== -1) {
        list.splice(i, 1);
        return writeList(KEY_PROGRESS, list);
      }
      return true; // 状态没变化也算成功
    },

    // ---- 自定义技能（2d 步启用；对应 PRD F6）----

    /** 返回自定义技能名数组 */
    getCustom: function () {
      return readList(KEY_CUSTOM);
    },

    /** 是否已是自定义技能 */
    isCustom: function (skillName) {
      return readList(KEY_CUSTOM).indexOf(skillName) !== -1;
    },

    /** 添加自定义技能；与总表技能或已有自定义技能重名时拒绝（PRD 第七节） */
    addCustom: function (skillName) {
      var name = (skillName || "").trim();
      if (!name) return { ok: false, reason: "empty" };
      var inCatalog = (window.SKILLS || []).some(function (s) { return s.name === name; });
      if (inCatalog) return { ok: false, reason: "duplicate-catalog" };
      var list = readList(KEY_CUSTOM);
      if (list.indexOf(name) !== -1) return { ok: false, reason: "duplicate-custom" };
      list.push(name);
      return { ok: writeList(KEY_CUSTOM, list) };
    },

    /** 删除自定义技能；返回 true 表示保存成功 */
    removeCustom: function (skillName) {
      var list = readList(KEY_CUSTOM);
      var i = list.indexOf(skillName);
      if (i === -1) return true;
      list.splice(i, 1);
      return writeList(KEY_CUSTOM, list);
    }
  };
})();
