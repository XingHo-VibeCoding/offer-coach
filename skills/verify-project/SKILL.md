---
name: verify-project
description: offer-coach 的发布前检查清单，覆盖公网、健康、读写、密钥、Git 安全、数据库六个域；每次改完代码或上线前跑一遍，逐项输出 PASS/FAIL + 证据，不许有模糊表述
---

# 发布前检查（verify-project）

## 这个技能解决什么

前面几天的检查全靠人记：密钥有没有漏、接口通不通、数据库能不能写、跨域处理没处理……**人会忘，清单不会。**
每次改完代码、每次上线前，按本清单跑一遍，逐项给出 **PASS / FAIL + 证据**。

## 三条铁律（违反了就等于没查）

1. **有证据才算通过**：每项必须指向一条**具体输出**（数字 / 文件路径 / 响应原文）。指不出来的，写 `SKIP` 并说明原因，**不许写 PASS**。
2. **不许模糊表述**：禁止出现「应该没问题」「看起来正常」「大概通了」。只有 PASS / FAIL / SKIP 三种结论。
3. **FAIL 必须给出下一步**：报错要附原文关键行 + 初步判断，不许只说「失败了」。

## 环境健壮性（**决定这份清单能不能被信任**）

> 检查工具最容易犯的错不是「查不出问题」，而是「**假报问题**」——人看多了假警报，就会开始无视真警报。
> 下面三条是让检查**在任意终端、任意网络下都给出同一结论**的保障。

1. **不依赖外部命令行工具**：脚本用 **Node 自身能力**（`fs` / `http` / `https` / `child_process`）实现，
   不调用 `grep` / `tr` / `wc` / `curl` 这些 Unix 工具。
   *（Day 25 教训：脚本里混用 Unix 工具，在 PowerShell 里子进程是 CMD、根本没有这些命令 → 满屏 `'grep' is not recognized`、`本地=NaN 线上=NaN` 的假 FAIL。同一份脚本换个终端结论就变，等于没查。）*
2. **工具本身跑不起来 → 判 SKIP，绝不猜**：`git` / `tcb` 若在本机不可用，对应项必须写 `SKIP` 并说明「本机未找到可执行的 X」。
   **绝不能把「命令没跑起来」当成「没有命中」**——那会把 PASS 和 FAIL 判反。
   *（Day 25 教训：纯净 PATH 下 `git ls-files` 失败，旧逻辑读成「.env 入库数=0」，恰好蒙对；换成 `.env.example` 就变成假 FAIL。）*
3. **网络请求带重试**：偶发超时 / 限流不代表服务挂了。单次请求失败应重试（本项目脚本：最多 3 次、间隔 1.5 秒），仍拿不到才判 FAIL。
   *（Day 25 教训：一次抖动就让域 1.1 报 `BASE=无响应`，重试后是 200。这种 FAIL 会白白消耗排查时间。）*

## 执行前准备

```bash
cd /c/Users/32402/Desktop/work          # 项目根目录
ENV=offer-coach-d0ge7jkzfc47e2079      # CloudBase 环境 ID
BASE=https://offer-coach-d0ge7jkzfc47e2079-1496995497.tcloudbaseapp.com   # 静态托管
GH=https://xingho-vibecoding.github.io/offer-coach                        # GitHub Pages
API=https://offer-coach-d0ge7jkzfc47e2079-1496995497.ap-shanghai.app.tcloudbase.com
```

**一键跑（推荐）**：本目录下的 `run-check.js` 已按本文判据实现六域检查（纯 Node，任意终端可用）：

```bash
node skills/verify-project/run-check.js                  # 在项目根目录执行；结果同时写入 .workbuddy/tmp/verify/last-run.txt
node skills/verify-project/run-check.js --out 我的结果.txt   # 指定输出文件
```

---

## 域 1 · 公网（部署真的上去了吗）

### 1.1 两个站点可访问

