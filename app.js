const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const winston = require('winston');
const process = require('process');
const Queue = require('better-queue');
const { Cluster } = require('puppeteer-cluster');
const cors = require("cors");
const { Readable } = require('stream');


const chromiumExecutablePath = path.join(process.cwd(), 'chrome-win64', 'chrome.exe');

const app = express();

const allowedOrigins = ['http://localhost:3100']; // 允许的源
app.use(cors({
    origin: function (origin, callback) {
        // 允许来自 allowedOrigins 的请求
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('不允许的 CORS 来源'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // 允许的方法
    allowedHeaders: ['Content-Type', 'Authorization'], // 允许的头部
    credentials: true, // 是否允许发送凭证
}));

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
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                timeout: 60000,
                protocolTimeout: 60000
            },
            timeout: 120000,
            retryLimit: 3,
            retryDelay: 5000,
        });

        cluster.on('taskerror', (err, data) => {
            logger.error(`Error processing task: ${err.message}`);
        });
    }
    return cluster;
}

// 配置日志功能

function getBeijingTime() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utc + 3600000 * 8);  // 北京时间为UTC+8
}

function generateSeparator() {
    const separatorLength = 50;
    return '='.repeat(separatorLength);
}

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, {recursive: true});
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp({
        format: () => getBeijingTime().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})
    }), winston.format.printf(({level, message, timestamp}) => {
        return `${timestamp} ${level}: ${message}`;
    })),
    transports: [new winston.transports.Console(), new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error'
    }), new winston.transports.File({filename: path.join(logsDir, 'app-status.log')})],
});

// 捕获未处理的异常
process.on('uncaughtException', async (error) => {
    logger.error('Uncaught Exception:', error);
    await logShutdown('Uncaught Exception');
});

// 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await logShutdown('Unhandled Promise Rejection');
});

// 捕获 SIGINT 信号（通常是通过 Ctrl+C 终止程序）
process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    if (cluster) {
        await cluster.close();
    }
    await logShutdown('SIGINT (Ctrl+C)');
    process.exit(0);
});

// 捕获 SIGTERM 信号（通常是系统请求终止程序）
process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    if (cluster) {
        await cluster.close();
    }
    await logShutdown('SIGTERM');
    process.exit(0);
});

