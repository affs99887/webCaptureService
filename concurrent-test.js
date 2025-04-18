const axios = require("axios");

// 服务器配置
const SERVERS = {
  LOCAL: "http://localhost:3065",
  REMOTE: "http://222.68.19.101:24081",
};

// 选择要测试的服务器 (LOCAL 或 REMOTE)
const TEST_SERVER =
  process.argv[2]?.toUpperCase() === "REMOTE" ? "REMOTE" : "LOCAL";
const SERVER_BASE_URL = SERVERS[TEST_SERVER];

// 确定测试的端点 (pdf 或 screenshot)
const TEST_ENDPOINT =
  process.argv[3]?.toLowerCase() === "screenshot" ? "screenshot" : "pdf";
const SERVER_URL = `${SERVER_BASE_URL}/${TEST_ENDPOINT}`;

console.log(`测试服务器: ${TEST_SERVER} (${SERVER_BASE_URL})`);
console.log(`测试端点: ${TEST_ENDPOINT}`);

// 基本请求配置
const baseConfig = {
  url: "http://222.68.19.101:24081/pdf/?queryCode=202502100943061759499646",
  deviceName: "iPad Pro",
  width: "1240",
};

// 创建并发请求数量
const CONCURRENT_REQUESTS = process.argv[4] ? parseInt(process.argv[4]) : 20;

// 创建并发请求
async function runConcurrentRequests() {
  console.log(`开始发送${CONCURRENT_REQUESTS}个并发请求...`);

  const requests = [];
  const startTime = Date.now();

  // 创建请求
  for (let i = 1; i <= CONCURRENT_REQUESTS; i++) {
    const config = {
      ...baseConfig,
      filename: `测试_${TEST_ENDPOINT}_${i}`, // 为每个请求生成不同的文件名
    };

    // 根据不同端点可以添加不同的参数
    if (TEST_ENDPOINT === "screenshot") {
      // 截图特有的配置
      config.deviceName = i % 2 === 0 ? "iPhone X" : "iPad Pro";
    } else {
      // PDF特有的配置
      config.showPageNo = i % 2 === 0;
    }

    const request = axios
      .post(SERVER_URL, config)
      .then((response) => {
        const duration = Date.now() - startTime;
        console.log(
          `请求 ${i} 成功: ${
            response.data.fileName || response.data.requestId
          } (耗时: ${duration}ms)`
        );
        return { success: true, id: i, data: response.data, duration };
      })
      .catch((error) => {
        const duration = Date.now() - startTime;
        console.error(`请求 ${i} 失败 (耗时: ${duration}ms):`, error.message);
        return { success: false, id: i, error: error.message, duration };
      });

    requests.push(request);
  }

  // 等待所有请求完成
  try {
    const results = await Promise.all(requests);
    const totalDuration = Date.now() - startTime;

    // 统计成功和失败的请求
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // 计算平均响应时间
    const avgDuration =
      results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    console.log("\n测试结果汇总:");
    console.log(`总请求数: ${CONCURRENT_REQUESTS}`);
    console.log(`成功请求: ${successful}`);
    console.log(`失败请求: ${failed}`);
    console.log(`总耗时: ${totalDuration}ms`);
    console.log(`平均响应时间: ${avgDuration.toFixed(2)}ms`);

    // 显示最快和最慢的响应时间
    const sortedResults = [...results].sort((a, b) => a.duration - b.duration);
    console.log(
      `最快响应: ${sortedResults[0].duration}ms (请求 ${sortedResults[0].id})`
    );
    console.log(
      `最慢响应: ${sortedResults[sortedResults.length - 1].duration}ms (请求 ${
        sortedResults[sortedResults.length - 1].id
      })`
    );
  } catch (error) {
    console.error("执行并发测试时出错:", error);
  }
}

// 显示用法说明
console.log(
  "用法: node concurrent-test.js [local|remote] [pdf|screenshot] [并发数量]"
);
console.log("默认测试本地服务器的PDF端点，并发数量为20。\n");

// 运行测试
runConcurrentRequests();
