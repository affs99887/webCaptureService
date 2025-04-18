const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const winston = require("winston");
const process = require("process");
const Queue = require("better-queue");
const { Cluster } = require("puppeteer-cluster");
const cors = require("cors");
const { Readable } = require("stream");
const pm2 = require("pm2");
const os = require("os");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const redoc = require("redoc-express");

// 定义支持的移动设备
const mobileDevices = {
  "iPhone X": {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
    viewport: {
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  },
  "iPad Pro": {
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1",
    viewport: {
      width: 1024,
      height: 1366,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
  },
};

// Swagger配置
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Web Capture Service API",
      version: "1.0.0",
      description: `
# 简介
这是一个提供网页截图和PDF生成功能的服务API。支持多种设备模拟和自定义配置。

## 主要功能
- 网页截图（支持多种设备模拟）
- PDF生成（支持页码和水印）
- PDF流式下载

## 技术特点
- 使用Puppeteer进行页面渲染
- 支持集群模式处理请求（最大并发数：10）
- 自动等待页面加载完成（包括动态内容）
- 内置水印保护
- 支持自定义视口大小
- 支持多种移动设备模拟

## 性能与限制
- 最大并发请求数：10
- 单个请求超时时间：180秒
- 重试次数：3次（间隔5秒）
- PDF纸张大小：A4（794x1123像素）
- 支持的设备：${Object.keys(mobileDevices).join(", ")}
- 生成的文件存储位置：
  * 截图：/screenshots 目录
  * PDF：/pdfs 目录

## 使用建议
1. 建议为每个请求使用唯一的文件名，避免覆盖
2. URL必须包含完整的协议（http://或https://）
3. 大文件生成可能需要较长时间，建议设置合适的超时时间
4. 如遇到问题，请记录requestId以便追踪
5. 对于动态加载的页面，系统会自动等待加载完成
6. PDF生成时建议考虑是否需要页码（showPageNo参数）

## 错误处理
- 400：请求参数错误（检查参数完整性和格式）
- 500：服务器内部错误（检查URL可访问性）
- 503：服务暂时不可用（服务可能正在重启）

## 注意事项
- 所有生成的文件都会自动添加水印保护
- 文件名不需要包含扩展名（.png或.pdf）
- 建议在调用API时添加错误处理机制
- 跨域访问需要预先配置允许的域名
- 建议在请求头中设置合理的超时时间
- 大文件处理时注意内存使用

## 安全说明
- 支持API密钥认证（X-API-Key请求头）
- 所有请求都经过CORS策略控制
- 支持SSL/TLS加密传输
- 文件生成过程中有防护机制
      `,
      contact: {
        name: "技术支持",
        email: "support@example.com",
        url: "http://example.com/support",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
      termsOfService: "http://example.com/terms/",
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3065}`,
        description: "开发服务器",
      },
    ],
    components: {
      schemas: {
        Error: {
          type: "object",
          required: ["code", "message", "success", "timestamp", "requestId"],
          properties: {
            code: {
              type: "integer",
              description:
                "错误码（400：参数错误，500：服务器错误，503：服务不可用）",
              example: 500,
            },
            message: {
              type: "string",
              description: "错误详细信息",
              example: "Failed to generate screenshot: URL is not accessible",
            },
            success: {
              type: "boolean",
              description: "是否成功",
              example: false,
            },
            timestamp: {
              type: "integer",
              description: "错误发生的时间戳",
              example: 1677649423000,
            },
            requestId: {
              type: "string",
              description: "用于追踪的请求ID",
              example: "req_1234567890",
            },
          },
        },
        SuccessResponse: {
          type: "object",
          required: [
            "code",
            "message",
            "fileName",
            "success",
            "timestamp",
            "requestId",
          ],
          properties: {
            code: {
              type: "integer",
              description: "状态码（200表示成功）",
              example: 200,
            },
            message: {
              type: "string",
              description: "成功的详细信息",
              example: "Screenshot generated and saved successfully",
            },
            fileName: {
              type: "string",
              description: "生成的文件名（包含扩展名）",
              example: "example-screenshot.png",
            },
            success: {
              type: "boolean",
              description: "是否成功",
              example: true,
            },
            timestamp: {
              type: "integer",
              description: "处理完成的时间戳",
              example: 1677649423000,
            },
            requestId: {
              type: "string",
              description: "用于追踪的请求ID",
              example: "req_1234567890",
            },
          },
        },
        DeviceInfo: {
          type: "object",
          properties: {
            userAgent: {
              type: "string",
              description: "设备的User Agent字符串",
            },
            viewport: {
              type: "object",
              properties: {
                width: {
                  type: "integer",
                  description: "视口宽度",
                },
                height: {
                  type: "integer",
                  description: "视口高度",
                },
                deviceScaleFactor: {
                  type: "number",
                  description: "设备缩放比例",
                },
                isMobile: {
                  type: "boolean",
                  description: "是否为移动设备",
                },
                hasTouch: {
                  type: "boolean",
                  description: "是否支持触摸",
                },
                isLandscape: {
                  type: "boolean",
                  description: "是否为横向模式",
                },
              },
            },
          },
        },
      },
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API密钥认证，需要在请求头中设置X-API-Key",
        },
      },
    },
    tags: [
      {
        name: "截图服务",
        description: "提供网页截图功能，支持多种设备模拟和自定义视口大小",
      },
      {
        name: "PDF服务",
        description:
          "提供PDF生成功能，支持页码显示和水印保护，包括文件保存和流式下载两种模式",
      },
    ],
    externalDocs: {
      description: "更多文档",
      url: "http://example.com/docs",
    },
  },
  apis: ["./app.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// 首先定义 logCache
const logCache = [];

// 然后创建 logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: () =>
        getBeijingTime().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    }),
    winston.format.printf(({ level, message, timestamp }) => {
      // 将日志存入缓存
      logCache.push({ level, message, timestamp });
      // 如果是错误日志，输出到控制台
      if (level === "error") {
        console.error(`${timestamp} ${level}: ${message}`);
      }
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      silent: true,
    }),
  ],
});

// 根据操作系统选择 Chrome 路径
const isWindows = ["win32", "win64"].includes(os.platform());
const chromiumExecutablePath = isWindows
  ? path.join(process.cwd(), "chrome-win64", "chrome.exe")
  : "/usr/bin/google-chrome";

logger.info(`Operating System: ${os.platform()}`);
logger.info(`Using Chrome path: ${chromiumExecutablePath}`);

const app = express();

const allowedOrigins = ["http://localhost:3100"]; // 允许的源
app.use(
  cors({
    origin: function (origin, callback) {
      // 允许来自 allowedOrigins 的请求
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("不允许的 CORS 来源"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // 允许的方法
    allowedHeaders: ["Content-Type", "Authorization"], // 允许的头部
    credentials: true, // 是否允许发送凭证
  })
);

app.use(express.json());

let cluster;

// 内存监控配置 - 允许通过环境变量调整
const MEMORY_CHECK_INTERVAL = parseInt(
  process.env.MEMORY_CHECK_INTERVAL || "30000"
); // 每30秒检查一次内存使用情况
const MEMORY_THRESHOLD = parseInt(process.env.MEMORY_THRESHOLD || "80"); // 内存使用率达到80%时触发切换
const MEMORY_WARNING_THRESHOLD = parseInt(
  process.env.MEMORY_WARNING_THRESHOLD || MEMORY_THRESHOLD - 10
); // 达到警告阈值时准备备用集群
const CLUSTER_SWITCH_COOLDOWN = parseInt(
  process.env.CLUSTER_SWITCH_COOLDOWN || "300000"
); // 5分钟冷却时间

let memoryCheckInterval;
let currentCluster = null;
let standbyCluster = null;
let isClusterSwitching = false;
let lastClusterSwitchTime = 0;

async function setupCluster() {
  // 如果当前集群已存在，直接返回
  if (currentCluster) {
    return currentCluster;
  }

  // 如果备用集群已存在，将其设为当前集群并清空备用集群
  if (standbyCluster) {
    currentCluster = standbyCluster;
    standbyCluster = null;
    return currentCluster;
  }

  // 创建新集群
  const newCluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 10,
    puppeteerOptions: {
      executablePath: chromiumExecutablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
      timeout: 180000,
      protocolTimeout: 180000,
      headless: "new",
    },
    timeout: 240000,
    retryLimit: 3,
    retryDelay: 5000,
    monitor: true,
  });

  newCluster.on("taskerror", (err, data) => {
    const requestId = data.requestId || "unknown";
    logger.error(`[${requestId}] Error processing task: ${err.message}`);
  });

  currentCluster = newCluster;
  return currentCluster;
}

// 创建备用集群
async function prepareStandbyCluster() {
  if (standbyCluster || isClusterSwitching) {
    return; // 如果已有备用集群或正在切换中，不再创建
  }

  logger.info("准备创建备用集群...");
  try {
    standbyCluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: 10,
      puppeteerOptions: {
        executablePath: chromiumExecutablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
        timeout: 180000,
        protocolTimeout: 180000,
        headless: "new",
      },
      timeout: 240000,
      retryLimit: 3,
      retryDelay: 5000,
      monitor: true,
    });

    standbyCluster.on("taskerror", (err, data) => {
      const requestId = data.requestId || "unknown";
      logger.error(
        `[备用集群] [${requestId}] Error processing task: ${err.message}`
      );
    });

    logger.info("备用集群创建完成");
  } catch (error) {
    logger.error("创建备用集群失败:", error);
    standbyCluster = null;
  }
}

// 关闭集群
async function closeCluster(cluster, reason) {
  if (!cluster) return;

  try {
    logger.info(`正在关闭集群，原因: ${reason}`);
    await cluster.close();
    logger.info("集群已成功关闭");
  } catch (error) {
    logger.error("关闭集群时出错:", error);
  }
}

// 切换到备用集群
async function switchToStandbyCluster() {
  // 避免同时多次触发切换
  if (isClusterSwitching) {
    logger.info("集群切换已在进行中，忽略此次切换请求");
    return false;
  }

  // 如果没有备用集群，先创建一个
  if (!standbyCluster) {
    logger.info("备用集群不存在，尝试创建新的备用集群");
    await prepareStandbyCluster();

    // 如果创建失败，等待短暂时间后再次尝试
    if (!standbyCluster) {
      logger.warn("首次创建备用集群失败，5秒后重试");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await prepareStandbyCluster();
    }
  }

  if (!standbyCluster) {
    logger.error("无法切换到备用集群：多次尝试创建备用集群均失败");
    // 如果实在无法创建备用集群，记录状态并尝试释放一些资源
    try {
      global.gc(); // 尝试触发垃圾回收（如果启用了--expose-gc）
    } catch (e) {
      // 忽略错误，因为不是所有环境都启用了显式GC
    }
    return false;
  }

  isClusterSwitching = true;
  logger.info("开始切换到备用集群...");

  try {
    // 保存旧集群的引用，但继续使用它处理现有请求
    const oldCluster = currentCluster;

    // 记录旧集群状态
    if (oldCluster) {
      const workerCount = oldCluster.workerCount
        ? oldCluster.workerCount()
        : "unknown";
      logger.info(`旧集群状态：活跃任务数 ${workerCount}`);
    }

    // 将备用集群设置为当前集群
    currentCluster = standbyCluster;
    standbyCluster = null;
    logger.info("当前集群已更新为备用集群");

    // 等待适当的时机关闭旧集群
    if (oldCluster) {
      setTimeout(async () => {
        try {
          // 检查旧集群是否还有活跃任务
          const hasWorkerCountMethod =
            typeof oldCluster.workerCount === "function";

          if (hasWorkerCountMethod && oldCluster.workerCount() > 0) {
            const taskCount = oldCluster.workerCount();
            logger.info(`旧集群仍有 ${taskCount} 个活跃任务，延迟关闭`);

            // 定期检查直到没有活跃任务
            let checkCount = 0;
            const maxChecks = 60; // 最多检查60次(5分钟)

            const checkInterval = setInterval(async () => {
              checkCount++;

              // 捕获可能的错误(例如集群已关闭)
              try {
                const remainingTasks = oldCluster.workerCount();

                if (remainingTasks === 0 || checkCount >= maxChecks) {
                  clearInterval(checkInterval);
                  const reason =
                    remainingTasks === 0
                      ? "切换到新集群且无活跃任务"
                      : `达到最大检查次数(${maxChecks})，仍有${remainingTasks}个任务`;

                  await closeCluster(oldCluster, reason);
                } else {
                  logger.info(
                    `[检查 ${checkCount}/${maxChecks}] 等待旧集群完成剩余 ${remainingTasks} 个任务`
                  );
                }
              } catch (checkError) {
                clearInterval(checkInterval);
                logger.error("检查旧集群任务时出错:", checkError);
                try {
                  await closeCluster(oldCluster, "检查任务时发生错误");
                } catch (closeError) {
                  logger.error("关闭出错的旧集群时发生错误:", closeError);
                }
              }
            }, 5000);
          } else {
            // 如果没有活跃任务或无法获取任务数，直接关闭
            await closeCluster(oldCluster, "切换到新集群且似乎无活跃任务");
          }
        } catch (error) {
          logger.error("处理旧集群时出错:", error);
          try {
            await closeCluster(oldCluster, "处理过程中出错");
          } catch (closeError) {
            logger.error("关闭出错的旧集群时出错:", closeError);
          }
        }
      }, 5000); // 给5秒钟时间让新请求进入新集群
    }

    // 开始准备下一个备用集群
    setTimeout(() => {
      try {
        logger.info("开始准备下一个备用集群");
        prepareStandbyCluster();
      } catch (error) {
        logger.error("准备下一个备用集群时出错:", error);
      }
    }, 10000);

    // 更新切换时间和状态
    lastClusterSwitchTime = Date.now();
    logger.info(`集群切换完成，时间戳: ${lastClusterSwitchTime}`);
    isClusterSwitching = false;
    return true;
  } catch (error) {
    logger.error("切换集群过程中发生异常:", error);

    // 如果切换过程中出错，尝试恢复到一个可用状态
    if (!currentCluster && standbyCluster) {
      logger.info("尝试使用备用集群作为恢复措施");
      currentCluster = standbyCluster;
      standbyCluster = null;
    }

    isClusterSwitching = false;
    return false;
  }
}

// 监控系统内存使用情况
function monitorMemoryUsage() {
  // 获取进程内存使用
  const memUsage = process.memoryUsage();

  // 获取系统内存信息
  const systemMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = systemMemory - freeMemory;
  const memoryUsagePercent = (usedMemory / systemMemory) * 100;

  // 记录详细的内存使用情况
  const memData = {
    // 进程内存
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    rss: Math.round(memUsage.rss / 1024 / 1024),
    external: Math.round((memUsage.external || 0) / 1024 / 1024),
    arrayBuffers: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024),

    // 系统内存
    systemTotal: Math.round(systemMemory / 1024 / 1024),
    systemFree: Math.round(freeMemory / 1024 / 1024),
    systemUsed: Math.round(usedMemory / 1024 / 1024),
    usagePercent: memoryUsagePercent.toFixed(2),

    // 当前集群状态
    hasCurrentCluster: !!currentCluster,
    hasStandbyCluster: !!standbyCluster,
    isClusterSwitching: isClusterSwitching,
    activeRequests: activeRequests,

    // 阈值配置
    threshold: MEMORY_THRESHOLD,
    warningThreshold: MEMORY_WARNING_THRESHOLD,

    // 时间信息
    timestamp: Date.now(),
    timeSinceLastSwitch: Date.now() - lastClusterSwitchTime,
  };

  // 将内存使用数据写入日志文件
  const now = getBeijingTime();
  const timestamp = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  // 简洁的日志条目
  const logEntry = `${timestamp} - 内存: 系统(${memData.usagePercent}%), 堆(${memData.heapUsed}/${memData.heapTotal}MB), RSS(${memData.rss}MB), 活跃请求(${memData.activeRequests})`;

  // 详细的JSON日志记录
  const detailedLogEntry = `${timestamp} - 内存详情: ${JSON.stringify(
    memData
  )}`;

  // 日志写入
  fs.appendFileSync(
    path.join(process.cwd(), "memory-monitor.log"),
    logEntry + "\n"
  );

  // 每小时或内存使用率较高时才写入详细日志
  const hourlyDetailedLog = now.getMinutes() === 0; // 每小时的第0分钟
  if (hourlyDetailedLog || memoryUsagePercent > MEMORY_WARNING_THRESHOLD) {
    fs.appendFileSync(
      path.join(process.cwd(), "memory-monitor-detailed.log"),
      detailedLogEntry + "\n"
    );
  }

  // 内存使用情况日志级别动态调整
  if (memoryUsagePercent > MEMORY_THRESHOLD) {
    logger.warn(
      `内存使用率(${memoryUsagePercent.toFixed(
        2
      )}%)超过阈值(${MEMORY_THRESHOLD}%)`
    );
  } else if (memoryUsagePercent > MEMORY_WARNING_THRESHOLD) {
    logger.info(
      `内存使用率(${memoryUsagePercent.toFixed(
        2
      )}%)接近阈值(${MEMORY_THRESHOLD}%)`
    );
  }

  // 检查是否需要切换集群
  if (
    memoryUsagePercent > MEMORY_THRESHOLD &&
    !isClusterSwitching &&
    Date.now() - lastClusterSwitchTime > CLUSTER_SWITCH_COOLDOWN
  ) {
    logger.warn(
      `内存使用率达到 ${memoryUsagePercent.toFixed(
        2
      )}%，超过阈值 ${MEMORY_THRESHOLD}%，开始切换集群`
    );
    switchToStandbyCluster();
  }

  // 如果内存使用率高但还未达到阈值，准备备用集群
  if (
    memoryUsagePercent > MEMORY_WARNING_THRESHOLD &&
    !standbyCluster &&
    !isClusterSwitching
  ) {
    logger.info(
      `内存使用率达到 ${memoryUsagePercent.toFixed(
        2
      )}%，超过警告阈值 ${MEMORY_WARNING_THRESHOLD}%，开始准备备用集群`
    );
    prepareStandbyCluster();
  }

  // 如果内存使用极高，尝试主动回收垃圾
  if (memoryUsagePercent > 95) {
    logger.warn(
      `内存使用率极高(${memoryUsagePercent.toFixed(2)}%)，尝试回收垃圾`
    );
    try {
      global.gc();
    } catch (e) {
      // 可能未启用 --expose-gc
    }
  }

  return memData;
}

function getBeijingTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * 8); // 北京时间为UTC+8
}

function generateSeparator() {
  const separatorLength = 50;
  return "=".repeat(separatorLength);
}

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

let logFlushInterval;

// 添加一个请求计数器
let activeRequests = 0;
let isShuttingDown = false;

// 在每个请求处理开始时增加计数
function incrementRequestCount() {
  activeRequests++;
}

// 在每个请求处理结束时减少计数
function decrementRequestCount() {
  activeRequests--;
}

// 修改致命错误处理
process.on("uncaughtException", async (error) => {
  try {
    logger.error("未捕获的异常:", error);
    isShuttingDown = true;

    // 清理内存监控
    if (memoryCheckInterval) clearInterval(memoryCheckInterval);
    if (logFlushInterval) clearInterval(logFlushInterval);

    // 等待所有活跃请求完成
    if (activeRequests > 0) {
      logger.info(`等待 ${activeRequests} 个活跃请求完成...`);
      let waitTimeMs = 0;
      const maxWaitMs = 30000; // 最多等待30秒

      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          waitTimeMs += 1000;

          if (activeRequests === 0 || waitTimeMs >= maxWaitMs) {
            clearInterval(checkInterval);
            if (waitTimeMs >= maxWaitMs && activeRequests > 0) {
              logger.warn(
                `到达最大等待时间 ${
                  maxWaitMs / 1000
                }秒，仍有 ${activeRequests} 个活跃请求未完成`
              );
            }
            resolve();
          } else {
            logger.info(
              `仍有 ${activeRequests} 个活跃请求，已等待 ${
                waitTimeMs / 1000
              } 秒...`
            );
          }
        }, 1000);
      });
    }

    // 关闭集群
    if (currentCluster) {
      await closeCluster(currentCluster, "Uncaught Exception");
    }
    if (standbyCluster) {
      await closeCluster(standbyCluster, "Uncaught Exception");
    }

    await logShutdown("Uncaught Exception");
    flushLogs();

    logger.info("准备重启服务...");
    try {
      await restartService();
    } catch (restartError) {
      logger.error("重启服务失败:", restartError);

      // 设置超时强制退出，以防无法正常重启
      setTimeout(() => {
        logger.warn("应用程序未能在预期时间内重启，强制退出");
        process.exit(1);
      }, 10000);
    }
  } catch (err) {
    console.error("处理未捕获异常时出错:", err);
    process.exit(1);
  }
});

// 捕获未处理的 Promise 拒绝
process.on("unhandledRejection", async (reason, promise) => {
  try {
    logger.error("未处理的Promise拒绝:", reason);

    // 记录当前状态
    const memData = monitorMemoryUsage();
    logger.info(
      `未处理的Promise拒绝时内存状态: 系统(${memData.usagePercent}%), 堆(${memData.heapUsed}/${memData.heapTotal}MB)`
    );

    await logShutdown("未处理的Promise拒绝");
    flushLogs();

    // 如果内存使用率高，重启服务
    if (memData.usagePercent > MEMORY_WARNING_THRESHOLD) {
      logger.info("由于内存使用率高，准备重启服务...");
      try {
        await restartService();
      } catch (restartError) {
        logger.error("重启服务失败:", restartError);
      }
    } else {
      // 如果内存使用率不高，尝试切换集群而不是重启
      logger.info("尝试切换到新集群而不是重启服务...");
      const switched = await switchToStandbyCluster();
      if (!switched) {
        logger.warn("集群切换失败，将重启服务");
        await restartService();
      }
    }
  } catch (err) {
    console.error("处理未处理的Promise拒绝时出错:", err);
    process.exit(1);
  }
});

// 捕获 SIGINT 信号（通常是通过 Ctrl+C 终止程序）
process.on("SIGINT", async () => {
  logger.info("Received SIGINT signal");
  clearInterval(memoryCheckInterval);
  if (currentCluster) {
    await closeCluster(currentCluster, "SIGINT");
  }
  if (standbyCluster) {
    await closeCluster(standbyCluster, "SIGINT");
  }
  await logShutdown("SIGINT (Ctrl+C)");
  process.exit(0);
});

// 捕获 SIGTERM 信号（通常是系统请求终止程序）
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM signal");
  clearInterval(memoryCheckInterval);
  if (currentCluster) {
    await closeCluster(currentCluster, "SIGTERM");
  }
  if (standbyCluster) {
    await closeCluster(standbyCluster, "SIGTERM");
  }
  await logShutdown("SIGTERM");
  process.exit(0);
});

// 记录程序关闭的函数
function logShutdown(reason) {
  return new Promise((resolve) => {
    const separator = generateSeparator();
    logger.info(separator);
    logger.info(`应用程序正在关闭。原因: ${reason}`);
    logger.info(
      `结束时间: ${getBeijingTime().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      })}`
    );

    // 清除定时器
    if (logFlushInterval) {
      clearInterval(logFlushInterval);
    }

    // 强制写入所有缓存的日志
    flushLogs();

    // 给予额外的时间确保日志被写入
    setTimeout(resolve, 1000);
  });
}

// 在程序即将退出时记录日志
process.on("exit", (code) => {
  logger.info(`Application exiting with code: ${code}`);
  // 确保最后的日志也被写入
  flushLogs();
});

// 创建请求队列
const requestQueue = new Queue(
  async function (task, cb) {
    try {
      const result = await task.handler(task.req, task.res);
      cb(null, result);
    } catch (error) {
      cb(error);
    }
  },
  { concurrent: 1 }
);

function normalizeDeviceName(name) {
  if (!name) return "";
  // 将所有空白字符（包括不间断空格）替换为标准空格
  return name.replace(/\s+/g, " ").trim();
}

const allowedDevices = ["iPhone X", "iPad Pro"];

// 处理文件名和路径辅助函数
function processFilename(filename, extension, dirName) {
  // 移除任何现有的文件扩展名
  let baseName = path.basename(filename, path.extname(filename));

  // 添加正确的扩展名
  let fullFilename = `${baseName}.${extension}`;

  // 创建目录（如果不存在）
  let dir = path.join(process.cwd(), dirName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 返回完整的文件路径
  return path.join(dir, fullFilename);
}

// 添加生成请求ID的函数
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 修改处理函数，添加请求ID
async function handleScreenshot(req, res) {
  if (isShuttingDown) {
    return res.status(503).json({
      code: 503,
      message: "服务正在重启中，请稍后重试",
      success: false,
      timestamp: Date.now(),
    });
  }

  const requestId = generateRequestId();
  incrementRequestCount();

  const {
    url,
    filename,
    deviceName: rawDeviceName = "iPad Pro",
    width,
  } = req.body;

  const deviceName = normalizeDeviceName(rawDeviceName);

  if (!allowedDevices.includes(deviceName)) {
    const errorMessage = `设备 "${deviceName}" 未被允许。允许的设备有: ${allowedDevices.join(
      ", "
    )}`;
    logger.error(`[${requestId}] ${errorMessage}`);
    return res.status(400).json({
      code: 400,
      message: errorMessage,
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  if (!mobileDevices[deviceName]) {
    const errorMessage = `设备配置 "${deviceName}" 未找到`;
    logger.error(`[${requestId}] ${errorMessage}`);
    return res.status(400).json({
      code: 400,
      message: errorMessage,
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  if (!url) {
    logger.info(`[${requestId}] 截图请求被拒绝：需要提供 URL`);
    return res.status(400).json({
      code: 400,
      message: "URL 是必需的",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }
  if (!filename) {
    return res.status(400).json({
      code: 400,
      message: "Filename 是必需的",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }
  if (width && isNaN(parseInt(width))) {
    return res.status(400).json({
      code: 400,
      message: "Width 必须是一个有效的数字",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  try {
    logger.info(
      `[${requestId}] Starting screenshot capture for ${url} on ${deviceName}`
    );
    const cluster = await setupCluster();

    const result = await cluster.execute(
      { url, filename, deviceName, width, requestId },
      async ({ page, data }) => {
        const device = mobileDevices[data.deviceName];
        if (!device) {
          throw new Error(
            `[${data.requestId}] Device "${data.deviceName}" not found`
          );
        }

        let viewport = { ...device.viewport };
        if (data.width) {
          viewport.width = parseInt(data.width);
        }

        await page.setUserAgent(device.userAgent);
        await page.setViewport(viewport);

        page.setDefaultTimeout(180000);
        page.setDefaultNavigationTimeout(180000);

        await page.setRequestInterception(true);
        page.on("request", (request) => {
          if (
            ["image", "stylesheet", "font"].includes(request.resourceType())
          ) {
            request.continue();
          } else if (request.resourceType() === "script") {
            request.continue();
          } else {
            request.continue();
          }
        });

        await page.goto(data.url, {
          waitUntil: ["load", "domcontentloaded", "networkidle0"],
          timeout: 180000,
        });

        // 注入水印样式
        await page.evaluate((waterMarkData) => {
          const style = document.createElement("style");
          style.textContent = `
            @page:first { margin-top: 0; margin-bottom: 0; }
            @page { margin-top: 5mm; margin-bottom: 10mm; }
            body, html { background-color: white !important; position: relative; }
            
            /* 创建水印容器 */
            body::before {
              content: '';
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              z-index: 9999;
              
              /* 水印图片设置 */
              background-image: url('${waterMarkData}');
              background-repeat: repeat;
              background-size: 500px auto;
              pointer-events: none;
              
              /* 确保水印在打印时可见 */
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          `;
          document.head.appendChild(style);
        }, waterMark);

        const screenshot = await captureFullPage(page, data.requestId);
        return screenshot;
      }
    );

    const filePath = processFilename(filename, "png", "screenshots");
    const base64Data = result.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(filePath, base64Data, "base64");

    logger.info(`[${requestId}] Screenshot saved successfully to ${filePath}`);

    res.status(200).json({
      code: 200,
      message: "Screenshot generated and saved successfully",
      fileName: path.basename(filePath),
      success: true,
      timestamp: Date.now(),
      requestId,
    });
  } catch (err) {
    console.error(`[${requestId}] Error details:`, err);
    logger.error(`[${requestId}] Error details:`, err);
    let errorInfo = err.message;
    if (err.stack) {
      errorInfo += "\n\nStack trace:\n" + err.stack;
    }
    res.status(500).json({
      code: 500,
      message: "Failed to capture full page mobile screenshot: " + errorInfo,
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  } finally {
    decrementRequestCount();
  }
}

async function captureFullPage(page, requestId) {
  // 滚动到底部以触发懒加载内容
  await autoScroll(page);

  // 慢慢滚动回顶部，同时观察页面高度变化
  let maxHeight = await getPageHeight(page);
  await slowScrollToTop(page, async (currentHeight) => {
    if (currentHeight > maxHeight) {
      maxHeight = currentHeight;
      logger.info(`[${requestId}] New max height: ${maxHeight}`);
    }
  });

  // 设置足够大的视口高度
  logger.info(
    `[${requestId}] Viewport set to ${page.viewport().width}x${maxHeight}`
  );
  await page.setViewport({
    width: page.viewport().width,
    height: maxHeight,
  });

  // 在 final autoScroll 之前开始监听 getData 请求
  const waitForGetData = new Promise((resolve, reject) => {
    let getDataRequest = null;
    let isGetDataFound = false;
    let requestCount = 0;
    let lastRequest = null;
    let pendingRequest = null;
    let resolvePromise = resolve;

    // 监听所有请求
    page.on("request", (request) => {
      if (request.url().includes("/reportView/getData")) {
        requestCount++;
        isGetDataFound = true;
        lastRequest = request;
        pendingRequest = request;
        getDataRequest = request;
        logger.info(
          `[${requestId}] getData request #${requestCount} detected: ${request.url()}`
        );
      }
    });

    // 监听请求完成
    page.on("requestfinished", (request) => {
      if (request === pendingRequest) {
        if (request === lastRequest) {
          logger.info(
            `[${requestId}] Last getData request #${requestCount} finished successfully`
          );
          resolvePromise();
        } else {
          logger.info(
            `[${requestId}] getData request #${requestCount} finished, but not the last one`
          );
        }
        pendingRequest = null;
      }
    });

    // 监听请求失败
    page.on("requestfailed", (request) => {
      if (request === pendingRequest) {
        const error = request.failure();
        logger.error(
          `[${requestId}] getData request #${requestCount} failed: ${
            error?.errorText || "Unknown error"
          }`
        );
        if (request === lastRequest) {
          reject(
            new Error(
              `Last getData request failed: ${
                error?.errorText || "Unknown error"
              }`
            )
          );
        }
        pendingRequest = null;
      }
    });

    // 设置超时检查
    setTimeout(() => {
      if (!isGetDataFound) {
        logger.error(
          `[${requestId}] No getData request found within 30 seconds`
        );
        reject(new Error("getData request not found within 30 seconds"));
      } else if (pendingRequest) {
        logger.error(
          `[${requestId}] Last getData request #${requestCount} did not complete within timeout`
        );
        reject(new Error("Last getData request timed out"));
      }
    }, 30000);
  });

  // 再次滚动到底部确保所有内容都已加载
  logger.info(`[${requestId}] Starting final autoScroll`);
  await autoScroll(page);
  logger.info(`[${requestId}] After final autoScroll - URL: ${page.url()}`);

  // 检查getData请求状态
  logger.info(`[${requestId}] Checking getData request status...`);
  try {
    logger.info(
      `[${requestId}] Waiting for last getData request to complete...`
    );
    await waitForGetData;
    await new Promise((resolve) => setTimeout(resolve, 500));
    logger.info(
      `[${requestId}] Last getData request completed successfully, proceeding with screenshot`
    );
  } catch (error) {
    logger.error(`[${requestId}] Error waiting for getData: ${error.message}`);
    throw error;
  }

  // 捕获整个页面的截图
  logger.info(`[${requestId}] Capturing screenshot with height: ${maxHeight}`);
  const screenshot = await page.screenshot({
    width: `${page.viewport().width}px`,
    encoding: "base64",
  });
  logger.info(
    `[${requestId}] Screenshot captured successfully - URL: ${page.url()}`
  );

  return `data:image/png;base64,${screenshot}`;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300; // 增加滚动距离
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 50); // 减少间隔时间
    });
  });
}

