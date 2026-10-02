# offer-coach 部署与跨域备忘（DEPLOY-NOTES.md）

这份文件记录**「东西放在哪、怎么发上去、踩过哪些坑」**。第 4 周起所有改动都在这套部署上做，这份记录会被反复翻，所以单独成文。

> 维护约定：以后每踩一个新坑，就往「四、踩坑清单」里追加一条（症状 / 原因 / 解法）。命令有变化，同步改第二、三节。

---

## 一、公网地址清单

| 用途 | 地址 |
|---|---|
| **静态托管（网页）** | `https://offer-coach-d0ge7jkzfc47e2079-1496995497.tcloudbaseapp.com/` |
| **接口网关（API）** | `https://offer-coach-d0ge7jkzfc47e2079-1496995497.ap-shanghai.app.tcloudbase.com` |
| 环境 ID | `offer-coach-d0ge7jkzfc47e2079`（注意是 **jk** 不是 kj） |
| 地域 | ap-shanghai（上海） |
| 套餐 | 免费体验版（到期 2027-03-28） |

**页面上用的接口**：

| 接口 | 方法 | 用途 |
|---|---|---|
| `/api/health` | GET | 健康检查（返回扁平结构，不是统一信封） |
| `/api/jobs` | GET | 岗位清单 + 技能总表（`?limit=N` 可选） |
| `/api/skills` | POST | 新增一条自定义技能 |

> 接口的字段、错误码以 `api-contract.md` 为准。

---

## 二、云函数部署（`api`）

```bash
# 在项目根目录执行
tcb fn deploy api --httpFn --force -e offer-coach-d0ge7jkzfc47e2079
```

**注意事项**：

- **不要加 `--path`**：路由已经建好了，加了会触发 CLI 自动建路由，而它建出来的类型是错的（见踩坑清单第 3 条）。
- `--httpFn` 表示这是 HTTP 函数（常驻服务形态），必须带上。
- 云函数目录：`cloudbase/functions/api/`，入口 `index.js`，启动脚本 `scf_bootstrap`。
- 代码分层（Day 19 起）：`index.js` = 接口层（校验参数、拼响应、分发路径）；`db.js` = 数据访问层（唯一碰数据库的文件）。

### 网关路由（HTTP 访问服务）

路由是**精确匹配**的，新增接口路径必须先在网关注册，否则请求到不了函数。

新增路径的可行做法：用 `tcb fn deploy api --httpFn --force --path /api/xxx` 让 CLI 自动登记，**但登记后必须改两处**：

```bash
# Git Bash 下要加 MSYS_NO_PATHCONV=1，否则 /api/xxx 会被当成 Windows 路径转换
MSYS_NO_PATHCONV=1 tcb fn deploy api --httpFn --force --path /api/xxx -e <envId>

# 改回正确的类型 + 打开路径透传
printf 'y\n' | tcb routes edit -e <envId> --data '{"domain":"*","routes":[{"path":"/api/xxx","upstreamResourceType":"WEB_SCF","upstreamResourceName":"api","enablePathTransmission":true}]}'
```

查看现状：

```bash
tcb routes list -e <envId> --json
```

---

## 三、静态托管部署（网页）

```bash
tcb hosting deploy <本地路径> <云端路径> -e <envId>
```

**正确用法（重要）**：

```bash
tcb hosting deploy index.html index.html -e <envId>   # 单个文件
tcb hosting deploy js js -e <envId>                   # 目录（本地 js → 云端 js）
tcb hosting deploy css css -e <envId>                 # 目录（本地 css → 云端 css）
```

**不要这么写**：

```bash
tcb hosting deploy index.html job.html analyze.html   # 一次多个文件：只有第一个生效
tcb hosting deploy js css                             # 危险：被理解成「本地 js → 云端 css」
```

其他命令：

```bash
tcb hosting list -e <envId>              # 列出线上文件
tcb hosting list -e <envId> --json       # JSON 输出（脚本里好用）
tcb hosting delete <云端路径> -e <envId>  # 删除单个文件
```

**上传后怎么确认真的传上去了**（不要只信命令输出）：

```bash
# 逐字节比对线上与本地，这是最硬的验证
curl -s "https://<静态托管域名>/js/data.js" | wc -c
wc -c < js/data.js
```

---

## 四、数据库操作

```bash
# 执行任意 SQL（支持整份多语句文件）
tcb db execute -e <envId> --sql "select count(*) from skills;"
tcb db execute -e <envId> --sql "$(cat db/xxx.sql)"
```

**注意事项**：