```bash
for u in "$BASE/" "$GH/"; do
  printf "%s  %s\n" "$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$u")" "$u"
done
```

- **判据**：两个都返回 `200`
- **期望**：`200  $BASE/` 和 `200  $GH/`
- **FAIL 怎么办**：CloudBase 域不通 → 查静态托管部署；github.io 不通 → 查 Pages 构建状态

### 1.2 线上文件与本地内容一致

> ⚠️ **不能用「字节数相等」当判据**（第一次实跑在这里误报过，见下方说明）。
> Windows 工作区的文件被 `git checkout` 还原后，换行符会被 git 自动转成 CRLF，
> 本地字节数天然比线上（LF）大——**内容一模一样，字节数却对不上**。
>
> **正确做法：剥掉换行符差异后再比对**（统一成 LF 后比字节，或直接比内容哈希）。

```bash
for f in index.html job.html profile.html analyze.html js/data.js js/builtin-data.js css/style.css; do
  # 本地统一转成 LF 再算字节数，消除 CRLF/LF 差异
  l=$(tr -d '\r' < "$f" | wc -c)
  r=$(curl -s -H "Cache-Control: no-cache" -m 20 "$BASE/$f" | tr -d '\r' | wc -c)
  [ "$l" = "$r" ] && echo "PASS $f ($l)" || echo "FAIL $f 本地=$l 线上=$r"
done
```

- **判据**：剥掉 `\r` 之后，每个文件本地字节数 = 线上字节数
- **期望**：全部 `PASS`
- **`-H "Cache-Control: no-cache"` 不能省**，否则 CDN 缓存会让比对失真
- **FAIL 怎么办**：改过文件但忘了部署 → `tcb hosting deploy <本地> <云端> -e $ENV`；注意多参数只认第一个，必须成对写
- **⚠️ Day 25 的误报（留档）**：原判据直接比裸字节数。故意弄坏 → 还原（走了 `git checkout`）→ 本地被转成 CRLF，于是「本地 10433 ≠ 线上 10243」，**被报成 FAIL，但线上文件完全正确**（git 版与线上都是 LF、10243 字节）。若照这条假 FAIL 去查部署，纯属白忙。

### 1.3 GitHub Pages 侧关键文件已更新

```bash
echo "data.js 含 ocLoadBuiltin: $(curl -s -H 'Cache-Control: no-cache' -m 25 "$GH/js/data.js" | grep -c ocLoadBuiltin)"
curl -s -o /dev/null -w "builtin-data.js HTTP %{http_code} 大小 %{size_download}\n" -m 25 "$GH/js/builtin-data.js"
```

- **判据**：`ocLoadBuiltin` 命中 ≥ 1；快照文件 HTTP 200
- **期望**：命中 2；`HTTP 200 大小 18172`
- **说明**：Pages 是自动发布，push 后**约需 1 分钟**，立刻查会看到旧版——先等再查

---

## 域 2 · 健康（服务还活着吗）

### 2.1 接口可用且信封正确

```bash
curl -s -m 20 -H "Origin: $BASE" "$API/api/jobs" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);
    console.log('code =',j.code,'| jobs =',j.data.jobs.length,'| skills =',j.data.skills.length);
  }catch(e){console.log('FAIL 解析失败:',s.slice(0,120))}})"
```

- **判据**：`code = 0`（契约规定，见 api-contract.md 1.3）且 `jobs = 8`
- **期望**：`code = 0 | jobs = 8 | skills ≥ 37`
- **FAIL 怎么办**：`code` 非 0 → 看 message 是不是中文提示；解析失败 → 网关可能返回了 HTML 错误页

### 2.2 跨域响应头按来源正确区分

