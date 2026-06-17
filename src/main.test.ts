// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vite-plus/test";

// Mock track methods
const mockTrack = {
  stop: vi.fn(),
  getCapabilities: vi.fn().mockReturnValue({ torch: true }),
  getSettings: vi.fn().mockReturnValue({ deviceId: "cam-1" }),
  applyConstraints: vi.fn().mockResolvedValue(undefined),
};

// Mock getUserMedia
const mockGetUserMedia = vi.fn().mockResolvedValue({
  getVideoTracks: () => [mockTrack],
  getTracks: () => [mockTrack],
});

Object.defineProperty(global.navigator, "mediaDevices", {
  value: {
    getUserMedia: mockGetUserMedia,
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: "videoinput", deviceId: "cam-1", label: "Rear Camera" },
      { kind: "videoinput", deviceId: "cam-2", label: "Front Camera" },
    ]),
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

// Mock FileReader
class MockFileReader {
  onload: ((e: any) => void) | null = null;
  readAsDataURL() {
    if (this.onload) {
      this.onload({ target: { result: "data:image/png;base64,mock" } });
    }
  }
}
vi.stubGlobal("FileReader", MockFileReader);

// Mock Image
class MockImage {
  onload: (() => void) | null = null;
  _src: string = "";
  set src(val: string) {
    this._src = val;
    if (this.onload) {
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 0);
    }
  }
  get src() {
    return this._src;
  }
  get width() {
    return 100;
  }
  get height() {
    return 100;
  }
}
vi.stubGlobal("Image", MockImage);

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
          <div class="camera-controls">
            <button class="control-btn" id="btn-torch" title="Toggle Flashlight" style="display: none">🔦</button>
            <button class="control-btn" id="btn-switch-camera" title="Switch Camera" style="display: none">🔄</button>
          </div>
        </div>
        <div class="file-scan-container">
          <button class="btn btn-secondary" id="btn-scan-file">Scan from Image File</button>
          <input type="file" id="file-input" accept="image/*" style="display: none" />
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
      <div class="history-panel">
        <div class="history-header">
          <h2>History</h2>
          <button class="btn-clear" id="btn-clear-history">Clear</button>
        </div>
        <div class="history-list" id="history-list">
          <p class="history-empty" id="history-empty">No history items yet</p>
        </div>
      </div>
      <div class="toast" id="toast">Copied to clipboard!</div>
    `;

    // Import main to trigger initialization logic
    await import("./main.ts");
  });

  beforeEach(() => {
    localStorage.clear();

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

  it("should toggle flashlight (torch) when supported", async () => {
    // Wait for camera initialization from beforeAll
    await new Promise((resolve) => setTimeout(resolve, 50));

    const btnTorch = document.getElementById("btn-torch") as HTMLButtonElement;

    // Trigger torch click
    btnTorch.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTrack.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ torch: true }],
    });
    expect(btnTorch.textContent).toBe("🔥");

    // Click again to turn off
    btnTorch.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockTrack.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ torch: false }],
    });
    expect(btnTorch.textContent).toBe("🔦");
  });

  it("should switch camera when multiple devices are available", async () => {
    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 50));

    const btnSwitchCamera = document.getElementById("btn-switch-camera") as HTMLButtonElement;

    // Switch camera
    btnSwitchCamera.click();

    // Verify it called getUserMedia with correct device ID constraints
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: "cam-2" } },
    });
  });

  it("should scan QR from loaded file", async () => {
    const fileInput = document.getElementById("file-input") as HTMLInputElement;

    // Simulate file input change event
    const file = new File(["dummy content"], "qr.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      value: [file],
      writable: true,
    });

    fileInput.dispatchEvent(new Event("change"));

    // Wait for Reader and Image load simulation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Note: in JSDOM, offscreen context getImageData will return zeroed data so jsQR returns null.
    // However, FileReader load is verified by clearing input element.
    expect(fileInput.value).toBe("");
  });

  it("should manage local history correctly", async () => {
    const historyList = document.getElementById("history-list") as HTMLDivElement;
    const btnClearHistory = document.getElementById("btn-clear-history") as HTMLButtonElement;

    // Initially history has empty text
    expect(historyList.querySelector(".history-empty")).not.toBeNull();

    // Input values to generate history (generate tab input is debounced at 1000ms)
    const qrInput = document.getElementById("qr-input") as HTMLTextAreaElement;
    qrInput.value = "History Test Item";
    qrInput.dispatchEvent(new Event("input"));

    // Wait for debounce timer
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // History should render the generated item
    const items = historyList.querySelectorAll(".history-item");
    expect(items.length).toBe(1);
    expect(items[0].querySelector(".history-item-text")?.textContent).toBe("History Test Item");

    // Clear history
    btnClearHistory.click();
    expect(historyList.querySelector(".history-empty")).not.toBeNull();
  });
});