- `db/schema.sql` 是**先 DROP 再建**的开发期脚本。第 20 天上线后**不要再跑**，改走增量 SQL（只写 ALTER / CREATE，不写 DROP）。
- 表重建后必须**重新授权**，否则写接口静默失效：

  ```sql
  GRANT INSERT ON skills TO anon;
  ```

  这条已经写进 `db/schema.sql` 末尾，防止将来重建时漏掉。**原因见踩坑清单第 4 条。**

---

## 五、跨域（CORS）

### 怎么理解

浏览器有个安全规则：**A 网站上的页面，不能随随便便去请求 B 网站的接口**，除非 B 明确说「我允许 A」。这个「允许」就是响应头里的 `Access-Control-Allow-Origin`（简称 ACAO）。

### 怎么配

CloudBase 控制台 → 云函数 → HTTP 访问服务 → 跨域配置 → 把**你自己的静态托管域名**加进去。

- **填自己的域名**（如 `offer-coach-d0ge7jkzfc47e2079-1496995497.tcloudbaseapp.com`）
- **不要填 `*` 通配符**（等于对所有人敞开，且不安全）
- 我们的静态托管域名已在白名单里（2026-09-28 添加）

### 为什么函数代码里一个跨域头都不写

**CloudBase 网关（tcbgw）自带跨域处理。** 请求带 `Origin` 时，网关会自己回显 origin。如果函数代码里**再写一遍** `Access-Control-Allow-Origin: *`，两个值会叠成：

```
access-control-allow-origin: https://xxx.tcloudbaseapp.com,*
```

这个头**只允许一个值**，浏览器看到两个值直接判定跨域失败 —— 页面能打开，但数据是空的。

**结论：函数层一个跨域头都不要碰，跨域全权交给网关。**（Day 17 踩过，见踩坑清单第 5 条。）

### 怎么确认配好了

1. 刷新页面，能看到真实数据（不是空列表）
2. F12 → Network → 找到那条接口请求：
   - **Request URL** 是公网接口地址
   - **Status** 是 `200`
   - **Response Headers** 里有 `access-control-allow-origin: https://<你的域名>`（**只有一个值**）
   - Console 里没有红色 CORS 报错

### 已知限制

**GitHub Pages 域名加不进白名单。** `xingho-vibecoding.github.io` 不在允许列表里，而**免费体验版不允许自行添加安全域名**（`tcb cors add` 各种写法都报「当前套餐无法执行此操作」）。

→ 影响：GitHub Pages 上那份部署（`https://xingho-vibecoding.github.io/offer-coach/`）请求接口会被拦，页面能打开但没有数据。

→ 现行对策：**演示、截图统一使用 CloudBase 静态托管域名**。已记入 `BACKLOG.md`。

---

## 六、踩坑清单（按时间顺序）

### 1. API Key 未开放（Day 15）

- **症状**：想用 CLI 做某些操作，提示权限不足 / 找不到密钥。
- **原因**：本环境只发放了 `publish_key`，没有完整的 API Key。
- **解法**：改用控制台网页操作，或走 `tcb` CLI 的交互式登录。

### 2. 云函数连库报 `Invalid schema: <envId>`（Day 17）

- **症状**：云函数启动后所有查询失败。
- **原因**：SDK 的 `rdb()` 默认把**环境 ID** 当作 schema 名（源码里 `database = envId`），而这个值会作为 PostgREST 的 schema 参数发出。
- **解法**：显式指定 schema：

  ```js
  const db = app.rdb({ database: "public" });
  ```

### 3. `tcb fn deploy --path` 建出来的路由是错的（Day 17、Day 18 各踩一次）

- **症状**：路由建好了，但请求报 `FUNCTIONS_PARAM_INVALID`。
- **原因**：CLI 自动建路由时，类型建成了 `SCF`（事件型），且「路径透传」默认是关的（`false`）。
- **解法**：改用 `tcb routes edit` 把两项都改对：

  ```bash
  printf 'y\n' | tcb routes edit -e <envId> --data '{"domain":"*","routes":[{"path":"/api/xxx","upstreamResourceType":"WEB_SCF","upstreamResourceName":"api","enablePathTransmission":true}]}'
  ```

- **为什么必须开「路径透传」**：不开的话函数收到的路径是被截断的，分发代码看不到 `/api/xxx`，没法判断走哪个分支。

### 4. 写接口报 `42501 permission denied for table skills`（Day 18）

