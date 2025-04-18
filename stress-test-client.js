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
const SERVER_URL = `${SERVER_BASE_URL}/stress-test`;

// 确定测试的端点 (pdf 或 screenshot)
const TEST_ENDPOINT =
  process.argv[3]?.toLowerCase() === "screenshot" ? "screenshot" : "pdf";

// 自定义测试URL (可选)
const TEST_URL = process.argv[4] || null;

// 是否强制集群切换
const FORCE_CLUSTER_SWITCH = process.argv[5]?.toLowerCase() === "switch";

// 自定义延迟时间 (可选)
const DELAY = process.argv[6] ? parseInt(process.argv[6]) : 5000;

// 监控间隔
const MONITOR_INTERVAL = 2000;

console.log(`=== 并发压力测试客户端 (增强版) ===`);
console.log(`测试服务器: ${TEST_SERVER} (${SERVER_BASE_URL})`);
console.log(`测试端点: ${TEST_ENDPOINT}`);
console.log(`波次间延迟: ${DELAY}ms`);
console.log(`强制集群切换: ${FORCE_CLUSTER_SWITCH ? "是" : "否"}`);
console.log(`集群状态监控间隔: ${MONITOR_INTERVAL}ms`);
console.log(`测试URL: ${TEST_URL || "使用默认URL"}`);
console.log(`==============================`);

