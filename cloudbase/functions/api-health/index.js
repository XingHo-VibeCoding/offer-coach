// offer-coach 云函数：健康检查 /api/health —— Day 15 板块②
// 形态：HTTP 函数（CloudBase 新平台模板形态：Node.js 内置 http 模块起一个常驻服务，监听 9000 端口）
// 职责：任何路径的请求都返回一段固定结构的 JSON，用来验证「云函数已部署 + 公网可访问」。
// 今天刻意不连数据库、不写业务逻辑——真实业务接口从 Day 16 开始写。

const http = require("http");

const SERVICE = "offer-coach-api";
const VERSION = "0.1.0";
const PORT = process.env.PORT || 9000;

const server = http.createServer(function (req, res) {
  var payload = {
    status: "ok",
    service: SERVICE,
    version: VERSION,
    env: process.env.TCB_ENV || "unknown", // TCB_ENV 是平台注入的环境 ID
    time: new Date().toISOString()
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
});

server.listen(PORT, function () {
  console.log("api-health listening on port " + PORT);
});