- **症状**：读接口一切正常，一写库就返回 `code:2001`。
- **定位过程（值得记住）**：
  1. 先用**二分法**：拿一个**已存在**的技能名去请求，返回 `1005`（查重命中）→ 证明「读库、校验、分发」都好，问题精确锁定在 `insert` 这一句
  2. 临时在响应里加 `debug` 字段把数据库原始报错露出来 → 看到 `code=DATABASE_42501 ｜ permission denied for table skills`
  3. 定位后**立刻删掉** `debug` 字段（生产环境把数据库原文暴露给请求方是信息泄露）
- **原因**：**云函数是以「匿名（anon）身份」连数据库的**，平台默认只给 `SELECT`。所以「读得通、写不进」。
- **解法**：

  ```sql
  GRANT INSERT ON skills TO anon;
  ```

  只开插入，不开修改/删除（最小必要权限），随时可用 `REVOKE` 撤销。6ms 生效。
- **补记**：这条授权已写进 `db/schema.sql` 末尾，避免将来重建表后写接口**静默失效**（前端只会看到「服务暂时不可用」，极难查）。

### 5. 跨域翻车：响应头里 ACAO 出现两个值（Day 17）

- **症状**：页面能打开，但数据区是空的；Console 里红色报错 `Failed to fetch`，关键词 `Access-Control-Allow-Origin`。
- **排查**：F12 → Network 那条请求，**请求发出去了、服务端也返回了 200**，但浏览器拒绝把结果给页面。看 Response Headers 发现：

  ```
  access-control-allow-origin: https://xxx.tcloudbaseapp.com,*
  ```

- **原因**：网关**自带**跨域处理（回显 origin），而函数代码里**又写了一遍** `ACAO: *`，两者叠加成一个非法值。
- **解法**：**函数层撤掉一切跨域头**（包括 `OPTIONS` 预检分支），跨域全权交给网关。改完立刻恢复正常。
- **通用经验**：**「页面能打开、但数据是空的」+ 控制台提到 `Access-Control-Allow-Origin`= 几乎一定是跨域问题。** 定位方法就是打开 F12 看那条请求的响应头。

### 6. `tcb hosting deploy` 多参数 / 目录参数踩坑（Day 20）

- **症状 1**：`tcb hosting deploy a.html b.html c.html` 只传成功了第一个文件。
- **症状 2**：`tcb hosting deploy js css` 把 **js 目录下的内容传进了云端的 css 目录**，线上文件数从 17 涨到 23，多出 `css/analyze.js`、`css/app.js` 等 6 个错位文件。
- **原因**：该命令的参数语义是「`<本地路径> <云端路径>`」，**一次只处理一个本地路径**；只给一个参数时云端路径由 CLI 自己推断，给两个参数时第二个会被当作云端路径。
- **解法**：
  - 一次只传一个文件或一个目录
  - 传目录**必须显式给两个参数**：`tcb hosting deploy js js`
  - 传完用 `tcb hosting list --json` 核对线上文件清单，或 `curl | wc -c` 与本地逐字节比对
  - 清掉错位文件：`tcb hosting delete css/analyze.js -e <envId>`
- **幸运之处**：原 `js/*.js` 未被覆盖，页面引用路径也没变，所以线上功能全程正常（错位文件只是垃圾）。

### 7. 云函数日志看不到内容（Day 18 起）

- **症状**：`tcb fn log api` 报 `topic not exist`。
- **原因**：**免费体验版未开通日志服务**。
- **影响**：服务端日志代码（`logWrite`）照常执行，但拉不到内容。
- **替代手法**：排查时在响应里临时加 `debug` 字段露出原始报错（**定位完必须删掉**），或改用「二分法」缩小范围。

### 8. 未登记的路由由网关直接拦截（Day 19 发现）

- **现象**：请求 `/api/nope` 返回的是网关的 `{"code":"INVALID_PATH",...}`，而不是函数代码里定义的 `1004`。
- **原因**：网关只认已登记的路由，未登记的请求在网关就被拦下，**根本到不了函数**。
- **结论**：这是平台行为不是缺陷。也意味着「函数里的 404 分支」在线上测不到，本地测试脚手架里才能覆盖。

---

## 七、上线前自查清单

改动要推上线时，按这个顺序过一遍：

- [ ] 云函数部署成功（`tcb fn deploy api --httpFn --force`）
- [ ] 新接口路径已在网关注册，且类型是 `WEB_SCF`、路径透传是 `true`
- [ ] 静态托管文件已上传，且**线上与本地逐字节一致**
- [ ] 线上文件清单没有多余/错位文件（`tcb hosting list --json`）
- [ ] 三个接口实测：`/api/health`、`/api/jobs`、`/api/skills`
- [ ] 浏览器打开公网首页，数据正常显示（F12 无 CORS 报错）
- [ ] 数据库测试数据已清理，无残留
