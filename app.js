const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const http = require('http');

const chromiumExecutablePath = path.join(process.cwd(), 'chrome-win64', 'chrome.exe');

const app = express();
app.use(express.json());

// 定义一些常用的移动设备配置
const mobileDevices = {
    'iPhone X': {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
        viewport: {
            width: 375,
            height: 812,
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
            isLandscape: false
        }
    },
    'Pixel 2': {
        userAgent: 'Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
        viewport: {
            width: 411,
            height: 731,
            deviceScaleFactor: 2.625,
            isMobile: true,
            hasTouch: true,
            isLandscape: false
        }
    },
    'iPad Pro': {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
        viewport: {
            width: 1024,
            height: 1366,
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            isLandscape: false
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
app.post('/screenshot', async (req, res) => {
    const {url, filename, deviceName = 'iPad Pro', width} = req.body;

    if (!url) {
        return res.status(400).send('URL is required');
    }
    if (!filename) {
        return res.status(400).send('Filename is required');
    }
    if (width && isNaN(parseInt(width))) {
        return res.status(400).send('Width must be a valid number');
    }

    try {
        console.log(`Starting screenshot capture for ${url} on ${deviceName}`);

        const browser = await puppeteer.launch({
            executablePath: chromiumExecutablePath
        });
        const page = await browser.newPage();

        const device = mobileDevices[deviceName];
        if (!device) {
            throw new Error(`Device "${deviceName}" not found`);
        }

        let viewport = {...device.viewport};
        if (width) {
            viewport.width = parseInt(width);
        }

        await page.setUserAgent(device.userAgent);
        await page.setViewport(viewport);

        console.log('Navigating to page...');
        await page.goto(url, {waitUntil: 'networkidle0', timeout: 60000});

        console.log('Processing and capturing page...');
        const screenshot = await captureFullPage(page);

        await browser.close();

        const filePath = processFilename(filename, 'png', 'screenshots');

        // 将base64截图数据转换为buffer并保存为文件
        const base64Data = screenshot.replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(filePath, base64Data, 'base64');

        console.log(`Screenshot saved successfully to ${filePath}`);

        res.status(200).json({
            message: 'Screenshot generated and saved successfully',
            filePath,
            fileName: path.basename(filePath)
        });
    } catch (err) {
        console.error('Error details:', err);
        let errorInfo = err.message;
        if (err.stack) {
            errorInfo += '\n\nStack trace:\n' + err.stack;
        }
        res.status(500).send('Failed to capture full page mobile screenshot: ' + errorInfo);
    }
});

async function captureFullPage(page) {
    // 滚动到底部以触发懒加载内容
    await autoScroll(page);

    // 慢慢滚动回顶部，同时观察页面高度变化
    let maxHeight = await getPageHeight(page);
    await slowScrollToTop(page, async (currentHeight) => {
        if (currentHeight > maxHeight) {
            maxHeight = currentHeight;
            console.log(`New max height: ${maxHeight}`);
        }
    });

    // 设置足够大的视口高度
    await page.setViewport({
        width: page.viewport().width,
        height: maxHeight
    });

    // 再次滚动到底部确保所有内容都已加载
    await autoScroll(page);

    // 捕获整个页面的截图
    console.log(`Capturing screenshot with height: ${maxHeight}`);
    const screenshot = await page.screenshot({
        width: `${page.viewport().width}px`,
        encoding: 'base64'
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
app.post('/pdf', async (req, res) => {
    const {url, filename, deviceName = 'iPad Pro', width} = req.body;

    if (!url) {
        return res.status(400).send('URL is required');
    }
    if (!filename) {
        return res.status(400).send('Filename is required');
    }
    if (width && isNaN(parseInt(width))) {
        return res.status(400).send('Width must be a valid number');
    }

    try {
        console.log(`Starting PDF generation for ${url} on ${deviceName}`);

        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: chromiumExecutablePath
        });
        const page = await browser.newPage();

        const device = mobileDevices[deviceName];
        if (!device) {
            throw new Error(`Device "${deviceName}" not found, now available devices are [iPhone X] or [Pixel 2] (Pay attention to capitalization and spaces)`);
        }

        let viewport = {...device.viewport};
        if (width) {
            viewport.width = parseInt(width);
        }

        await page.setUserAgent(device.userAgent);
        await page.setViewport(viewport);

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        console.log('Navigating to page...');
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        console.log('Processing and capturing full page...');
        await captureFullPage(page);

        console.log('Generating PDF...');

        const pdfOptions = {
            width: width ? `${width}px` : `${device.viewport.width}px`,
            printBackground: true,
        };

        const pdf = await page.pdf(pdfOptions);

        console.log('PDF generated successfully');

        await browser.close();

        const filePath = processFilename(filename, 'pdf', 'pdfs');

        fs.writeFileSync(filePath, pdf);

        console.log(`PDF saved successfully to ${filePath}`);

        res.status(200).json({
            message: 'PDF generated and saved successfully',
            filePath,
            fileName: path.basename(filePath)
        });
    } catch (err) {
        console.error('Error details:', err);
        let errorInfo = err.message;
        if (err.stack) {
            errorInfo += '\n\nStack trace:\n' + err.stack;
        }
        res.status(500).send('Failed to generate PDF: ' + errorInfo);
    }
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
    const preferredPort = process.env.PORT || 3065;
    try {
        const PORT = await findAvailablePort(preferredPort);
        app.listen(PORT, () => {
            console.log('Available device models:');
            console.log('【当前可用的设备型号有:】');
            Object.keys(mobileDevices).forEach(device => {
                console.log(`- ${device} (${mobileDevices[device].viewport.width}x${mobileDevices[device].viewport.height})`);
            });

            console.log('\nEndpoints:');
            console.log('【接口名称:】');
            console.log('1. POST /screenshot');
            console.log('2. POST /pdf');
            console.log('   Required parameters: url, filename');
            console.log('   Optional parameters: deviceName, width (If neither deviceName nor width is provided, the default is to use iPad Pro to display the desktop interface; if both deviceName and width are provided, width will take precedence).');
            console.log('   【必填参数: url, filename】');
            console.log('   【可选参数: deviceName, width（如果不传deviceName和width，默认使用iPad Pro展示桌面端界面；若同时传了deviceName和width，会优先使用width）】');

            console.log(`\nServer is running on port ${PORT}`);
            console.log(`【服务器正在运行在 ${PORT} 端口】`);
        });
    } catch (err) {
        console.error('启动服务器失败:', err);
    }
};

startServer();


