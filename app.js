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

async function setupCluster() {
  if (!cluster) {
    cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: 10,
      puppeteerOptions: {
        executablePath: chromiumExecutablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        timeout: 60000,
        protocolTimeout: 60000,
        headless: "new",
      },
      timeout: 120000,
      retryLimit: 3,
      retryDelay: 5000,
    });

    cluster.on("taskerror", (err, data) => {
      const requestId = data.requestId || "unknown";
      logger.error(`[${requestId}] Error processing task: ${err.message}`);
    });
  }
  return cluster;
}

// 配置日志功能

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
    isShuttingDown = true;
    logger.error("Uncaught Exception:", error);

    // 等待所有活跃请求完成
    if (activeRequests > 0) {
      logger.info(`等待 ${activeRequests} 个活跃请求完成...`);
      await new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (activeRequests === 0) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 1000);
      });
    }

    await logShutdown("Uncaught Exception");
    await new Promise((resolve) => {
      flushLogs();
      setTimeout(resolve, 2000);
    });

    logger.info("准备重启服务...");
    await restartService();
  } catch (err) {
    console.error("处理未捕获异常时出错:", err);
    process.exit(1);
  }
});

// 捕获未处理的 Promise 拒绝
process.on("unhandledRejection", async (reason, promise) => {
  try {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    await logShutdown("Unhandled Promise Rejection");

    // 确保日志写入完成后再重启
    await new Promise((resolve) => {
      flushLogs();
      setTimeout(resolve, 2000); // 给予2秒确保日志写入
    });

    logger.info("准备重启服务...");
    // 使用 pm2 重启服务
    await restartService();
  } catch (err) {
    console.error("处理未处理的Promise拒绝时出错:", err);
    process.exit(1);
  }
});

// 捕获 SIGINT 信号（通常是通过 Ctrl+C 终止程序）
process.on("SIGINT", async () => {
  logger.info("Received SIGINT signal");
  if (cluster) {
    await cluster.close();
  }
  await logShutdown("SIGINT (Ctrl+C)");
  process.exit(0);
});

// 捕获 SIGTERM 信号（通常是系统请求终止程序）
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM signal");
  if (cluster) {
    await cluster.close();
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

// 定义一些常用的移动设备配置
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
  // 如果服务正在关闭，拒绝新的请求
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

  // 规范化设备名称
  const deviceName = normalizeDeviceName(rawDeviceName);

  // 检查设备名称是否在允许列表中
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

  // 检查设备配置是否存在
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

        await page.goto(data.url, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });

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
  await page.setViewport({
    width: page.viewport().width,
    height: maxHeight,
  });

  // 再次滚动到底部确保所有内容都已加载
  await autoScroll(page);

  // 捕获整个页面的截图
  logger.info(`[${requestId}] Capturing screenshot with height: ${maxHeight}`);
  const screenshot = await page.screenshot({
    width: `${page.viewport().width}px`,
    encoding: "base64",
  });

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

  if (typeof showPageNo !== "boolean") {
    return res.status(400).json({
      code: 400,
      message: "showPageNo must be a boolean value",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  try {
    logger.info(`[${requestId}] Starting PDF generation for ${url}`);
    const cluster = await setupCluster();

    const result = await cluster.execute(
      { url, filename, showPageNo, requestId },
      async ({ page, data }) => {
        const deviceName = "iPad Pro";
        const device = mobileDevices[deviceName];

        await page.setUserAgent(device.userAgent);
        await page.setViewport(device.viewport);

        await page.goto(data.url, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });

        await captureFullPage(page, data.requestId);

        const a4Width = 794;
        const a4Height = 1123;
        let scale = Math.min(a4Width / device.viewport.width, 2);
        scale = Math.max(scale, 0.1);

        await page.evaluate(() => {
          const style = document.createElement("style");
          style.textContent = `
                    @page:first { margin-top: 0; margin-bottom: 0; }
                    @page { margin-top: 5mm; margin-bottom: 10mm; }
                    body, html { background-color: white !important; }
                `;
          document.head.appendChild(style);
        });

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
      message: "PDF generated and saved successfully",
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

  if (typeof showPageNo !== "boolean") {
    return res.status(400).json({
      code: 400,
      message: "showPageNo must be a boolean value",
      fileName: null,
      success: false,
      timestamp: Date.now(),
      requestId,
    });
  }

  try {
    logger.info(`[${requestId}] Starting PDF stream generation for ${url}`);
    const cluster = await setupCluster();

    const pdfBuffer = await cluster.execute(
      { url, filename, showPageNo, requestId },
      async ({ page, data }) => {
        const deviceName = "iPad Pro";
        const device = mobileDevices[deviceName];

        await page.setUserAgent(device.userAgent);
        await page.setViewport(device.viewport);

        await page.goto(data.url, {
          waitUntil: "networkidle0",
          timeout: 60000,
        });

        await captureFullPage(page, data.requestId);

        const a4Width = 794;
        const a4Height = 1123;
        let scale = Math.min(a4Width / device.viewport.width, 2);
        scale = Math.max(scale, 0.1);

        await page.evaluate(() => {
          const style = document.createElement("style");
          style.textContent = `
                    @page:first { margin-top: 0; margin-bottom: 0; }
                    @page { margin-top: 5mm; margin-bottom: 10mm; }
                    body, html { background-color: white !important; }
                `;
          document.head.appendChild(style);
        });

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

    logger.info(`[${requestId}] PDF stream sent successfully for ${url}`);
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
  }
}

app.post("/screenshot", (req, res) => {
  // requestQueue.push({
  //     handler: handleScreenshot,
  //     req: req,
  //     res: res
  // });
  handleScreenshot(req, res);
});

app.post("/pdf", (req, res) => {
  // requestQueue.push({
  //     handler: handlePdf,
  //     req: req,
  //     res: res
  // });
  handlePdf(req, res);
});

app.post("/pdf/stream", (req, res) => {
  // requestQueue.push({
  //     handler: handleStream,
  //     req: req,
  //     res: res
  // });
  handleStream(req, res);
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

startServer();
