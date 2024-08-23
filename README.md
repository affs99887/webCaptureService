# WebCaptureService

WebCaptureService 是一个基于 Node.js 的应用程序，提供网页截图和 PDF 生成服务，支持模拟多种移动设备。

## 功能特性

- **网页截图**: 生成模拟移动设备视图的网页截图。
- **PDF 生成**: 根据移动设备的视口设置创建网页的 PDF 文件。
- **多设备支持**: 预配置多种常见移动设备，支持自定义扩展。

## 环境要求

- **Node.js**: 版本 >= 18.16.0

## 使用指南

1. 安装依赖：`npm install`
2. 启动服务器：`npm start`
3. 服务器将在首次运行时自动下载 Chrome
4. 访问 [http://localhost:3065](http://localhost:3065) 使用应用

服务器将默认运行在 `3065` 端口上，您也可以通过 `PORT` 环境变量来指定端口。

### API 端点

#### 1. 生成截图

- **URL**: `/screenshot`
- **方法**: `POST`
- **请求体**:
  ```json
  {
    "url": "https://example.com",
    "filename": "example.png",
    "deviceName": "iPhone X",
    "width": "375"
  }
  ```
- **响应**: 返回包含消息和文件路径的 JSON 对象，文件保存在 `screenshots` 文件目录下。

#### 2. 生成 PDF

- **URL**: `/pdf`
- **方法**: `POST`
- **请求体**:
  ```json
  {
    "url": "https://example.com",
    "filename": "example.pdf",
    "deviceName": "iPad Pro",
    "width": "1024"
  }
  ```
- **响应**: 返回包含消息和文件路径的 JSON 对象，文件保存在 `pdfs` 文件目录下。

### 支持的设备

预设设备包括：

- **手机端页面**:
    - iPhone X
    - Pixel 2

- **桌面页面**:
    - iPad Pro

您可以在代码中的 `mobileDevices` 对象中添加更多设备配置。

### 注意事项

- **可选参数**: `deviceName`, `width`  
  如果不传 `deviceName` 和 `width`，默认使用 iPad Pro 展示桌面端界面；若同时传了 `deviceName` 和 `width`，会优先使用 `width`。

## 构建可执行文件

要为 Windows x64 构建可执行文件，请执行以下步骤：

1. 全局安装 `pkg`（如果尚未安装）：
   ```bash
   npm install -g pkg
   ```

2. 构建可执行文件：
   ```bash
   pkg . --public
   ```

生成的可执行文件将存放在 `dist` 目录中。

## 已知问题

### 报错 ReferenceError: ReadableStream is not defined

请升级 Node.js 版本，项目使用的版本为 18.16.0，请至少升级到该版本以上。

## 许可证

该项目使用 [MIT 许可证](LICENSE)。

## 作者信息

- **Laidx**
- **Dengyz（技术援助）**
