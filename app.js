const express = require('express');
const puppeteer = require('puppeteer');

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
    }
    // 你可以在这里添加更多设备
};

// 生成网页截图并返回 base64
app.post('/screenshot', async (req, res) => {
    const { url, deviceName = 'iPhone X' } = req.body;

    if (!url) {
        return res.status(400).send('URL is required');
    }
    try {
        console.log(`Starting screenshot capture for ${url} on ${deviceName}`);

        const browser = await puppeteer.launch();
        const page = await browser.newPage();

        const device = mobileDevices[deviceName];
        if (!device) {
            throw new Error(`Device "${deviceName}" not found`);
        }

        await page.setUserAgent(device.userAgent);
        await page.setViewport(device.viewport);

        console.log('Navigating to page...');
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

        console.log('Processing and capturing page...');
        const screenshot = await captureFullPage(page);

        await browser.close();

        console.log('Screenshot captured successfully');

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename=screenshot-${deviceName}.txt`);

        res.send(screenshot);

        console.log('Screenshot base64 sent successfully as text file');
    } catch (err) {
        console.error('Error details:', err);
        res.status(500).send('Failed to capture full page mobile screenshot: ' + err.message);
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
        fullPage: true,
        encoding: 'base64'
    });

    return `data:image/png;base64,${screenshot}`;
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.documentElement.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
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
    const { url } = req.body;

    if (!url) {
        return res.status(400).send('URL is required');
    }

    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        const pdf = await page.pdf({ format: 'A4' });
        await browser.close();

        res.set('Content-Type', 'application/pdf');
        res.send(pdf);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to generate PDF');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