// 记录程序关闭的函数
function logShutdown(reason) {
    return new Promise((resolve) => {
        const separator = generateSeparator();
        logger.info(separator);
        logger.info(`应用程序正在关闭。原因: ${reason}`);
        logger.info(`结束时间: ${getBeijingTime().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);

        // 手动结束日志记录并刷新到磁盘
        logger.end(() => {
            console.log('Logging completed');
            setTimeout(resolve, 1000); // 给予额外的时间确保日志被写入
        });
    });
}

// 在程序即将退出时记录日志
process.on('exit', (code) => {
    logger.info(`Application exiting with code: ${code}`);
});

// 创建请求队列
const requestQueue = new Queue(async function (task, cb) {
    try {
        const result = await task.handler(task.req, task.res);
        cb(null, result);
    } catch (error) {
        cb(error);
    }
}, {concurrent: 1});

// 定义一些常用的移动设备配置
const mobileDevices = {
    'iPhone X': {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
        viewport: {
            width: 375, height: 812, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false
        }
    }, 'Pixel 2': {
        userAgent: 'Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
        viewport: {
            width: 411, height: 731, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: false
        }
    }, 'iPad Pro': {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
        viewport: {
            width: 1024, height: 1366, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: false
        }
    }
};

// 处理文件名和路径的辅助函数
function processFilename(filename, extension, dirName) {
    // 移除任何现有的文件扩展名
    let baseName = path.basename(filename, path.extname(filename));

    // 添加正确的扩展名
    let fullFilename = `${baseName}.${extension}`;

    // 创建目录（如果不存在）
    let dir = path.join(process.cwd(), dirName);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
    }

    // 返回完整的文件路径
    return path.join(dir, fullFilename);
}

// 生成网页截图
async function handleScreenshot(req, res) {
    const {url, filename, deviceName = 'iPad Pro', width} = req.body;

    if (!url) {
        return res.status(400).json({
            code: 400, message: 'URL is required', fileName: null, success: false, timestamp: Date.now()
        });
    }
    if (!filename) {
        return res.status(400).json({
            code: 400, message: 'Filename is required', fileName: null, success: false, timestamp: Date.now()
        });
    }
    if (width && isNaN(parseInt(width))) {
        return res.status(400).json({
            code: 400, message: 'Width must be a valid number', fileName: null, success: false, timestamp: Date.now()
        });
    }

    try {
        logger.info(`Starting screenshot capture for ${url} on ${deviceName}`);
        const cluster = await setupCluster();

        const result = await cluster.execute({ url, filename, deviceName, width }, async ({ page, data }) => {
            const device = mobileDevices[data.deviceName];
            if (!device) {
                throw new Error(`Device "${data.deviceName}" not found`);
            }

            let viewport = { ...device.viewport };
            if (data.width) {
                viewport.width = parseInt(data.width);
            }

            await page.setUserAgent(device.userAgent);
            await page.setViewport(viewport);

            await page.goto(data.url, { waitUntil: 'networkidle0', timeout: 60000 });

            const screenshot = await captureFullPage(page);
            return screenshot;
        });

        const filePath = processFilename(filename, 'png', 'screenshots');
        const base64Data = result.replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(filePath, base64Data, 'base64');

        logger.info(`Screenshot saved successfully to ${filePath}`);

        res.status(200).json({
            code: 200,
            message: 'Screenshot generated and saved successfully',
            fileName: path.basename(filePath),
            success: true,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Error details:', err);
        logger.error('Error details:', err);
        let errorInfo = err.message;
        if (err.stack) {
            errorInfo += '\n\nStack trace:\n' + err.stack;
        }
        res.status(500).json({
            code: 500,
            message: 'Failed to capture full page mobile screenshot: ' + errorInfo,
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }
};

async function captureFullPage(page) {
    // 滚动到底部以触发懒加载内容
    await autoScroll(page);

    // 慢慢滚动回顶部，同时观察页面高度变化
    let maxHeight = await getPageHeight(page);
    await slowScrollToTop(page, async (currentHeight) => {
        if (currentHeight > maxHeight) {
            maxHeight = currentHeight;
            logger.info(`New max height: ${maxHeight}`);
        }
    });

    // 设置足够大的视口高度
    await page.setViewport({
        width: page.viewport().width, height: maxHeight
    });

    // 再次滚动到底部确保所有内容都已加载
    await autoScroll(page);

    // 捕获整个页面的截图
    logger.info(`Capturing screenshot with height: ${maxHeight}`);
    const screenshot = await page.screenshot({
        width: `${page.viewport().width}px`, encoding: 'base64'
    });

    return `data:image/png;base64,${screenshot}`;
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 300;  // 增加滚动距离
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 50);  // 减少间隔时间
        });
    });
}

async function slowScrollToTop(page, callback) {
    await page.evaluate(async (cb) => {
        await new Promise((resolve) => {
            const distance = -50;  // 向上滚动
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

// 生成PDF
async function handlePdf(req, res) {
    const {url, filename, showPageNo = true} = req.body;

    if (!url) {
        return res.status(400).json({
            code: 400, message: 'URL is required', fileName: null, success: false, timestamp: Date.now()
        });
    }
    if (!filename) {
        return res.status(400).json({
            code: 400, message: 'Filename is required', fileName: null, success: false, timestamp: Date.now()
        });
    }

    if (typeof showPageNo !== 'boolean') {
        return res.status(400).json({
            code: 400,
            message: 'showPageNo must be a boolean value',
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }

    try {
        logger.info(`Starting PDF generation for ${url}`);
        const cluster = await setupCluster();

        const result = await cluster.execute({ url, filename, showPageNo }, async ({ page, data }) => {
            const deviceName = 'iPad Pro';
            const device = mobileDevices[deviceName];

            await page.setUserAgent(device.userAgent);
            await page.setViewport(device.viewport);

            await page.goto(data.url, { waitUntil: 'networkidle0', timeout: 60000 });

            await captureFullPage(page);

            const a4Width = 794;
            const a4Height = 1123;
            let scale = Math.min(a4Width / device.viewport.width, 2);
            scale = Math.max(scale, 0.1);

            await page.evaluate(() => {
                const style = document.createElement('style');
                style.textContent = `
                    @page:first { margin-top: 0; margin-bottom: 0; }
                    @page { margin-top: 5mm; margin-bottom: 10mm; }
                    body, html { background-color: white !important; }
                `;
                document.head.appendChild(style);
            });

            const pdfOptions = {
                format: 'A4',
                printBackground: true,
                scale: scale,
                displayHeaderFooter: data.showPageNo,
                headerTemplate: '<span></span>',
                footerTemplate: data.showPageNo ? `
                    <div style="width: 100%; font-size: 10px; text-align: center; color: #808080; position: relative;">
                        <span style="position: absolute; left: 0; right: 0; top: -5px;">
                            <span class="pageNumber"></span>/<span class="totalPages"></span>
                        </span>
                    </div>
                ` : '<span></span>'
            };

            const pdf = await page.pdf(pdfOptions);
            return pdf;
        });

        const filePath = processFilename(filename, 'pdf', 'pdfs');
        fs.writeFileSync(filePath, result);

        logger.info(`PDF saved successfully to ${filePath}`);

        res.status(200).json({
            code: 200,
            message: 'PDF generated and saved successfully',
            fileName: path.basename(filePath),
            success: true,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Error details:', err);
        logger.error('Error details:', err);
        let errorInfo = err.message;
        if (err.stack) {
            errorInfo += '\n\nStack trace:\n' + err.stack;
        }
        res.status(500).json({
            code: 500,
            message: 'Failed to generate PDF: ' + errorInfo,
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }
};

// 生成并返回 PDF 文件流
async function handleStream(req, res) {
    const { url, filename, showPageNo = true } = req.body;

    if (!url) {
        return res.status(400).json({
            code: 400,
            message: 'URL is required',
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }
    if (!filename) {
        return res.status(400).json({
            code: 400,
            message: 'Filename is required',
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }

    if (typeof showPageNo !== 'boolean') {
        return res.status(400).json({
            code: 400,
            message: 'showPageNo must be a boolean value',
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }

    try {
        logger.info(`Starting PDF stream generation for ${url}`);
        const cluster = await setupCluster();

        const pdfBuffer = await cluster.execute({ url, filename, showPageNo }, async ({ page, data }) => {
            const deviceName = 'iPad Pro';
            const device = mobileDevices[deviceName];

            await page.setUserAgent(device.userAgent);
            await page.setViewport(device.viewport);

            await page.goto(data.url, { waitUntil: 'networkidle0', timeout: 60000 });

            await captureFullPage(page);

            const a4Width = 794;
            const a4Height = 1123;
            let scale = Math.min(a4Width / device.viewport.width, 2);
            scale = Math.max(scale, 0.1);

            await page.evaluate(() => {
                const style = document.createElement('style');
                style.textContent = `
                    @page:first { margin-top: 0; margin-bottom: 0; }
                    @page { margin-top: 5mm; margin-bottom: 10mm; }
                    body, html { background-color: white !important; }
                `;
                document.head.appendChild(style);
            });

            const pdfOptions = {
                format: 'A4',
                printBackground: true,
                scale: scale,
                displayHeaderFooter: data.showPageNo,
                headerTemplate: '<span></span>',
                footerTemplate: data.showPageNo ? `
                    <div style="width: 100%; font-size: 10px; text-align: center; color: #808080; position: relative;">
                        <span style="position: absolute; left: 0; right: 0; top: -5px;">
                            <span class="pageNumber"></span>/<span class="totalPages"></span>
                        </span>
                    </div>
                ` : '<span></span>'
            };

            const pdf = await page.pdf(pdfOptions);
            return pdf;
        });

        // 创建一个 Readable 流
        const stream = Readable.from([pdfBuffer]);

        // 设置响应头
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}.pdf"`,
            'Content-Length': pdfBuffer.length,
        });

        // 将流通过管道发送给客户端
        stream.pipe(res);

        logger.info(`PDF stream sent successfully for ${url}`);
    } catch (err) {
        console.error('Error details:', err);
        logger.error('Error details:', err);
        let errorInfo = err.message;
        if (err.stack) {
            errorInfo += '\n\nStack trace:\n' + err.stack;
        }
        res.status(500).json({
            code: 500,
            message: 'Failed to generate PDF stream: ' + errorInfo,
            fileName: null,
            success: false,
            timestamp: Date.now()
        });
    }
};


