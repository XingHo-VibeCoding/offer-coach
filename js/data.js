// offer-coach 数据底座（Day 7）
// 岗位与技能为多对多关系：jobs[].requiredSkills 与 skills[].relatedJobs 互相对应
// 字段含义见 PRD 第六节；学习阶段（stage）用于差距分析的「建议学习顺序」排序

const JOBS = [
  { name: "前端开发", intro: "做用户能看见、能点的网页界面", duty: "负责网页界面的实现与交互效果，把设计稿变成真正能用的页面。", requiredSkills: ["HTML/CSS", "JavaScript", "Vue 或 React", "TypeScript", "浏览器调试与性能", "Git", "HTTP 基础"] },
  { name: "后端开发", intro: "在服务器上写支撑业务运转的程序", duty: "负责服务器端逻辑、数据库设计和接口开发，处理前端传来的请求并返回数据。", requiredSkills: ["Python", "Java", "Spring Boot", "SQL / MySQL", "API 设计（REST）", "Redis 缓存", "Docker 容器", "Linux 基础", "Git", "HTTP 基础"] },
  { name: "测试工程师", intro: "专门给软件「找茬」，保证质量", duty: "设计测试用例、执行功能与接口测试，在软件交给用户前尽可能找出问题。", requiredSkills: ["测试理论与用例设计", "Python", "SQL / MySQL", "接口测试（Postman 等）", "自动化测试（Selenium 等）", "Linux 基础", "Git"] },
  { name: "数据分析", intro: "从数据里找出业务问题的答案", duty: "提取、清洗、分析业务数据，做成报表和结论，帮助团队做决策。", requiredSkills: ["SQL / MySQL", "Python", "pandas 数据处理", "Excel 数据处理", "统计学基础", "数据可视化（Tableau 等）"] },
  { name: "运维工程师", intro: "让网站和服务器稳定运行不出事", duty: "负责服务器部署、监控告警和故障处理，保障线上服务全天候可用。", requiredSkills: ["Linux 基础", "网络基础（TCP/IP）", "Shell 脚本", "Docker 容器", "Kubernetes", "监控与日志（Prometheus 等）", "云平台基础"] },
  { name: "网络安全工程师", intro: "防守系统，防黑客找漏洞", duty: "检查系统漏洞、做渗透测试、加固防护策略，抵御网络攻击。", requiredSkills: ["网络基础（TCP/IP）", "HTTP 基础", "Linux 基础", "Python", "Shell 脚本", "渗透测试基础", "加密与认证基础"] },
  { name: "AI 应用工程师", intro: "把大模型能力接进真实产品里", duty: "调用和微调 AI 模型，开发智能应用（如智能客服、内容生成工具）。", requiredSkills: ["Python", "统计学基础", "pandas 数据处理", "机器学习基础", "深度学习基础", "大模型应用开发（LLM API / 提示词工程）", "Git"] },
  { name: "嵌入式工程师", intro: "给智能硬件写「大脑」里的程序", duty: "开发运行在硬件设备（家电、汽车、机器人等）内部的软件，让设备按预期工作。", requiredSkills: ["C 语言", "电路基础", "单片机开发（STM32 / Arduino）", "嵌入式操作系统（RTOS / 嵌入式 Linux）", "串口与总线协议", "网络基础（TCP/IP）", "Linux 基础"] }
];