```bash
echo "--- Origin=github.io（预期无 ACAO）---"
curl -s -D - -o /dev/null -m 20 -H "Origin: https://xingho-vibecoding.github.io" "$API/api/jobs?limit=1" | grep -i -c "access-control-allow-origin"
echo "--- Origin=CloudBase（预期有 ACAO）---"
curl -s -D - -o /dev/null -m 20 -H "Origin: $BASE" "$API/api/jobs?limit=1" | grep -i -c "access-control-allow-origin"
```

- **判据**：CloudBase 来源 → `1`；github.io 来源 → `0`
- **期望**：`1` 然后 `0`
- **说明**：这是**已知限制不是故障**（BACKLOG 第 8 条，免费套餐加不了白名单）。github.io 靠内置快照兜底，这套组合是设计好的

---

## 域 3 · 读写（读接口通，不代表写接口通）

> ⚠️ **本域会真的写生产库**。执行前把「写什么、怎么删、怎么验证删净」念一遍，确认后再动手。

### 3.1 写入权限配置正确

```bash
tcb db execute -e $ENV --sql "select privilege_type from information_schema.role_table_grants where table_name='skills' and grantee='anon' order by privilege_type;"
```

- **判据**：返回 4 行，含 `SELECT / INSERT / UPDATE / DELETE`
- **说明**：云函数以 anon 身份连库，缺哪个权限对应接口就会报 `42501`（Day 18 踩过的坑）

### 3.2 真写一条 → 验证 → 真删 → 验证删净

**四步都要留证据**（完整命令见「附录 A」）：

| 步骤 | 期望结果 |
|------|---------|
| ① 写入 `__verify_temp__` | 返回 `code = 0` 且带新 `id`（若返回 `1005` 说明上轮没删净，先去删） |
| ② 查库确认存在 | `select count(*)` 该名字 = 1 |
| ③ 按 id 删除 | 返回 `code = 0`，`data.deleted.name` = `__verify_temp__` |
| ④ 再查确认删净 | 该名字 count = 0，且 `skills` 总行数回到写入前 |

- **判据**：四步全部符合期望
- **FAIL 怎么办**：① 报 `2001` → 权限缺失，回到 3.1；② 出现 `1005` → 用「附录 A」的清理命令先删残留
- **兜底**：万一 ③ 失败，**必须手工删干净再结束**——不许留下测试数据

---

## 域 4 · 密钥（上线红线）

### 4.1 三个数据源一起查，且**必须过豁免规则**

```bash
# 第 1 层：仓库现有文件
git grep -n -i -E "secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|token|postgres://|bearer"
# 第 2 层：未追踪文件
git ls-files --others --exclude-standard
# 第 3 层：Git 全历史
for kw in password api_key secret access_key private_key; do
  printf "%s: %s 个提交\n" "$kw" "$(git log --all -S"$kw" --oneline | wc -l)"
done
```

### 4.2 豁免规则（**关键**：不过这一关，本项会永远误报）

命中的行，逐条套下面的规则，**全部命中才判定为「非密钥」**：

| # | 豁免条件 | 例子（本项目实际命中） |
|---|---------|---------------------|
| E1 | 出现在 **`.md` 文档**里，且是讲解/命令/示例（不是赋值给真实值） | `SECURITY.md:41` 那行检查命令本身 |
| E2 | **赋值号右侧为空**（模板占位） | `.env.example:30 LLM_API_KEY=` |
| E3 | 出现在**代码的正则表达式/字符串比较**里，属于识别逻辑 | `js/data.js:90` 的 `/json\|unexpected token\|格式异常/` |
| E4 | 只出现在 **Git 历史**且该提交引入的是上述三类文件 | 历史命中 `ffcf1d8`（引入的正是 SECURITY.md） |
| E5 | 出现在 `.workbuddy/`（本地笔记，不入库） | —— |

### 4.3 判据

