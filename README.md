
# WebCaptureService

WebCaptureService 是一个基于 Node.js 的应用程序，提供网页截图和 PDF 生成服务，支持模拟多种移动设备。

## 功能特性

- **网页截图**: 生成模拟移动设备视图的网页截图
- **PDF 生成**: 根据移动设备的视口设置创建网页的 PDF 文件
- **多设备支持**: 预配置多种常见移动设备，支持自定义扩展

## 环境要求

- **Node.js**: 版本 >= 18.16.0

## 安装步骤

1. **克隆仓库**：
   ```bash
   git clone https://github.com/yourusername/webcaptureservice.git
   ```

2. **进入项目目录**：
   ```bash
   cd webcaptureservice
   ```

3. **安装依赖**：
   ```bash
   npm install
   ```

## 使用指南

### 启动服务器

使用以下命令启动服务器：
```bash
npm start
```
服务器将默认运行在 `3000` 端口上，您也可以通过 `PORT` 环境变量来指定端口。

### API 端点

#### 1. 生成截图

- **URL**: `/screenshot`
- **方法**: `POST`
- **请求体**:
  ```json
  {
    "url": "https://example.com",
    "deviceName": "iPhone X"
  }
  ```
- **响应**: 返回 Base64 编码的截图文件内容

#### 2. 生成 PDF

- **URL**: `/pdf`
- **方法**: `POST`
- **请求体**:
  ```json
  {
    "url": "https://example.com",
    "filename": "example.pdf",
    "deviceName": "iPhone X"
  }
  ```
- **响应**: 返回包含消息和文件路径的 JSON 对象

### 支持的设备

预设设备包括：
- iPhone X
- Pixel 2

您可以在代码中的 `mobileDevices` 对象中添加更多设备配置。

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

## 许可证

该项目使用 [MIT 许可证](LICENSE)。

## 作者信息

- **Laidx**
- **Dengyz**