app.post('/screenshot', (req, res) => {
    // requestQueue.push({
    //     handler: handleScreenshot,
    //     req: req,
    //     res: res
    // });
    handleScreenshot(req, res);
});

app.post('/pdf', (req, res) => {
    // requestQueue.push({
    //     handler: handlePdf,
    //     req: req,
    //     res: res
    // });
    handlePdf(req, res);
});

app.post('/pdf/stream', (req, res) => {
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
            const {port} = server.address();
            server.close(() => {
                resolve(port);
            });
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
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
    logger.info('新的应用程序会话开始');
    logger.info(`启动时间: ${getBeijingTime().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`);

    const preferredPort = process.env.PORT || 3065;
    try {
        const PORT = await findAvailablePort(preferredPort);
        app.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT}`);
            console.log('Available device models:');
            console.log('【当前可用的设备型号有:】');
            Object.keys(mobileDevices).forEach(device => {
                console.log(`- ${device} (${mobileDevices[device].viewport.width}x${mobileDevices[device].viewport.height})`);
            });

            console.log('\nEndpoints:');
            console.log('【接口名称:】');
            console.log('1. POST /screenshot');
            console.log('   Required parameters: url, filename');
            console.log('   Optional parameters: deviceName, width (If neither deviceName nor width is provided, the default is to use iPad Pro to display the desktop interface; if both deviceName and width are provided, width will take precedence).');
            console.log('   【必填参数: url, filename】');
            console.log('   【可选参数: deviceName, width（如果不传deviceName和width，默认使用iPad Pro展示桌面端界面；若同时传了deviceName和width，会优先使用width）】');
            console.log('2. POST /pdf');
            console.log('   Required parameters: url, filename');
            console.log('   Optional parameters: showPageNo (Default value is true, if there is no need for displaying page numbers, sends false).');
            console.log('   【必填参数: url, filename】');
            console.log('   【可选参数: showPageNo（默认为true，若不需要页码显示，则传false）】');
            console.log('3. POST /pdf/stream');
            console.log('   Required parameters: url, filename');
            console.log('   Optional parameters: showPageNo (Default is true; set to false if page numbers are not needed).');
            console.log('   【必填参数: url, filename】');
            console.log('   【可选参数: showPageNo（默认为true，若不需要页码显示，则传false）】');


            console.log(`\nServer is running on port ${PORT}`);
            console.log(`【服务正在运行在 ${PORT} 端口】`);
        });
    } catch (err) {
        logger.error('Failed to start server:', err);
        console.error('启动服务器失败:', err);
    }
};

startServer();


