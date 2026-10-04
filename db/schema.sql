-- =============================================================================
-- offer-coach · 数据库表结构（schema.sql）
-- =============================================================================
-- 作用：定义第 3 周的两张核心表——jobs（岗位表）、skills（技能总表）
-- 依据：PRD.md 第六节「数据字段」+ api-contract.md 3.2「GET /api/jobs」响应结构
-- 配套：db/seed.sql（示例数据）；先跑本文件建结构，再跑 seed.sql 灌数据
-- 另含：末尾的 GRANT 语句（给匿名身份授 skills 表写权限）——重建数据库后写接口靠它才能用，
--       详见文件末尾「写入权限」一节
--
-- 执行方式（在项目根目录的终端里）：
--   tcb db execute -e offer-coach-d0ge7jkzfc47e2079 --sql "$(cat db/schema.sql)"
--
-- ⚠️ 本脚本是「先删后建」形式：每次执行都会先 DROP 掉两张表再重建。
--    · 开发阶段（Day 16-19）：可反复执行，随时推倒重来
--    · Day 20 上线之后：禁止执行！会清空真实数据；上线后一律改用增量 SQL
-- =============================================================================

-- 先删（顺序：先删被引用的 skills，再删 jobs；CASCADE 防止依赖残留）
DROP TABLE IF EXISTS skills CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;


-- -----------------------------------------------------------------------------
-- 表 1：jobs（岗位表）
-- 回答「站里有哪几个岗位、每个岗位干什么、要求哪些技能」
-- -----------------------------------------------------------------------------
CREATE TABLE jobs (
  id               SERIAL   PRIMARY KEY,           -- 内部编号，仅供数据库自己用，不对外暴露
  name             TEXT     NOT NULL UNIQUE,       -- 岗位名（业务唯一标识，也是与 skills 关联的字段）
  intro            TEXT     NOT NULL,              -- 一句话简介，首页卡片上显示
  duty             TEXT     NOT NULL,              -- 职责说明，详情页显示
  required_skills  TEXT[]   NOT NULL DEFAULT '{}'  -- 该岗位要求的技能名清单（存的是 skills.name）
);

COMMENT ON TABLE  jobs                   IS '岗位表：站内收录的岗位及其要求';
COMMENT ON COLUMN jobs.id                IS '内部编号（自增主键），不对外暴露';
COMMENT ON COLUMN jobs.name              IS '岗位名，业务唯一标识；与 skills.related_jobs 中的值对应';
COMMENT ON COLUMN jobs.intro             IS '一句话简介，显示在首页岗位卡片上';
COMMENT ON COLUMN jobs.duty              IS '职责说明，显示在岗位详情页';
COMMENT ON COLUMN jobs.required_skills   IS '该岗位要求的技能名数组，元素取值来自 skills.name（多对多的正向）';


-- -----------------------------------------------------------------------------
-- 表 2：skills（技能总表）
-- 回答「网站认识哪些技能、每个技能什么来头、被哪些岗位要求」
-- -----------------------------------------------------------------------------
CREATE TABLE skills (
  id            SERIAL  PRIMARY KEY,                                -- 内部编号，不对外暴露
  name          TEXT    NOT NULL UNIQUE,                            -- 技能名（业务唯一标识）
  category      TEXT    NOT NULL CHECK (category IN ('语言','框架','工具','其他')),  -- 分类
  stage         TEXT    NOT NULL CHECK (stage IN ('基础','进阶','高级')),            -- 学习阶段（用于「建议学习顺序」排序）
  note          TEXT    NOT NULL,                                   -- 一句话说明（零基础能懂）
  aliases       TEXT[]  NOT NULL DEFAULT '{}',                      -- 别名数组（用于识别岗位描述里的不同说法）
  related_jobs  TEXT[]  NOT NULL DEFAULT '{}',                      -- 该技能被哪些岗位要求（存的是 jobs.name，多对多的反向）
  source        TEXT    NOT NULL DEFAULT '预设' CHECK (source IN ('预设','用户自定义'))  -- 数据来源
);

COMMENT ON TABLE  skills               IS '技能总表：网站认识的全部技能';
COMMENT ON COLUMN skills.id            IS '内部编号（自增主键），不对外暴露';
COMMENT ON COLUMN skills.name          IS '技能名，业务唯一标识；与 jobs.required_skills 中的值对应';
COMMENT ON COLUMN skills.category      IS '分类，仅可取：语言 / 框架 / 工具 / 其他';
COMMENT ON COLUMN skills.stage         IS '学习阶段，仅可取：基础 / 进阶 / 高级（差距分析据此排「建议学习顺序」）';
COMMENT ON COLUMN skills.note          IS '一句话说明，零基础也能看懂';
COMMENT ON COLUMN skills.aliases       IS '别名数组，用于从岗位描述里识别同一技能的不同写法（如 JavaScript 的别名 JS、ES6）';
COMMENT ON COLUMN skills.related_jobs  IS '要求该技能的岗位名数组，元素取值来自 jobs.name（多对多的反向）';
COMMENT ON COLUMN skills.source        IS '数据来源，仅可取：预设 / 用户自定义';


-- -----------------------------------------------------------------------------
-- 写入权限：让云函数能往 skills 表里写（Day 18 授权，Day 22 扩权）
-- -----------------------------------------------------------------------------
-- ⚠️ 这一条不是可选项，漏了写接口会静默失效，务必保留。
--
-- 背景：CloudBase 的云函数是以**匿名身份（anon）**连数据库的，平台默认只给 SELECT。
--       所以 Day 18 的写接口 POST /api/skills 首次上线时直接报
--       code=2001，数据库原文是：permission denied for table skills（PG 错误码 42501）。
--
-- 授权范围随接口一起长：
--   · Day 18 只有「新增」接口           → 授 INSERT
--   · Day 22 加了「修改」「删除」接口     → 追加 UPDATE、DELETE（PATCH / DELETE /api/skills）
-- 权限只开给 skills 表，jobs 表保持只读（本期没有改岗位的接口）。
-- 「预设技能禁止改删」由接口层的业务校验（source 判定 → code:1006）保证，
-- 不靠数据库权限——因为同一张表里既有预设数据也有自定义数据，权限是表级的，分不开。
-- 为什么不需要授序列权限：skills.id 是 SERIAL，插入时会用到 skills_id_seq；
--                   实测 anon 对这个序列**已有** USAGE 权限，无需额外授权。
--                   若换了环境后报「序列权限不足」，补一句：
--                   GRANT USAGE ON SEQUENCE skills_id_seq TO anon;
-- 怎么撤销：REVOKE INSERT, UPDATE, DELETE ON skills FROM anon;
-- -----------------------------------------------------------------------------
GRANT INSERT, UPDATE, DELETE ON skills TO anon;


-- -----------------------------------------------------------------------------
-- 两张表怎么关联（本次数据模型的核心）
-- -----------------------------------------------------------------------------
-- 关联字段 = 技能名 / 岗位名（两个方向各存一份）：
--   · jobs.required_skills  = ['HTML/CSS', 'JavaScript', ...]   → 岗位要求哪些技能
--   · skills.related_jobs   = ['前端开发', '测试开发']           → 技能被哪些岗位要求
-- 名字对上，关系成立。这是「两张表 + 名字关联」方案（不用第三张中间表）：
-- 本项目的用法只需「按岗位列技能」这一个方向，一次 SELECT 即可取全，
-- 无需 JOIN，也就不需要中间表。
-- =============================================================================
