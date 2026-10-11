-- =============================================================================
-- offer-coach · 增量迁移：Day 29 扩充技能总表（37 → 47）
-- =============================================================================
-- 背景：Day 29 用真实 JD 实测，发现「关键词匹配」漏识别率高达 91%
--       （Nginx / Kafka / Jenkins / Webpack 这类常见词全认不出）。
--       用户在「不接 AI」的前提下选择「补总表 + 别名」方案。
--
-- 本脚本做什么：
--   1. 放宽 category 约束，新增「产品」分类
--   2. 新增 10 条技能（7 项技术 + 3 项产品）
--   3. 给已有岗位补 required_skills（新技能要跟岗位挂上）
--   4. 给已有技能补别名（把漏词里的同义词补进去）
--
-- ⚠️ 为什么不用 seed.sql：
--    seed.sql 是「先 TRUNCATE 再灌」的开发期脚本，Day 20 上线后禁用
--    （会清空真实数据，含用户自定义技能）。本脚本只做 INSERT / UPDATE，不动存量数据。
--
-- ✅ 幂等性：本脚本可重复执行（新技能用 WHERE NOT EXISTS 防重、别名用数组去重）
--
-- 执行方式（在项目根目录的终端里）：
--   tcb db execute -e offer-coach-d0ge7jkzfc47e2079 --sql "$(cat db/migrations/2026-10-11-add-skills.sql)"
--
-- 执行前建议：先做一次备份（参考 db/export-data.js），万一要回退还来得及
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 第 1 步：放宽 category 约束，允许「产品」
-- -----------------------------------------------------------------------------
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_category_check;
ALTER TABLE skills ADD  CONSTRAINT skills_category_check
  CHECK (category IN ('语言','框架','工具','其他','产品'));

COMMENT ON COLUMN skills.category IS '分类，仅可取：语言 / 框架 / 工具 / 其他 / 产品（产品类 = 产品、设计、项目管理方向的工具）';


-- -----------------------------------------------------------------------------
-- 第 2 步：新增 10 条技能（WHERE NOT EXISTS 防重复执行时报「已存在」）
-- -----------------------------------------------------------------------------
INSERT INTO skills (name, category, stage, note, aliases, related_jobs)
SELECT * FROM (VALUES
  ('Nginx', '工具', '进阶', '高性能的 Web 服务器，常用来做反向代理和负载均衡',
   ARRAY['反向代理', 'Web 服务器', '负载均衡', 'Nginx 配置']::text[], ARRAY['后端开发', '运维工程师']::text[]),
  ('消息队列', '工具', '进阶', '让程序之间「异步传话」的中间件，削峰填谷、解耦系统',
   ARRAY['Kafka', 'RabbitMQ', 'MQ', '消息中间件', 'RocketMQ']::text[], ARRAY['后端开发']::text[]),
  ('微服务架构', '框架', '高级', '把一个大系统拆成多个小服务，各自独立开发部署',
   ARRAY['Spring Cloud', '微服务', '服务治理', '分布式', '微服务架构']::text[], ARRAY['后端开发']::text[]),
  ('CI/CD', '工具', '进阶', '代码提交后自动构建、测试、部署的流水线',
   ARRAY['Jenkins', 'GitLab CI', '持续集成', '持续部署', '流水线', 'CICD']::text[], ARRAY['运维工程师', '测试工程师']::text[]),
  ('前端构建工具', '工具', '进阶', '把源码打包压缩成浏览器能高效运行的文件',
   ARRAY['Webpack', 'Vite', '构建工具', '前端工程化', '打包工具', 'Rollup']::text[], ARRAY['前端开发']::text[]),
  ('性能测试', '工具', '进阶', '模拟大量用户同时访问，看系统扛不扛得住',
   ARRAY['JMeter', '压力测试', '性能测试', 'LoadRunner', 'QPS', '并发测试']::text[], ARRAY['测试工程师', '运维工程师']::text[]),
  ('数据仓库', '工具', '高级', '专门存海量历史数据、供分析用的数据库',
   ARRAY['Hive', '数据仓库', '数仓', 'ETL', '数据建模', '离线数仓']::text[], ARRAY['数据分析']::text[]),
  ('原型设计工具', '产品', '基础', '把产品想法画成可点击原型图的工具',
   ARRAY['Axure', '墨刀', '原型图', '原型设计', '线框图']::text[], ARRAY[]::text[]),
  ('设计协作工具', '产品', '基础', '团队一起做界面设计、标注切图的在线工具',
   ARRAY['Figma', 'Sketch', '蓝湖', '设计稿', '切图']::text[], ARRAY['前端开发']::text[]),
  ('项目管理工具', '产品', '基础', '跟踪任务进度、协作排期的工具',
   ARRAY['Jira', '禅道', 'TAPD', '项目管理', '需求管理']::text[], ARRAY[]::text[])
) AS v(name, category, stage, note, aliases, related_jobs)
WHERE NOT EXISTS (SELECT 1 FROM skills s WHERE s.name = v.name);


