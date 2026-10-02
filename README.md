# offer-coach

帮求职者把「岗位要求」和「我的学习进度」放在一起对比，看清差距在哪、先学什么的求职差距分析工具。

> 本项目是 28 天 vibe-coding 课程的实践作品，已上线公网：https://offer-coach-d0ge7jkzfc47e2079-1496995497.tcloudbaseapp.com/

## 功能

| 页面 | 功能 |
|---|---|
| 首页 | 浏览 8 个技术方向岗位（前端 / 后端 / 测试 / 数据分析 / 运维 / 网络安全 / AI 应用 / 嵌入式） |
| 岗位详情 | 查看岗位职责与技能清单，勾选自己已掌握的技能（自动保存） |
| 我的进度 | 汇总已掌握技能；添加 / 删除自定义技能（总表里没有的） |
| 差距分析 | 两种入口：选预设岗位，或直接粘贴一段岗位描述（JD）；输出三栏结果——已达标 / 缺口 / 建议学习顺序（缺口按基础 → 进阶 → 高级排序） |

## 本地运行

不需要安装任何依赖，两步：

1. 在项目根目录启动一个静态服务器（任选其一）：

   ```bash
   python -m http.server 8000
   ```

2. 浏览器打开 `http://localhost:8000`

> ⚠️ 不要直接双击 HTML 文件打开：部分页面依赖 `?job=岗位名` 参数，且建议统一走 localhost 访问。

## 技术说明

- **前端 + 云函数 + 云数据库**：页面部署在 CloudBase 静态托管，数据经云函数从 PostgreSQL 读取；无账号体系
- **技能总表 + 多对多**：技能存在数据库 `skills` 表（预设 37 项，另有用户自定义若干），每个技能含分类、学习阶段、别名、关联岗位；一个技能可服务多个岗位。预设与自定义内容用 `source` 字段区分
- **用户进度仍在浏览器本地**：勾选进度与自定义技能暂存 localStorage（键名 `oc_progress` / `oc_custom_skills`），尚未上云
- **差距分析 = 关键词匹配**：把 JD 文字与技能名（含别名）做对照，命中即识别；逻辑独立在 `js/analyze.js`，便于未来替换为 AI 分析
- **云函数分层**：`index.js` 只管接口（校验参数、拼响应、分发路径），`db.js` 是唯一碰数据库的数据访问层。详见 [TECH_DESIGN.md](TECH_DESIGN.md) 2.2 节

## 目录结构

```
├── index.html          # 首页（岗位卡片）
├── job.html            # 岗位详情页（需 ?job=参数）
├── profile.html        # 我的进度页
├── analyze.html        # 差距分析页
├── css/style.css       # 全部样式
├── js/
│   ├── data.js         # 数据加载器：启动时请求 /api/jobs，把结果放进 window.JOBS / window.SKILLS
│   ├── storage.js      # OCStorage：localStorage 唯一读写出口
│   ├── app.js          # 首页渲染
│   ├── job.js          # 详情页勾选与保存
│   ├── profile.js      # 进度汇总 + 自定义技能
│   └── analyze.js      # 差距分析（逻辑层 AnalyzeLogic + 页面渲染）
├── cloudbase/functions/
│   ├── api/            # 主云函数：index.js（接口层）+ db.js（数据访问层）
│   └── api-health/     # Day 15 的健康检查函数（/api/health 路由指向它）
└── db/
    ├── schema.sql      # 建表脚本（开发期；含 GRANT 授权，保证重建后写接口可用）
    └── seed.sql        # 示例数据（8 岗位 + 37 技能）
```

**部署状态**：页面在 CloudBase 静态托管，云函数 + 数据库在 ap-shanghai。部署命令与踩坑记录见 [DEPLOY-NOTES.md](DEPLOY-NOTES.md)。

## 已知限制

- JD 里出现总表没有收录的技能时无法自动识别（关键词匹配的原理限制），可用「自定义技能」手工补充
- **用户进度仍只存在当前浏览器里**，换设备 / 清浏览器缓存会丢失（岗位与技能数据已上云，这部分不受影响）
- 岗位与技能内容是人工收录的，不来自实时招聘网站
- GitHub Pages 上那份部署（`https://xingho-vibecoding.github.io/offer-coach/`）因域名不在 CloudBase 跨域白名单、免费版无法添加，**请求不到接口**；演示请用 CloudBase 静态托管域名

## 升级计划

- **用户进度上云**：把 `storage.js` 的读写出口从 localStorage 换成接口，其余代码不动（依赖账号体系，更远期）
- **差距分析升级为大模型识别**：换掉 `js/analyze.js` 的关键词匹配，届时表外技能也能自动认出
- **放宽跨域限制**：升级套餐后可把 GitHub Pages 域名加入白名单，届时两个地址都能用

## 相关文档

产品需求见 [PRD.md](PRD.md)，技术选型与架构见 [TECH_DESIGN.md](TECH_DESIGN.md)，接口契约见 [api-contract.md](api-contract.md)，部署与跨域备忘见 [DEPLOY-NOTES.md](DEPLOY-NOTES.md)，竞品调研见 [research.md](research.md)，协作规则见 [AGENTS.md](AGENTS.md)。