async function slowScrollToTop(page, callback) {
  await page.evaluate(async (cb) => {
    await new Promise((resolve) => {
      const distance = -50; // 向上滚动
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        if (window.pageYOffset <= 0) {
          clearInterval(timer);
          resolve();
        }
        cb(document.documentElement.scrollHeight);
      }, 100);
    });
  }, callback);
}

async function getPageHeight(page) {
  return page.evaluate(() => document.documentElement.scrollHeight);
}

const waterMark =
  "data:image/png;base64," +
  fs
    .readFileSync(path.join(process.cwd(), "src", "assets", "watermark.png"))
    .toString("base64");

// 同样修改 handlePdf 函数
async function handlePdf(req, res) {
  const requestId = generateRequestId();
  const { url, filename, showPageNo = true } = req.body;

  if (!url) {
    logger.info(`[${requestId}] PDF request rejected: URL is required`);
    return res.status(400).json({
      code: 400,
      message: "URL is required",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }
  if (!filename) {
    return res.status(400).json({
      code: 400,
      message: "Filename is required",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  try {
    logger.info(
      `[${requestId}] Starting PDF generation with watermark for ${url}`
    );
    const cluster = await setupCluster();

    const result = await cluster.execute(
      { url, filename, showPageNo, requestId },
      async ({ page, data }) => {
        const deviceName = "iPad Pro";
        const device = mobileDevices[deviceName];

        await page.setUserAgent(device.userAgent);
        await page.setViewport(device.viewport);

        // 启用请求拦截
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          request.continue();
        });

        // 导航到页面
        logger.info(`[${data.requestId}] Navigating to page: ${data.url}`);
        await page.goto(data.url, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });

        // 记录捕获前的页面状态
        logger.info(
          `[${
            data.requestId
          }] Before capture - URL: ${page.url()}, Title: ${await page.title()}`
        );

        // 执行页面捕获
        await captureFullPage(page, data.requestId);

        // 注入水印样式
        await page.evaluate((waterMarkData) => {
          const style = document.createElement("style");
          style.textContent = `
            @page:first { margin-top: 0; margin-bottom: 0; }
            @page { margin-top: 5mm; margin-bottom: 10mm; }
            body, html { background-color: white !important; position: relative; }
            
            /* 创建水印容器 */
            body::before {
              content: '';
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              z-index: 9999;
              
              /* 水印图片设置 */
              background-image: url('${waterMarkData}');
              background-repeat: repeat;
              background-size: 400px auto;
              pointer-events: none;
              
              /* 确保水印在打印时可见 */
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          `;
          document.head.appendChild(style);
        }, waterMark);

        const a4Width = 794;
        const a4Height = 1123;
        let scale = Math.min(a4Width / device.viewport.width, 2);
        scale = Math.max(scale, 0.1);

        const pdfOptions = {
          format: "A4",
          printBackground: true,
          scale: scale,
          displayHeaderFooter: data.showPageNo,
          headerTemplate: "<span></span>",
          footerTemplate: data.showPageNo
            ? `
              <div style="width: 100%; font-size: 10px; text-align: center; color: #808080; position: relative;">
                <span style="position: absolute; left: 0; right: 0; top: -5px;">
                  <span class="pageNumber"></span>/<span class="totalPages"></span>
                </span>
              </div>
            `
            : "<span></span>",
        };

        const pdf = await page.pdf(pdfOptions);
        return pdf;
      }
    );

    const filePath = processFilename(filename, "pdf", "pdfs");
    fs.writeFileSync(filePath, result);

    logger.info(`[${requestId}] PDF saved successfully to ${filePath}`);

    res.status(200).json({
      code: 200,
      message: "PDF with watermark generated and saved successfully",
      fileName: path.basename(filePath),
      success: true,
      timestamp: Date.now(),
      requestId,
    });
  } catch (err) {
    console.error(`[${requestId}] Error details:`, err);
    logger.error(`[${requestId}] Error details:`, err);
    let errorInfo = err.message;
    if (err.stack) {
      errorInfo += "\n\nStack trace:\n" + err.stack;
    }
    res.status(500).json({
      code: 500,
      message: "Failed to generate PDF: " + errorInfo,
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  } finally {
    decrementRequestCount();
  }
}

// 同样修改 handleStream 函数
async function handleStream(req, res) {
  const requestId = generateRequestId();
  const { url, filename, showPageNo = true } = req.body;

  if (!url) {
    logger.info(`[${requestId}] PDF stream request rejected: URL is required`);
    return res.status(400).json({
      code: 400,
      message: "URL is required",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }
  if (!filename) {
    return res.status(400).json({
      code: 400,
      message: "Filename is required",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  try {
    logger.info(
      `[${requestId}] Starting PDF stream generation with watermark for ${url}`
    );
    const cluster = await setupCluster();

    const pdfBuffer = await cluster.execute(
      { url, filename, showPageNo, requestId },
      async ({ page, data }) => {
        const deviceName = "iPad Pro";
        const device = mobileDevices[deviceName];

        await page.setUserAgent(device.userAgent);
        await page.setViewport(device.viewport);

        // 启用请求拦截
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          request.continue();
        });

        // 导航到页面
        logger.info(`[${data.requestId}] Navigating to page: ${data.url}`);
        await page.goto(data.url, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });

        // 记录捕获前的页面状态
        logger.info(
          `[${
            data.requestId
          }] Before capture - URL: ${page.url()}, Title: ${await page.title()}`
        );

        // 执行页面捕获
        await captureFullPage(page, data.requestId);

        // 注入水印样式
        await page.evaluate((waterMarkData) => {
          const style = document.createElement("style");
          style.textContent = `
            @page:first { margin-top: 0; margin-bottom: 0; }
            @page { margin-top: 5mm; margin-bottom: 10mm; }
            body, html { background-color: white !important; position: relative; }
            
            /* 创建水印容器 */
            body::before {
              content: '';
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              z-index: 9999;
              
              /* 水印图片设置 */
              background-image: url('${waterMarkData}');
              background-repeat: repeat;
              background-size: 500px auto;
              pointer-events: none;
              
              /* 确保水印在打印时可见 */
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          `;
          document.head.appendChild(style);
        }, waterMark);

        const a4Width = 794;
        const a4Height = 1123;
        let scale = Math.min(a4Width / device.viewport.width, 2);
        scale = Math.max(scale, 0.1);

        const pdfOptions = {
          format: "A4",
          printBackground: true,
          scale: scale,
          displayHeaderFooter: data.showPageNo,
          headerTemplate: "<span></span>",
          footerTemplate: data.showPageNo
            ? `
              <div style="width: 100%; font-size: 10px; text-align: center; color: #808080; position: relative;">
                <span style="position: absolute; left: 0; right: 0; top: -5px;">
                  <span class="pageNumber"></span>/<span class="totalPages"></span>
                </span>
              </div>
            `
            : "<span></span>",
        };

        const pdf = await page.pdf(pdfOptions);
        return pdf;
      }
    );

    // 创建一个 Readable 流
    const stream = Readable.from([pdfBuffer]);

    // 设置响应头
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });

    // 将流通过管道发送给客户端
    stream.pipe(res);

    logger.info(
      `[${requestId}] PDF stream with watermark sent successfully for ${url}`
    );
  } catch (err) {
    console.error(`[${requestId}] Error details:`, err);
    logger.error(`[${requestId}] Error details:`, err);
    let errorInfo = err.message;
    if (err.stack) {
      errorInfo += "\n\nStack trace:\n" + err.stack;
    }
    res.status(500).json({
      code: 500,
      message: "Failed to generate PDF stream: " + errorInfo,
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  } finally {
    decrementRequestCount();
  }
}

/**
 * @swagger
 * /screenshot:
 *   post:
 *     summary: 生成网页截图
 *     description: 将网页转换为图片格式（PNG）
 *     tags: [截图服务]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - filename
 *             properties:
 *               url:
 *                 type: string
 *                 description: 需要截图的网页URL（需要包含http://或https://）
 *               filename:
 *                 type: string
 *                 description: 保存的文件名（不需要包含.png后缀）
 *               deviceName:
 *                 type: string
 *                 description: 设备型号（默认使用iPad Pro）
 *                 enum: ${JSON.stringify(Object.keys(mobileDevices))}
 *               width:
 *                 type: integer
 *                 description: 自定义视口宽度（像素），优先级高于deviceName
 *     responses:
 *       200:
 *         description: 截图生成成功
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: 请求参数错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 服务器错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/screenshot", (req, res) => {
  handleScreenshot(req, res);
});

/**
 * @swagger
 * /pdf:
 *   post:
 *     summary: 生成PDF文件
 *     description: 将网页转换为PDF文件并保存到服务器
 *     tags: [PDF服务]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - filename
 *             properties:
 *               url:
 *                 type: string
 *                 description: 需要转换的网页URL（需要包含http://或https://）
 *               filename:
 *                 type: string
 *                 description: 保存的文件名（不需要包含.pdf后缀）
 *               showPageNo:
 *                 type: boolean
 *                 description: 是否显示页码
 *                 default: true
 *     responses:
 *       200:
 *         description: PDF生成成功
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: 请求参数错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 服务器错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/pdf", (req, res) => {
  handlePdf(req, res);
});

/**
 * @swagger
 * /pdf/stream:
 *   post:
 *     summary: 生成PDF流
 *     description: 将网页转换为PDF并直接返回文件流（用于直接下载）
 *     tags: [PDF服务]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - filename
 *             properties:
 *               url:
 *                 type: string
 *                 description: 需要转换的网页URL（需要包含http://或https://）
 *               filename:
 *                 type: string
 *                 description: 下载时显示的文件名（不需要包含.pdf后缀）
 *               showPageNo:
 *                 type: boolean
 *                 description: 是否显示页码
 *                 default: true
 *     responses:
 *       200:
 *         description: PDF流生成成功
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: 请求参数错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: 服务器错误
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/pdf/stream", (req, res) => {
  handleStream(req, res);
});

// 添加Swagger UI路由
app.use(
  "/swagger",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Web Capture Service API文档 (Swagger UI)",
    customfavIcon: "/favicon.ico",
    swaggerOptions: {
      docExpansion: "list",
      filter: true,
      showRequestDuration: true,
    },
  })
);

// 添加 Redoc 路由
app.use(
  "/api-docs",
  redoc({
    title: "Web Capture Service API文档",
    specUrl: "/api-spec",
    redocOptions: {
      hideDownloadButton: false,
      hideLoading: false,
      nativeScrollbars: true,
      theme: {
        colors: {
          primary: {
            main: "#3182ce",
          },
        },
        typography: {
          fontFamily: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
          fontSize: "16px",
          headings: {
            fontFamily: "inherit",
          },
        },
        sidebar: {
          backgroundColor: "#f8f9fa",
        },
      },
    },
  })
);

// 添加用于获取API规范的路由
app.get("/api-spec", (req, res) => {
  res.json(swaggerSpec);
});

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(startPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}

const startServer = async () => {
  const separator = generateSeparator();
  logger.info(separator);
  logger.info("新的应用程序会话开始");
  logger.info(
    `启动时间: ${getBeijingTime().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    })}`
  );

  // 记录内存管理配置
  logger.info(`内存管理配置:`);
  logger.info(`- 检查间隔: ${MEMORY_CHECK_INTERVAL / 1000}秒`);
  logger.info(`- 切换阈值: ${MEMORY_THRESHOLD}%`);
  logger.info(`- 警告阈值: ${MEMORY_WARNING_THRESHOLD}%`);
  logger.info(`- 集群切换冷却时间: ${CLUSTER_SWITCH_COOLDOWN / 1000}秒`);

  // 记录初始内存状态
  try {
    const initialMemory = monitorMemoryUsage();
    logger.info(
      `初始内存状态: ${initialMemory.usagePercent}% (系统), ${initialMemory.heapUsed}/${initialMemory.heapTotal}MB (堆)`
    );
  } catch (error) {
    logger.error("获取初始内存状态失败:", error);
  }

  // 初始化主集群
  try {
    await setupCluster();
    logger.info("主集群初始化成功");

    // 如果初始内存使用率已经接近警告阈值，提前准备备用集群
    const memUsage = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = memUsage - freeMemory;
    const memoryUsagePercent = (usedMemory / memUsage) * 100;

    if (memoryUsagePercent > MEMORY_WARNING_THRESHOLD - 5) {
      logger.info(
        `启动时内存使用率(${memoryUsagePercent.toFixed(
          2
        )}%)已接近警告阈值，提前准备备用集群`
      );
      setTimeout(() => prepareStandbyCluster(), 30000); // 延迟30秒准备备用集群
    }
  } catch (error) {
    logger.error("主集群初始化失败:", error);
    throw error; // 如果集群初始化失败，应该终止服务启动
  }

  // 启动内存监控
  memoryCheckInterval = setInterval(monitorMemoryUsage, MEMORY_CHECK_INTERVAL);
  logger.info(`内存监控已启动，检查间隔: ${MEMORY_CHECK_INTERVAL / 1000}秒`);

  // 修改日志刷新间隔为每天晚上11点55分
  logFlushInterval = setInterval(() => {
    const now = getBeijingTime();
    if (now.getHours() === 23 && now.getMinutes() === 55) {
      flushLogs();
    }
  }, 60 * 1000); // 每分钟检查一次

  const preferredPort = process.env.PORT || 3065;
  try {
    const PORT = await findAvailablePort(preferredPort);
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      console.log("Available device models:");
      console.log("【当前可用的设备型号有:】");
      Object.keys(mobileDevices).forEach((device) => {
        console.log(
          `- ${device} (${mobileDevices[device].viewport.width}x${mobileDevices[device].viewport.height})`
        );
      });

      console.log("\nEndpoints:");
      console.log("【接口名称:】");
      console.log("1. POST /screenshot");
      console.log("   Required parameters: url, filename");
      console.log(
        "   Optional parameters: deviceName, width (If neither deviceName nor width is provided, the default is to use iPad Pro to display the desktop interface; if both deviceName and width are provided, width will take precedence)."
      );
      console.log("   【必填参数: url, filename】");
      console.log(
        "   【可选参数: deviceName, width（如果不传deviceName和width，默认使用iPad Pro展示桌面端界面；若同时传了deviceName和width，会优先使用width）】"
      );
      console.log("2. POST /pdf");
      console.log("   Required parameters: url, filename");
      console.log(
        "   Optional parameters: showPageNo (Default value is true, if there is no need for displaying page numbers, sends false)."
      );
      console.log("   【必填参数: url, filename】");
      console.log(
        "   【可选参数: showPageNo（默认为true，若不需要页码显示，则传false）】"
      );
      console.log("3. POST /pdf/stream");
      console.log("   Required parameters: url, filename");
      console.log(
        "   Optional parameters: showPageNo (Default is true; set to false if page numbers are not needed)."
      );
      console.log("   【必填参数: url, filename】");
      console.log(
        "   【可选参数: showPageNo（默认为true，若不需要页码显示，则传false）】"
      );

      console.log(`\nServer is running on port ${PORT}`);
      console.log(`【服务正在运行在 ${PORT} 端口】`);
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    console.error("启动服务器失败:", err);
    // 清理资源
    clearInterval(memoryCheckInterval);
    clearInterval(logFlushInterval);
    if (currentCluster) {
      await closeCluster(currentCluster, "启动失败");
    }
    if (standbyCluster) {
      await closeCluster(standbyCluster, "启动失败");
    }
    process.exit(1);
  }
};

// 修改 restartService 函数使其返回 Promise
function restartService() {
  return new Promise((resolve, reject) => {
    pm2.connect(function (err) {
      if (err) {
        logger.error("PM2 连接失败:", err);
        reject(err);
        return;
      }

      pm2.restart(process.env.pm_id, function (err, apps) {
        if (err) {
          logger.error("PM2 重启失败:", err);
          reject(err);
        } else {
          logger.info("服务重启成功");
          resolve(apps);
        }
        pm2.disconnect(); // 断开与 PM2 的连接
      });
    });
  });
}

// 更新 flushLogs 函数以使用更规范的日期格式
function flushLogs() {
  if (logCache.length === 0) return;

  const now = getBeijingTime();
  const dateStr = now.toISOString().split("T")[0].replace(/-/g, "-"); // 格式：YYYY-MM-DD
  const timestamp = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  const logsToWrite =
    logCache
      .map((entry) => `${entry.timestamp} ${entry.level}: ${entry.message}`)
      .join("\n") + "\n";

  // 写入日志文件，使用规范的日期格式
  fs.appendFileSync(path.join(logsDir, `logger-${dateStr}.log`), logsToWrite);

  // 如果有错误日志，使用相同的日期格式
  const errorLogs = logCache
    .filter((entry) => entry.level === "error")
    .map((entry) => `${entry.timestamp} ${entry.level}: ${entry.message}`)
    .join("\n");

  if (errorLogs) {
    fs.appendFileSync(path.join(logsDir, "error.log"), errorLogs + "\n");
  }

  // 清空缓存
  logCache.length = 0;
}

// 更新程序退出处理
function exitGracefully(signal) {
  return async () => {
    try {
      logger.info(`接收到 ${signal} 信号，正在优雅关闭...`);
      isShuttingDown = true;

      // 停止所有定时器
      if (memoryCheckInterval) clearInterval(memoryCheckInterval);
      if (logFlushInterval) clearInterval(logFlushInterval);

      // 等待所有活跃请求完成
      if (activeRequests > 0) {
        logger.info(`等待 ${activeRequests} 个活跃请求完成...`);
        let waitTimeMs = 0;
        const maxWaitMs = 30000; // 最多等待30秒

        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            waitTimeMs += 1000;

            if (activeRequests === 0 || waitTimeMs >= maxWaitMs) {
              clearInterval(checkInterval);
              if (waitTimeMs >= maxWaitMs && activeRequests > 0) {
                logger.warn(
                  `到达最大等待时间 ${
                    maxWaitMs / 1000
                  }秒，仍有 ${activeRequests} 个活跃请求未完成`
                );
              }
              resolve();
            } else {
              logger.info(
                `仍有 ${activeRequests} 个活跃请求，已等待 ${
                  waitTimeMs / 1000
                } 秒...`
              );
            }
          }, 1000);
        });
      }

      // 关闭集群
      if (currentCluster) {
        await closeCluster(currentCluster, signal);
      }
      if (standbyCluster) {
        await closeCluster(standbyCluster, signal);
      }

      // 记录关闭信息
      await logShutdown(signal);

      // 确保日志写入完成
      flushLogs();

      // 设置超时强制退出，以防有卡住的资源
      setTimeout(() => {
        logger.warn("应用程序未能在预期时间内完全关闭，强制退出");
        process.exit(1);
      }, 10000);
    } catch (error) {
      logger.error(`在处理 ${signal} 信号时出错:`, error);
      process.exit(1);
    }
  };
}

// 更新信号处理
process.on("SIGINT", exitGracefully("SIGINT"));
process.on("SIGTERM", exitGracefully("SIGTERM"));

startServer();
