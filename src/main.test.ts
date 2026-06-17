// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vite-plus/test";

// Mock standard browser APIs
const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
});

Object.defineProperty(global.navigator, "mediaDevices", {
  value: {
    getUserMedia: mockGetUserMedia,
  },
  writable: true,
});

Object.defineProperty(global.navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
});

const mockRegister = vi.fn().mockResolvedValue({});

Object.defineProperty(global.navigator, "serviceWorker", {
  value: {
    register: mockRegister,
  },
  writable: true,
});

Object.defineProperty(global.navigator, "vibrate", {
  value: vi.fn(),
  writable: true,
});

// Mock HTMLCanvasElement getContext
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  drawImage: vi.fn(),
  getImageData: vi.fn().mockReturnValue({
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
  }),
  createImageData: vi.fn().mockImplementation((w, h) => {
    return {
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    };
  }),
  putImageData: vi.fn(),
  clearRect: vi.fn(),
}) as any;

// Mock HTMLCanvasElement toDataURL
HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue("data:image/png;base64,mock");

// Mock HTMLVideoElement play
HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

describe("QR Code WebApp Test Suite", () => {
  beforeAll(async () => {
    // Setup initial DOM once
    document.body.innerHTML = `
      <div class="tabs">
        <button class="tab-btn active" id="tab-scan-btn">Scan QR</button>
        <button class="tab-btn" id="tab-generate-btn">Generate QR</button>
      </div>
      <div id="scan-tab" class="view-panel active">
        <div class="camera-container">
          <video id="video" autoplay playsinline muted></video>
        </div>
        <div class="result-box" id="result-box" style="display: none;">
          <div class="result-text" id="scan-result-text"></div>
          <button class="btn btn-secondary" id="btn-copy">Copy</button>
          <button class="btn" id="btn-open-link" style="display: none;">Open Link</button>
        </div>
      </div>
      <div id="generate-tab" class="view-panel">
        <textarea id="qr-input" placeholder="Type..."></textarea>
        <div class="qr-output-container" id="qr-output" style="display: none;">
          <canvas id="qr-canvas"></canvas>
          <button class="btn btn-secondary" id="btn-download">Download PNG</button>
        </div>
      </div>
      <div class="toast" id="toast">Copied to clipboard!</div>
    `;

    // Import main to trigger initialization logic
    await import("./main.ts");
  });

  beforeEach(() => {
    // Reset inputs and tabs to default state
    const qrInput = document.getElementById("qr-input") as HTMLTextAreaElement;
    const qrOutput = document.getElementById("qr-output") as HTMLDivElement;
    const tabScanBtn = document.getElementById("tab-scan-btn") as HTMLButtonElement;

    qrInput.value = "";
    qrOutput.style.display = "none";

    // Switch back to scan tab if generate tab is active
    if (!tabScanBtn.classList.contains("active")) {
      tabScanBtn.click();
    }
  });

  it("should initialize and register Service Worker", () => {
    // Check service worker registration
    expect(mockRegister).toHaveBeenCalledWith("/sw.js");
  });

  it("should switch tabs correctly", () => {
    const tabScanBtn = document.getElementById("tab-scan-btn") as HTMLButtonElement;
    const tabGenerateBtn = document.getElementById("tab-generate-btn") as HTMLButtonElement;
    const scanTab = document.getElementById("scan-tab") as HTMLDivElement;
    const generateTab = document.getElementById("generate-tab") as HTMLDivElement;

    // Initially scan tab is active
    expect(tabScanBtn.classList.contains("active")).toBe(true);
    expect(scanTab.classList.contains("active")).toBe(true);
    expect(generateTab.classList.contains("active")).toBe(false);

    // Switch to generate tab
    tabGenerateBtn.click();

    expect(tabGenerateBtn.classList.contains("active")).toBe(true);
    expect(tabScanBtn.classList.contains("active")).toBe(false);
    expect(generateTab.classList.contains("active")).toBe(true);
    expect(scanTab.classList.contains("active")).toBe(false);
  });

  it("should handle QR generation input changes", async () => {
    const qrInput = document.getElementById("qr-input") as HTMLTextAreaElement;
    const qrOutput = document.getElementById("qr-output") as HTMLDivElement;

    // Output is initially hidden
    expect(qrOutput.style.display).toBe("none");

    // Enter input
    qrInput.value = "https://google.com";
    qrInput.dispatchEvent(new Event("input"));

    // Canvas rendering is async/event-driven, wait a brief moment
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Output should be shown
    expect(qrOutput.style.display).toBe("flex");
  });

  it("should download generated QR code", () => {
    const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    btnDownload.click();

    expect(clickSpy).toHaveBeenCalled();
  });
});