function formatMemory(mb) {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb} MB`;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
}

function formatClusterStatus(status) {
  const memory = status.memory;
  const cluster = status.cluster;

  return {
    内存状态: {
      系统内存使用率: `${memory.usagePercent}%`,
      系统内存: `${formatMemory(memory.systemUsed)}/${formatMemory(
        memory.systemTotal
      )}`,
      堆内存: `${formatMemory(memory.heapUsed)}/${formatMemory(
        memory.heapTotal
      )}`,
      RSS: formatMemory(memory.rss),
    },
    集群状态: {
      当前集群: cluster.hasCurrentCluster ? "存在" : "不存在",
      备用集群: cluster.hasStandbyCluster ? "存在" : "不存在",
      正在切换: cluster.isClusterSwitching ? "是" : "否",
      活跃请求数: cluster.activeRequests,
      上次切换时间: formatTimestamp(cluster.lastSwitchTime),
      距上次切换: formatDuration(cluster.timeSinceLastSwitch),
      冷却期内: cluster.isInCooldownPeriod
        ? `是(剩余${cluster.cooldownRemainingSeconds}秒)`
        : "否",
    },
  };
}

// 检查服务器是否支持压力测试端点
async function checkTestEndpointAvailability() {
  try {
    // 发送OPTIONS请求检查端点是否存在
    await axios.options(SERVER_URL);
    return true;
  } catch (error) {
    if (error.response) {
      // 如果返回404，说明端点不存在
      if (error.response.status === 404) {
        return false;
      }
      // 其他HTTP错误码可能意味着端点存在但有其他问题
      return true;
    }
    // 连接错误可能是服务器不可达
    console.error(`无法连接到服务器 ${SERVER_BASE_URL}，请检查服务器是否运行`);
    return false;
  }
}

async function runStressTest() {
  console.log("\n开始执行并发压力测试...");

  // 首先检查端点是否可用
  console.log("检查服务器是否支持压力测试端点...");
  const isEndpointAvailable = await checkTestEndpointAvailability();

  if (!isEndpointAvailable) {
    console.error("\n错误: 压力测试端点不可用！");
    console.error("可能的原因:");
    console.error("1. 服务器未使用 NODE_ENV=test 启动");
    console.error("2. 服务器未包含压力测试端点");
    console.error("\n请尝试以下解决方案:");
    console.error("- 使用 'npm run start:test' 启动测试版本服务器");
    console.error("- 或使用 'cross-env NODE_ENV=test npm start' 启动服务器");
    console.error("- 如果是已编译的版本，请使用 'build:test' 命令重新构建");
    return;
  }

  console.log("压力测试端点可用，继续测试...");
  console.log("这将执行两波次的测试，第一波20个并发请求，第二波50个并发请求");
  if (FORCE_CLUSTER_SWITCH) {
    console.log("将在两波测试之间尝试强制切换集群");
  }
  console.log("整个测试可能需要几分钟时间，请耐心等待...\n");

  try {
    const startTime = Date.now();
    console.log(`发送请求: ${SERVER_URL}`);

    const response = await axios.post(SERVER_URL, {
      endpoint: TEST_ENDPOINT,
      testUrl: TEST_URL,
      delay: DELAY,
      forceClusterSwitch: FORCE_CLUSTER_SWITCH,
      monitorInterval: MONITOR_INTERVAL,
    });

    const totalDuration = Date.now() - startTime;
    const results = response.data.results;

    console.log("\n=== 压力测试完成 ===");
    console.log(`总耗时: ${formatDuration(totalDuration)}`);

    console.log("\n=== 总体统计 ===");
    console.log(`总请求数: ${results.summary.totalRequests}`);
    console.log(`成功请求: ${results.summary.totalSuccessful}`);
    console.log(`失败请求: ${results.summary.totalFailed}`);
    console.log(`成功率: ${results.summary.successRate}`);
    console.log(`总耗时: ${formatDuration(results.summary.totalDuration)}`);

    console.log("\n=== 第一波测试 (20个并发) ===");
    console.log(`总请求数: ${results.wave1.totalRequests}`);
    console.log(`成功请求: ${results.wave1.successful}`);
    console.log(`失败请求: ${results.wave1.failed}`);
    console.log(`成功率: ${results.wave1.successRate}`);
    console.log(`总耗时: ${formatDuration(results.wave1.totalDuration)}`);
    console.log(`平均响应时间: ${results.wave1.avgDuration}ms`);
    console.log(
      `最快响应: ${results.wave1.fastest.duration}ms (请求 ${results.wave1.fastest.id})`
    );
    console.log(
      `最慢响应: ${results.wave1.slowest.duration}ms (请求 ${results.wave1.slowest.id})`
    );

    console.log("\n=== 第二波测试 (50个并发) ===");
    console.log(`总请求数: ${results.wave2.totalRequests}`);
    console.log(`成功请求: ${results.wave2.successful}`);
    console.log(`失败请求: ${results.wave2.failed}`);
    console.log(`成功率: ${results.wave2.successRate}`);
    console.log(`总耗时: ${formatDuration(results.wave2.totalDuration)}`);
    console.log(`平均响应时间: ${results.wave2.avgDuration}ms`);
    console.log(
      `最快响应: ${results.wave2.fastest.duration}ms (请求 ${results.wave2.fastest.id})`
    );
    console.log(
      `最慢响应: ${results.wave2.slowest.duration}ms (请求 ${results.wave2.slowest.id})`
    );

    // 显示集群状态分析
    console.log("\n=== 集群状态分析 ===");
    const analysis = results.clusterStatus.analysis;
    console.log(`状态记录数: ${analysis.statusRecordCount}`);
    console.log(
      `内存峰值: 系统(${analysis.memoryPeaks.systemMemory}%), 堆(${analysis.memoryPeaks.heapMemory}MB)`
    );
    console.log(`活跃请求峰值: ${analysis.activeRequestsPeak}`);

    // 显示集群状态变化
    console.log("\n=== 集群状态变化 ===");
    console.log("初始状态:");
    console.log(
      JSON.stringify(
        formatClusterStatus(analysis.initialStatus.status),
        null,
        2
      )
    );

    console.log("\n最终状态:");
    console.log(
      JSON.stringify(formatClusterStatus(analysis.finalStatus.status), null, 2)
    );

    // 如果有集群切换事件，显示详情
    if (
      analysis.clusterSwitchEvents &&
      analysis.clusterSwitchEvents.length > 0
    ) {
      console.log("\n=== 集群切换事件 ===");
      analysis.clusterSwitchEvents.forEach((event, index) => {
        console.log(`\n事件 #${index + 1}:`);
        console.log(`时间: ${formatTimestamp(event.timestamp)}`);
        console.log(`阶段: ${event.phase}`);
        if (event.switchSuccess !== undefined) {
          console.log(`切换成功: ${event.switchSuccess ? "是" : "否"}`);
        }
        if (event.bypassedCooldown !== undefined) {
          console.log(`绕过冷却期: ${event.bypassedCooldown ? "是" : "否"}`);
        }
        console.log("集群状态:");
        console.log(JSON.stringify(formatClusterStatus(event.status), null, 2));
      });
    } else {
      console.log("\n未检测到集群切换事件");
    }

    // 如果有失败的请求，显示失败数据
    const wave1Failed = results.wave1.detailedResults.filter((r) => !r.success);
    const wave2Failed = results.wave2.detailedResults.filter((r) => !r.success);

    if (wave1Failed.length > 0 || wave2Failed.length > 0) {
      console.log("\n=== 失败请求详情 ===");

      if (wave1Failed.length > 0) {
        console.log(`\n第一波失败请求 (${wave1Failed.length}个):`);
        wave1Failed.forEach((req) => {
          console.log(
            `- 请求 ${req.id}: ${req.error} (耗时: ${req.duration}ms)`
          );
        });
      }

      if (wave2Failed.length > 0) {
        console.log(`\n第二波失败请求 (${wave2Failed.length}个):`);
        wave2Failed.forEach((req) => {
          console.log(
            `- 请求 ${req.id}: ${req.error} (耗时: ${req.duration}ms)`
          );
        });
      }
    }

    console.log("\n=== 测试完成 ===");
  } catch (error) {
    console.error("\n执行压力测试时出错:");
    if (error.response) {
      console.error(`状态码: ${error.response.status}`);
      if (error.response.status === 404) {
        console.error("错误: 压力测试端点不存在");
        console.error("请确保使用 NODE_ENV=test 启动服务器");
      } else {
        console.error(`错误消息: ${error.response.data.message || "未知错误"}`);
        console.error(`请求ID: ${error.response.data.requestId || "未知"}`);
      }
    } else if (error.code === "ECONNREFUSED") {
      console.error(`无法连接到服务器 ${SERVER_BASE_URL}`);
      console.error("请确保服务器正在运行并可访问");
    } else {
      console.error(error.message);
    }
  }
}

// 显示用法说明
console.log(
  "\n用法: node stress-test-client.js [local|remote] [pdf|screenshot] [测试URL] [switch] [波次间延迟(ms)]"
);
console.log("参数说明:");
console.log("  local|remote        - 测试环境，默认local");
console.log("  pdf|screenshot      - 测试端点，默认pdf");
console.log("  测试URL             - 自定义URL，可选");
console.log("  switch              - 添加此参数强制在波次间切换集群");
console.log("  波次间延迟          - 两波测试之间的延迟时间，默认5000ms");
console.log("\n注意: 服务器必须使用 NODE_ENV=test 启动才能使用此功能");
console.log("\n示例:");
console.log(
  "  node stress-test-client.js local pdf                  # 测试本地PDF端点"
);
console.log(
  "  node stress-test-client.js remote screenshot switch   # 测试远程截图端点并强制集群切换"
);
console.log("\n");

// 运行测试
runStressTest();