- **PASS**：所有命中行都能被 E1–E5 解释，且**没有任何一行的赋值号右侧是真实值**（形如 `KEY=sk-xxxx` / `KEY=真实字符串`）
- **FAIL**：存在无法豁免的赋值行 → 立刻停止发布，报告文件:行号 + 行内容（**不要贴出真实值全文**）
- **期望（本项目当前状态）**：第 1 层命中 6 条，**全部可豁免**；第 3 层 3 个词各 1 提交，**均为 E4 豁免** → **PASS**

> **为什么这一项最容易假警报**：Day 23 排查时结果是 0 条，因为当时还没有 `SECURITY.md`。文档一进来，**写文档时提到的特征词自己就成了告警源**。
> **一个总是误报的检查等于没有检查**——人看多了就会无视它。所以这一项的判据不是「有没有命中」，而是「命中能不能解释」。

---

## 域 5 · Git 安全（代码里没有 ≠ 历史里没有）

### 5.1 敏感文件未入库

```bash
echo "--- .env 是否入库（期望：不在）---"
git ls-files | grep -E "^\.env$" && echo "FAIL .env 已入库" || echo "PASS .env 未入库"
echo "--- .env.example 是否入库（期望：在）---"
git ls-files | grep -q "^\.env\.example$" && echo "PASS 已入库" || echo "FAIL 未入库"
```

- **判据**：`.env` **不在**、`.env.example` **在**

### 5.2 忽略规则生效

```bash
git check-ignore -q .env && echo "PASS .env 被忽略" || echo "FAIL .env 未被忽略"
git check-ignore -q .env.example && echo "FAIL 模板被误挡" || echo "PASS 模板可进仓库"
```

- **判据**：`.env` 被忽略 且 `.env.example` **不**被忽略
- **坑**：`git check-ignore -v` 匹配到**否定规则**（`!` 开头）也返回 0，所以必须用 `-q` 判退出码，不能看返回值

### 5.3 工作区状态

```bash
git status --short
```

**判据必须分两类看**（第一遍实跑在这里误报过，见下方说明）：

| 输出前缀 | 含义 | 判定 |
|---------|------|------|
| ` M` / `M ` / `MM`（已追踪文件被改） | 改了**已入库**的文件但没提交 → 线上可能与本地不一致 | **FAIL**（发布风险） |
| `??`（未追踪的新文件） | 检查期间在写的新文件（如新 Skill、临时脚本） | **不算 FAIL**，单独列一行提示即可 |

- **PASS 条件**：所有已追踪文件无未提交改动（允许存在 `??` 未追踪新文件，但必须列出）
- **FAIL 条件**：存在已追踪文件的改动 → 报告文件清单，让用户决定是否先提交
- **⚠️ 第一遍的误报（留档）**：这一天正在新建 `skills/verify-project/`，`git status` 显示 `?? skills/verify-project/`，旧判据一刀切报 FAIL——**但「检查过程中正在创建文件」本身不是发布风险**。一刀切的判据会让人养成「看到 FAIL 也不当回事」的习惯，那检查就废了。
- **⚠️ 不要用 `git status --short | wc -l` 判断**：条数多寡不区分`??`与` M`，必然误报

### 5.4 无密钥提交历史

见 域 4.1 第 3 层，判据同 域 4.3。

---

## 域 6 · 数据库（接口说的和库里存的，是一回事吗）

### 6.1 直连查真实行数

```bash
tcb db execute -e $ENV --sql "select (select count(*) from jobs) as jobs, (select count(*) from skills) as skills, (select count(*) from skills where source='用户自定义') as custom;"
```

> ⚠️ **解析前必须先剥掉 ANSI 颜色码**（第一遍实跑在这里漏报过，见下方说明）：
> `tcb` 的表格输出带 `ESC[90m` 这类终端颜色控制符，直接拿去做正则匹配会**解析失败**，
> 而人眼在终端里看到的数字是正常的——**这就是「漏报」：真数据读不到，却被判成 FAIL**。
>
> ```bash
> tcb db execute -e $ENV --sql "..." 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
> ```
> 程序化读取时用同样思路：先 `replace(/\u001b\[[0-9;]*m/g, "")` 再匹配。

