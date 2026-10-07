# ROLLBACK · 发布与回滚手册

> **一句话分界：回滚只救「代码 / 部署」的问题。数据一旦被误删，回滚救不回来 —— 网页退回上一版，数据库里被删的那行还是没的。数据只能靠备份重新导入（第五节，Day 27 落地）。备份和回滚是两套动作，分开练。**

---

## 一、v1.0 发布记录

| 项 | 值 |
|---|---|
| 版本 | **v1.0**（项目第一个版本标记） |
| 发布日期 | 2026-10-07 |
| 发布提交 | tag `v1.0` 指向的提交（`git rev-parse v1.0` 可查） |
| 上一版（回退目标） | tag `pre-v1.0` = `dde5d57`（Day 25） |
| 发布内容 | 12 个业务文件（4 HTML + `css/style.css` + 7 个 js）；页脚加 `· v1.0`、README 加版本行 |
| 部署方式 | `tcb hosting deploy` 逐路径成对上传（见 DEPLOY-NOTES.md） |
| 发布验证 | 12/12 逐字节一致；4 页面 200；`/api/health` ok；`/api/jobs` code=0、8 岗位 38 技能；写读删四步零残留 |
| 发布前备份 | git tag `pre-v1.0` + 物理导出件（见第六节） |
| 发现未修 | `POST /api/skills` 返回缺 `id`（文档不一致，BACKLOG 第 14 条，P4） |

---

## 二、什么情况必须回滚（判断表）

| 情况 | 判断 | 动作 |
|---|---|---|
| 发布后**核心功能坏了**（页面打不开 / 接口持续报错） | **必须回滚** | 先退回上一版止血，再排查根因 |
| 发布后只是样式小问题、不影响使用 | **不必回滚** | 记 BACKLOG，随下一版修复（forward fix）——回滚的代价比小瑕疵大 |
| 数据库数据被误删 / 写坏 | **回滚无用** | 走第五节数据恢复 |
| 密钥泄露 | **先换密钥再评估** | 撤销泄露的密钥是第一动作；回滚代码挡不住已泄露的密钥 |
| 检查报「线上文件与本地不一致」 | **先查原因** | 多半是部署遗漏，重新部署即可；确认是新版本身坏了才回滚 |

> **原则：回滚是为了止血，不是为了修 bug。** 退回之后仍然要找到根因、修好、再发新版。动不动就回滚、回滚完就不查了，等于把问题埋回去。

---

## 三、回滚操作 · 静态托管（2026-10-07 真实演练，总耗时 **55 秒**）

**先认清平台事实**：`tcb hosting deploy` 的帮助明说 **no version management**（无版本管理），控制台也没有「一键回退」按钮 —— 所以**回滚 = 重新部署上一版的文件**，这不是将就，是它唯一的回退方式。

### 分步操作

```bash
# ① 导出上一版（以 pre-v1.0 = dde5d57 为例）——实测 12 文件约 11.5 秒
OUT=.workbuddy/tmp/backups/rollback-$(date +%m%d%H%M)
mkdir -p "$OUT/css" "$OUT/js"
for f in index.html job.html profile.html analyze.html \
         css/style.css \
         js/analyze.js js/app.js js/builtin-data.js js/data.js js/job.js js/profile.js js/storage.js; do
  git show pre-v1.0:"$f" > "$OUT/$f"
done

# ② 逐路径部署（必须成对写！"多参数只认第一个"，Day 20 踩过的坑）
cd "$OUT"
tcb hosting deploy index.html   index.html   -e <环境ID>
tcb hosting deploy job.html     job.html     -e <环境ID>
tcb hosting deploy profile.html profile.html -e <环境ID>
tcb hosting deploy analyze.html analyze.html -e <环境ID>
tcb hosting deploy css css -e <环境ID>
tcb hosting deploy js  js  -e <环境ID>

# ③ 确认生效（CDN 可能有缓存，用 no-cache 头探测）
curl -s -H "Cache-Control: no-cache" https://<静态域名>/index.html | grep -o 'site-footer">[^<]*'
# 期望看到上一版的页脚（无 v1.0）。浏览器验证请强刷（Ctrl+F5）

# ④ 回滚后核验（三项缺一不可）
#    a. 线上 = 备份件 逐字节比对（统一 LF 后 wc -c）
#    b. 四个页面 HTTP 200
#    c. /api/jobs 返回 code=0 —— 证明只动了文件、没伤到数据
```

