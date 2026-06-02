# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebCaptureService is a Node.js application that provides web page screenshot and PDF generation services with mobile device simulation capabilities. The service uses Puppeteer with a cluster architecture for high-performance parallel processing.

## Common Commands

### Development
- `npm start` - Start the application with garbage collection enabled
- `npm run start:test` - Start in test environment mode
- `npm install` - Install dependencies

### Building
- `npm run build` - Build executable for production using pkg
- `npm run build:test` - Build executable in test mode

### Testing
- `node stress-test-client.js` - Run stress tests for the service
- `node concurrent-test.js` - Run concurrent load tests

## Core Architecture

### Puppeteer Cluster Management
- Uses `puppeteer-cluster` for parallel page processing
- Maximum concurrent workers: 10
- Automatic cluster switching with standby clusters for memory management
- Memory monitoring with automatic restart/cluster switching when usage > 80%
- Request timeout: 180 seconds with 3 retry attempts

### API Endpoints
- `POST /screenshot` - Generate webpage screenshots with device simulation
- `POST /pdf` - Generate PDF files with optional page numbers and watermarks
- `GET /pdf-stream/:filename` - Stream PDF files for download
- `GET /api-docs` - Swagger API documentation
- `GET /redoc` - ReDoc API documentation

### PDF Generation Parameters
Both `POST /pdf` (saves to `/pdfs`) and `POST /pdf/stream` (returns a file stream) accept the same request body. There is **no `version` field** — header / footer / cover / page number are four **independent** controls. Field parsing helpers in `app.js`: `getPdfHeader`, `getPdfShowFooter`, `getPdfShowPageNo`, `getPdfCoverUrl`, `getPdfWaitTime`.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `url` | string | — | Required. Target page URL. |
| `filename` | string | — | Required. Output name (no `.pdf` suffix). |
| `header` | object `{left, center, right}` | — | Three-column free-text page header (also accepts a JSON string). All-empty or omitted → no header. Rendered with a bottom divider line. |
| `footer` | boolean | `false` | Show the fixed source-text footer (`数据来源：…` + icon). **Does not** include the page number. |
| `showPageNo` | boolean | `true` | Page-number switch, **independent** of `footer`. Empty value = not passed. |
| `cover` | string (URL) | — | Cover image URL. A cover page is prepended **only if** the URL is provided AND the image actually loads. Not passed or unreachable → no cover. |
| `timeOut` | number (seconds) | `0` | Wait this many seconds **after page capture, right before `page.pdf()`** (so transient toasts/animations re-triggered during capture have time to disappear before generation). Capped at 60s (`PDF_MAX_WAIT_TIME`). |

Default (nothing passed): page number only — no header, no footer, no cover.

### PDF Header / Footer / Page Number
- Built by `applyPdfHeaderFooterOptions` + `buildPdfHeaderTemplate` / `buildPdfFooterTemplate` / `buildPdfPageNumberHtml` (Chromium `displayHeaderFooter`).
- Margins are applied per side: top margin only when a header is shown, bottom margin only when footer **or** page number is shown. If none are active, `displayHeaderFooter` is `false`.
- Page number (centered) and the source-text footer (right) are independent blocks that share the bottom footer template.

### PDF Cover Page Mechanism
- The cover image URL comes from the request `cover` field (dynamic; no hard-coded constant), rendered as a full-bleed A4 page.
- The cover is generated as a **separate** single-page PDF with no header/footer/page number, then merged before the body PDF via `pdf-lib` (`mergePdfBuffers`). Because the body PDF is numbered independently (`1..N`), page numbering naturally starts from the first body page and the cover is never counted.
- `generatePdfCoverBuffer(page, requestId, coverUrl)` loads the cover image with up to `PDF_COVER_MAX_RETRIES` (default 2) attempts (`PDF_COVER_LOAD_TIMEOUT`, default 3s each); the whole cover step is additionally bounded by an overall `PDF_COVER_TOTAL_TIMEOUT` (default 8s) hard cap at the call site via `Promise.race`. If the image still cannot be loaded (verified via `img.naturalWidth > 0`) or the cap is exceeded, it returns `null` and the cover is **skipped** — preventing a blank/white cover page.

### PDF Page Capture & getData Waiting
- The PDF flow calls `preparePageForPdf(page, requestId)` — it scrolls (triggers lazy-load), sizes the viewport, and waits for page data, but **does not** take a screenshot. The full-page screenshot in `captureFullPage` is used **only** by `POST /screenshot`; the PDF body is rendered independently by `page.pdf()`.
- **getData waiting** (`createGetDataWaiter`): the `/reportView/getData` listener is registered **before** scrolling so requests fired during navigation/scroll are not missed (fixes a race that previously caused a fixed 30s wait). If no `getData` is ever observed, capture continues after `PDF_GETDATA_IDLE_GRACE` (default 1.5s) instead of blocking. If a `getData` is observed, it waits for completion up to `PDF_GETDATA_TIMEOUT` (default 15s); on timeout it **proceeds** (resolves, no longer rejects). A genuinely failed request still rejects and is caught so capture continues.
- The page uses **no request interception** (a previous no-op `setRequestInterception(true)` + `request.continue()` was removed, restoring Chromium's network cache).

### Device Simulation
Pre-configured mobile devices in `mobileDevices` object:
- iPhone X (375x812, mobile)
- iPad Pro (1024x1366, tablet)
- Custom viewport support via `width` parameter

### File Management
- Screenshots saved to `/screenshots` directory
- PDFs saved to `/pdfs` directory
- Automatic watermark addition to generated files
- File cleanup and memory management

### Logging and Monitoring
- Winston logger with Beijing timezone
- Real-time memory monitoring (30-second intervals)
- PM2 integration for process management
- Comprehensive error handling with automatic recovery

### Configuration
- Default port: 3065 (configurable via `PORT` environment variable)
- Chrome executable path: auto-detected based on OS
- CORS enabled for `http://localhost:3100`
- Memory thresholds configurable via environment variables
- PDF tuning env vars (all optional, with defaults): `PDF_GETDATA_TIMEOUT` (15000), `PDF_GETDATA_IDLE_GRACE` (1500), `PDF_COVER_MAX_RETRIES` (2), `PDF_COVER_LOAD_TIMEOUT` (3000), `PDF_COVER_TOTAL_TIMEOUT` (8000)

## Key Dependencies
- **puppeteer**: Page rendering and automation
- **puppeteer-cluster**: Parallel processing
- **express**: Web framework
- **winston**: Logging
- **better-queue**: Request queuing
- **swagger-ui-express**: API documentation
- **pm2**: Process management
- **cors**: Cross-origin resource sharing
- **pdf-lib**: Merge the cover page with the body PDF (pure JS, compatible with `pkg` build)

## Development Notes
- The application uses memory-intensive operations, monitor system resources
- Cluster switching mechanism prevents memory leaks during long-running operations
- Error recovery includes automatic service restart via PM2
- All generated files include automatic watermark protection
- PDF generation supports A4 format (794x1123 pixels)

## Language Preferences
- 默认使用中文回复