- **判据**：清洗后的输出里，`jobs = 8`、`skills ≥ 37`
- **期望**：`jobs 8 | skills 38 | custom 1`（随自定义技能增删浮动）
- **⚠️ 第一遍的漏报（留档）**：未剥颜色码 → 正则匹配失败 → 误报「未能解析输出」。**实际查库是 8/38，完全正常。** 一条假的 FAIL 会把人引到数据库上去白忙一场。

### 6.2 库与接口对账

把 6.1 的行数与 域 2.1 接口返回的条数对比：

- **判据**：`库 jobs 数 = 接口 jobs 数`；`库 skills 数 = 接口 skills 数`
- **为什么必须对账**：接口可能走了**内置快照兜底**（域 2.2 说的情况），那时接口返回的是 37 条预设、库里可能是 38 —— 数字不一致本身就是**有意义的信号**，要如实记录并说明原因
- **期望**：两个来源数字一致

### 6.3 表结构关键约束在位

```bash
tcb db execute -e $ENV --sql "select count(*) as unique_idx from pg_indexes where tablename='skills' and indexdef like '%UNIQUE%';" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
```

- **判据**：清洗后 ≥ 1（`skills.name` 的唯一约束是防重复的最后一道闸）
- **期望**：`2`
- **同样要剥颜色码**，理由见 6.1（第一遍这里也漏报了）

---

## 输出格式（**必须逐项写成这样**）

每一项照这个格式输出，**一行一项**：

```
PASS | 域1 公网 | 1.1 两站点可访问 | BASE=200, GH=200
PASS | 域1 公网 | 1.2 文件一致性 | 7/7 文件字节相同（index 1949/data.js 10243/style.css 13066…）
FAIL | 域1 公网 | 1.3 Pages 已更新 | data.js 仍是旧版 6526 字节（含 ocLoadBuiltin=0）→ 等 1 分钟后重查
SKIP | 域3 读写 | 3.2 真写测试 | 用户未授权写生产库
```

**末尾必须给汇总**：

```
===== 汇总：通过 N 项 / 失败 M 项 / 跳过 K 项 =====
失败项：
  1) 域1-1.3 Pages 已更新 —— <下一步动作>
```

**收尾还有两件事**：
1. 把本次结果追加到本文末的「调用记录」段
2. **如果有 FAIL，报告不等于修好**——问用户要不要现在修

---

## 附录 A：读写域的完整命令

```bash
# ① 写入测试数据
curl -s -X POST "$API/api/skills" -H "Content-Type: application/json" \
  -H "Origin: $BASE" \
  -d '{"name":"__verify_temp__","category":"其他","stage":"基础","note":"发布前检查用的临时数据，检查完会自动删除"}'
# 期望：{"code":0,...,"data":{"skill":{"id":<新id>,...}}}     记下这个 id

# ② 查库确认存在
tcb db execute -e $ENV --sql "select count(*) from skills where name='__verify_temp__';"
# 期望：1

# ③ 按 id 删除（把 <id> 换成上一步记下的数字）
curl -s -X DELETE "$API/api/skills?id=<id>" -H "Origin: $BASE"
# 期望：{"code":0,...,"data":{"deleted":{"id":<id>,"name":"__verify_temp__"}}}

# ④ 确认删净
tcb db execute -e $ENV --sql "select count(*) from skills where name='__verify_temp__';"
# 期望：0

# 兜底清理（万一 ③ 失败，直接删库里的残留）
tcb db execute -e $ENV --sql "delete from skills where name='__verify_temp__';"
```

---

## 调用记录

> 每次真实跑完一遍后，在此追加一行：日期、跑了哪些域、结果、修正了什么。