### 演练实测数据（2026-10-07 09:37–09:38）

| 阶段 | 结果 |
|---|---|
| 部署 12 文件 | 约 40 秒全部上传完成 |
| 确认生效 | **第 1 次探测即确认**（页脚 v1.0 消失） |
| **总耗时** | **55 秒** |
| 回滚后核验 | 12/12 逐字节一致；4 页面 200；接口 code=0 不受影响 |

### 注意事项

- 平台提供 `tcb hosting deploy --verify`（发布后自动校验线上=本地）与 `--safe`（发布前自动备份 + 上传/校验失败自动回滚）选项，可作为辅助保障（**未实测**，用前先在测试环境试）
- 回滚时**绝不碰平台文件**（`__auth/*`、`cloud-admin/index.html` 共 6 个）—— 只部署自己的 12 个业务文件
- GitHub Pages（B 站）走 git 推送自动发布，回退方式不同：`git revert` 后等它自动重新部署（约 1 分钟）

---

## 四、云函数回退（只写步骤，未实操）

思路：云函数代码同样在 git 里（`cloudbase/functions/api/`），回退 = 取上一版代码 → 重新部署。

1. 导出：`git show <上一版提交>:cloudbase/functions/api/index.js > 临时目录/index.js`（`db.js` 同理）
2. 部署：免费版走**控制台网页在线编辑**粘贴保存（注意 Day 16 的坑：本地 `cloudbase/functions/api-health/` 缺 `scf_bootstrap`，CLI 整体部署会覆盖云端，先从控制台同步回本地）
3. 验证：`/api/health` 返回 `status:ok`、`/api/jobs` 返回 `code=0`
4. **别忘契约**：`api-contract.md` 的版本号要跟着回退，避免契约与实现脱节（Day 26 实例：Day 22 给 3.2 补 `id` 时 3.5 没跟上，就是不回看契约的代价）

---

## 五、数据恢复（只写步骤，未实操 —— Day 27 落地）

**回滚救不了数据**：回滚动的是静态文件；数据在 PostgreSQL 里，网页退一版，数据不会回来。

1. 用 Day 27 导出的备份（`tcb db export` 或 SQL dump）
2. 重新导入：`tcb db execute --sql` 或控制台导入
3. 导入后对账：`select count(*)` 与备份时的行数核对，抽查几行内容
4. 权限检查：anon 的授权是手动 GRANT 的（见 `db/schema.sql` 末尾），重建表后要重新授权，否则写接口全挂（Day 18 的 42501 老坑）

---

## 六、发布前备份（两份，来源不同）

| 备份 | 位置 | 说明 |
|---|---|---|
| **git 标签（最终备份）** | 仓库内 tag `pre-v1.0` | 任何历史版本的任何文件都能 `git show pre-v1.0:<文件>` 随时取出 —— **git 历史本身就是最可靠的备份** |
| 物理导出件（加速用） | `.workbuddy/tmp/backups/pre-v1.0/`（不入库） | 12 个文件，合计 90743 字节 + `MANIFEST.txt`（文件名 / 字节数 / SHA256 前 16 位） |

**校验方法**：

```bash
sha256sum <文件> | cut -c1-16   # 前 16 位与 MANIFEST.txt 比对，对不上 = 备份被动过
```

> 物理导出件放在 `.workbuddy/tmp/` 下，可能被清理 —— 但没关系，只要 tag 在，随时能重新导出（第三节第 ① 步就是完整的重新导出命令）。