-- -----------------------------------------------------------------------------
-- 第 3 步：给已有岗位补 required_skills
--   用「不存在才追加」的写法，避免重复执行时同一技能被加两次
-- -----------------------------------------------------------------------------
UPDATE jobs SET required_skills = array_append(required_skills, '前端构建工具')
  WHERE name = '前端开发' AND NOT ('前端构建工具' = ANY(required_skills));

UPDATE jobs SET required_skills = array_append(required_skills, '消息队列')
  WHERE name = '后端开发' AND NOT ('消息队列' = ANY(required_skills));
UPDATE jobs SET required_skills = array_append(required_skills, '微服务架构')
  WHERE name = '后端开发' AND NOT ('微服务架构' = ANY(required_skills));
UPDATE jobs SET required_skills = array_append(required_skills, 'Nginx')
  WHERE name = '后端开发' AND NOT ('Nginx' = ANY(required_skills));

UPDATE jobs SET required_skills = array_append(required_skills, '性能测试')
  WHERE name = '测试工程师' AND NOT ('性能测试' = ANY(required_skills));
UPDATE jobs SET required_skills = array_append(required_skills, 'CI/CD')
  WHERE name = '测试工程师' AND NOT ('CI/CD' = ANY(required_skills));

UPDATE jobs SET required_skills = array_append(required_skills, '数据仓库')
  WHERE name = '数据分析' AND NOT ('数据仓库' = ANY(required_skills));

UPDATE jobs SET required_skills = array_append(required_skills, 'Nginx')
  WHERE name = '运维工程师' AND NOT ('Nginx' = ANY(required_skills));
UPDATE jobs SET required_skills = array_append(required_skills, 'CI/CD')
  WHERE name = '运维工程师' AND NOT ('CI/CD' = ANY(required_skills));
UPDATE jobs SET required_skills = array_append(required_skills, '性能测试')
  WHERE name = '运维工程师' AND NOT ('性能测试' = ANY(required_skills));


-- -----------------------------------------------------------------------------
-- 第 4 步：给已有技能补别名（同义词，不是新增技能）
-- -----------------------------------------------------------------------------
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['响应式布局','移动端适配','H5']::text[]))
  WHERE name = 'HTML/CSS';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['SQL 优化','SQL语句']::text[]))
  WHERE name = 'SQL / MySQL';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['渲染原理','前端性能']::text[]))
  WHERE name = '浏览器调试与性能';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['Power BI','BI','看板']::text[]))
  WHERE name = '数据可视化（Tableau 等）';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['A/B 测试','AB 测试','AB测试']::text[]))
  WHERE name = '统计学基础';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['公有云','云计算','Tomcat','中间件']::text[]))
  WHERE name = '云平台基础';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['接口联调']::text[]))
  WHERE name = '接口测试（Postman 等）';
UPDATE skills SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['Pytest','pytest']::text[]))
  WHERE name = '自动化测试（Selenium 等）';


-- -----------------------------------------------------------------------------
-- 执行后自检：应看到 skills=47（若库里原本有用户自定义技能，则会更多）
-- -----------------------------------------------------------------------------
SELECT 'jobs' AS table_name, count(*) AS rows FROM jobs
UNION ALL
SELECT 'skills_total', count(*) FROM skills
UNION ALL
SELECT 'skills_preset', count(*) FROM skills WHERE source = '预设'
UNION ALL
SELECT 'skills_product', count(*) FROM skills WHERE category = '产品';