const SKILLS = [
  // —— 基础阶段 ——
  { name: "HTML/CSS", category: "语言", stage: "基础", note: "网页的骨架和皮肤：结构靠 HTML，样式靠 CSS", aliases: ["HTML", "CSS", "网页布局", "HTML5", "CSS3"], relatedJobs: ["前端开发"] },
  { name: "JavaScript", category: "语言", stage: "基础", note: "让网页动起来的编程语言", aliases: ["JS", "ES6"], relatedJobs: ["前端开发"] },
  { name: "Git", category: "工具", stage: "基础", note: "代码存档与协作工具，给代码做「存档点」", aliases: ["版本控制", "GitHub"], relatedJobs: ["前端开发", "后端开发", "测试工程师", "AI 应用工程师"] },
  { name: "HTTP 基础", category: "其他", stage: "基础", note: "浏览器和服务器之间对话的规则", aliases: ["HTTP", "HTTP 协议", "网络请求", "HTTPS"], relatedJobs: ["前端开发", "后端开发", "网络安全工程师"] },
  { name: "网络基础（TCP/IP）", category: "其他", stage: "基础", note: "数据在网络里怎么传输的基础原理", aliases: ["TCP/IP", "计算机网络", "网络协议"], relatedJobs: ["运维工程师", "网络安全工程师", "嵌入式工程师"] },
  { name: "Python", category: "语言", stage: "基础", note: "语法最友好的通用编程语言，五个岗位都在用", aliases: ["Python3"], relatedJobs: ["后端开发", "测试工程师", "数据分析", "网络安全工程师", "AI 应用工程师"] },
  { name: "SQL / MySQL", category: "语言", stage: "基础", note: "和数据库对话的语言，增删查改数据全靠它", aliases: ["SQL", "MySQL", "数据库", "结构化查询"], relatedJobs: ["后端开发", "测试工程师", "数据分析"] },
  { name: "Linux 基础", category: "工具", stage: "基础", note: "服务器上最常用的操作系统，命令行是基本功", aliases: ["Linux", "Linux 命令", "Shell 命令"], relatedJobs: ["后端开发", "测试工程师", "运维工程师", "网络安全工程师", "嵌入式工程师"] },
  { name: "Excel 数据处理", category: "工具", stage: "基础", note: "表格工具：筛选、透视表、基础函数", aliases: ["Excel", "表格处理", "透视表"], relatedJobs: ["数据分析"] },
  { name: "统计学基础", category: "其他", stage: "基础", note: "均值、分布、显著性——数据结论靠谱与否的底线", aliases: ["统计", "统计学", "概率统计"], relatedJobs: ["数据分析", "AI 应用工程师"] },
  { name: "C 语言", category: "语言", stage: "基础", note: "贴近硬件的经典语言，嵌入式的敲门砖", aliases: ["C", "C语言"], relatedJobs: ["嵌入式工程师"] },
  { name: "电路基础", category: "其他", stage: "基础", note: "电压、电流、元器件——看懂硬件图纸的门槛", aliases: ["电路", "电子电路", "模电数电"], relatedJobs: ["嵌入式工程师"] },
  { name: "测试理论与用例设计", category: "其他", stage: "基础", note: "怎么设计测试场景，才能把问题提前挖出来", aliases: ["测试用例", "软件测试基础", "测试方法"], relatedJobs: ["测试工程师"] },
  // —— 进阶阶段 ——
  { name: "Vue 或 React", category: "框架", stage: "进阶", note: "两大主流前端框架，会一个就能干活", aliases: ["Vue", "React", "前端框架", "Vue3"], relatedJobs: ["前端开发"] },
  { name: "TypeScript", category: "语言", stage: "进阶", note: "JavaScript 的强化版，大项目里更稳", aliases: ["TS"], relatedJobs: ["前端开发"] },
  { name: "浏览器调试与性能", category: "工具", stage: "进阶", note: "用开发者工具查问题、优化加载速度", aliases: ["DevTools", "浏览器调试", "性能优化"], relatedJobs: ["前端开发"] },
  { name: "Java", category: "语言", stage: "进阶", note: "国内后端的主力语言之一", aliases: ["JavaSE"], relatedJobs: ["后端开发"] },
  { name: "Spring Boot", category: "框架", stage: "进阶", note: "Java 后端最主流的开发框架", aliases: ["Spring", "SpringBoot"], relatedJobs: ["后端开发"] },
  { name: "API 设计（REST）", category: "其他", stage: "进阶", note: "设计前后端交接数据的接口规范", aliases: ["REST", "RESTful", "接口设计", "API"], relatedJobs: ["后端开发"] },
  { name: "Redis 缓存", category: "工具", stage: "进阶", note: "把常用数据放内存里，让读取快几个量级", aliases: ["Redis", "缓存"], relatedJobs: ["后端开发"] },
  { name: "Shell 脚本", category: "语言", stage: "进阶", note: "把重复的命令行操作写成脚本自动跑", aliases: ["Shell", "Bash"], relatedJobs: ["运维工程师", "网络安全工程师"] },
  { name: "Docker 容器", category: "工具", stage: "进阶", note: "把程序和它的环境打包带走，到哪都能跑", aliases: ["Docker", "容器", "容器化"], relatedJobs: ["后端开发", "运维工程师"] },
  { name: "接口测试（Postman 等）", category: "工具", stage: "进阶", note: "不打开页面，直接测数据接口对不对", aliases: ["Postman", "接口测试", "API 测试"], relatedJobs: ["测试工程师"] },
  { name: "自动化测试（Selenium 等）", category: "工具", stage: "进阶", note: "写代码代替人工点页面，重复测试自动跑", aliases: ["Selenium", "自动化测试", "UI 自动化"], relatedJobs: ["测试工程师"] },
  { name: "pandas 数据处理", category: "框架", stage: "进阶", note: "Python 处理表格数据的王牌库", aliases: ["pandas", "Pandas", "numpy"], relatedJobs: ["数据分析", "AI 应用工程师"] },
  { name: "数据可视化（Tableau 等）", category: "工具", stage: "进阶", note: "把数字变成一眼看懂的图表", aliases: ["Tableau", "PowerBI", "可视化", "图表"], relatedJobs: ["数据分析"] },
  { name: "监控与日志（Prometheus 等）", category: "工具", stage: "进阶", note: "给服务器装上「心电图」，出事前先知道", aliases: ["Prometheus", "Grafana", "监控", "日志分析"], relatedJobs: ["运维工程师"] },
  { name: "云平台基础", category: "工具", stage: "进阶", note: "阿里云、腾讯云、AWS 的基本使用与计费逻辑", aliases: ["云服务", "阿里云", "腾讯云", "AWS"], relatedJobs: ["运维工程师"] },
  { name: "渗透测试基础", category: "其他", stage: "进阶", note: "以攻击者视角找系统漏洞，找到先于黑客", aliases: ["渗透测试", "渗透", "漏洞挖掘"], relatedJobs: ["网络安全工程师"] },
  { name: "加密与认证基础", category: "其他", stage: "进阶", note: "密码怎么存、身份怎么验、传输怎么保密", aliases: ["加密", "认证", "加密算法", "身份认证"], relatedJobs: ["网络安全工程师"] },
  { name: "机器学习基础", category: "其他", stage: "进阶", note: "让程序从数据里自己学规律的入门学问", aliases: ["机器学习", "ML", "sklearn"], relatedJobs: ["AI 应用工程师"] },
  { name: "大模型应用开发（LLM API / 提示词工程）", category: "其他", stage: "进阶", note: "调用 GPT 类模型的能力，写好提示词做产品", aliases: ["LLM", "大模型", "提示词工程", "Prompt", "AIGC 应用"], relatedJobs: ["AI 应用工程师"] },
  { name: "单片机开发（STM32 / Arduino）", category: "工具", stage: "进阶", note: "在小小芯片上写程序控制硬件", aliases: ["STM32", "Arduino", "单片机", "MCU"], relatedJobs: ["嵌入式工程师"] },
  { name: "串口与总线协议", category: "其他", stage: "进阶", note: "芯片之间传数据的「交通规则」（UART/SPI/I2C）", aliases: ["UART", "SPI", "I2C", "串口通信"], relatedJobs: ["嵌入式工程师"] },
  // —— 高级阶段 ——
  { name: "Kubernetes", category: "工具", stage: "高级", note: "管理成百上千个容器的「容器舰队司令部」", aliases: ["K8s", "容器编排"], relatedJobs: ["运维工程师"] },
  { name: "深度学习基础", category: "其他", stage: "高级", note: "神经网络原理与训练，AI 应用进深的分水岭", aliases: ["深度学习", "神经网络", "PyTorch", "TensorFlow"], relatedJobs: ["AI 应用工程师"] },
  { name: "嵌入式操作系统（RTOS / 嵌入式 Linux）", category: "工具", stage: "高级", note: "让硬件同时干好几件事的实时操作系统", aliases: ["RTOS", "FreeRTOS", "嵌入式 Linux", "RT-Thread"], relatedJobs: ["嵌入式工程师"] }
];

// 供各页面直接引用（无构建工具，全局变量方式）
window.JOBS = JOBS;
window.SKILLS = SKILLS;