- 2026-10-06（Day 25）第一遍：六域实跑，7 PASS / 3 FAIL。**三个 FAIL 全是检查自身的缺陷，项目本身零问题**——修正如下：
  - **漏报 ×2**（域 6.1 / 6.3）：`tcb db execute` 表格输出带 ANSI 颜色码，正则解析失败 → 误报「未能解析输出」。加「解析前剥颜色码」规则（见 6.1）。
  - **误报 ×1**（域 5.3）：一刀切判「有未提交改动 = FAIL」，但当时未提交的是**检查期间正在新建的 Skill 目录本身**。改为区分「已追踪文件被改」（FAIL）与「未追踪新文件」（提示，不计 FAIL）。
- 2026-10-06（Day 25）第二遍：同六域重跑，**10 PASS / 0 FAIL**。域 6.1 得到 `jobs=8, skills=38, custom=1`，域 6.3 得到 `UNIQUE 索引数=2`，5.3 正确识别为「已追踪文件无改动」。
- 2026-10-06（Day 25）**不虚报测试（关键验证）**：故意往 `js/data.js` 末尾追加一行、不部署 → 再跑，**成功抓出 2 项 FAIL**（域 1.2 `本地=10290 线上=10243`、域 5.3 `M js/data.js`）→ `git checkout` 还原。**证明本 Skill 会在真有问题时报 FAIL，不是走过场。**
- 2026-10-06（Day 25）**第三遍（修正换行符误报）**：还原时走了 `git checkout`，Windows 工作区被转成 CRLF（10433 字节），旧判据「裸字节数相等」误报 FAIL——**线上文件其实完全正确（LF / 10243）**。修正为「剥掉 `\r` 再比」后重跑：**10 PASS / 0 FAIL**。
- 2026-10-06（Day 25）域 3 读写补充实跑：`POST /api/skills` 写入 `__verify_temp__`（`code=0`，拿到 id=44）→ 查库确认 `found=1` → `DELETE /api/skills?id=44`（`code=0`，回执含 name）→ 复查 `leftover=0`、总行数回到 38。**四步全通、零残留。**
- 2026-10-06（Day 25）**第四遍（修正跨终端兼容 + 环境假 FAIL，本次新增 3 处）**：
  - **混用 Unix 工具 → 换终端满屏假 FAIL**：脚本原用 `grep`/`tr`/`wc`/`curl`，在用户 PowerShell 里子进程是 CMD、没有这些命令 → `'grep' is not recognized`、`本地=NaN 线上=NaN`。**改为纯 Node 实现**（`https.get` / `fs` / `process.execPath`），并在 Windows 上直接定位 `tcb` 的 JS 入口、`git` 加常见安装路径兜底。
  - **工具跑不起来被当成「没命中」→ 判反**：纯净 PATH 下 `git ls-files` 执行失败，旧逻辑读成「.env 入库数=0」，恰好蒙对；换 `.env.example` 就成假 FAIL。**改为：先探 `git --version`，不可用则整域判 `SKIP`**（域 4 / 域 5），并修正 `git check-ignore` 退出码语义（0=忽略 / 1=未忽略 / 其他=异常）。
  - **单次网络抖动 → 假 FAIL**：一次请求超时就让域 1.1 报 `BASE=无响应`（重试后是 200）。**加入重试**（至多 3 次 / 间隔 1.5 秒）。
  - 结果：工具会话与纯净 PowerShell **两个环境结论一致，均为 10 PASS / 2 FAIL**（两个 FAIL 即「故意弄坏」项 → 见上一条不虚报测试）。
- **累计修正 7 处**（都在本文档留了解释）：域 1.2 换行符误报、域 5.3 一刀切误报、域 6.1 颜色码漏报、域 6.3 颜色码漏报、跨终端 Unix 工具假 FAIL、工具不可用被当成没命中、网络抖动假 FAIL；另加域 4 的 E1–E5 豁免规则、域 1.1/1.2 的网络重试。
