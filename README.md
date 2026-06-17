# QR Link

A secure, offline-first QR code scanner and generator designed as a Progressive Web App (PWA).

## Features & Promises

- **WASM Powered**: Uses the C++ ZBar engine compiled to WebAssembly (`@undecaf/zbar-wasm`) for fast, local barcode and QR code decoding.
- **100% Local**: Zero network requests. Camera processing and QR generation happen entirely inside your browser.
- **Open Source (FOSS)**: Clean code, no tracking, no cookies, no dependencies on remote CDNs.

## Getting Started

This project uses [Vite+](https://viteplus.dev/) (Vite, Rolldown, tsdown, Vitest) and `pnpm`.

### Install Dependencies

```bash
vp install
```

### Start Development Server

```bash
vp dev
```

### Build for Production

Generates optimized static assets under `/dist` and bundles the WebAssembly binary for offline caching.

```bash
vp build
```

### Run Tests

```bash
vp test run
```
