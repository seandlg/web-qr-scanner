import jsQR from "jsqr";
import QRCode from "qrcode";

// Native interface declaration for TypeScript compilation
declare global {
  class BarcodeDetector {
    constructor(options?: { formats: string[] });
    detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
  }
}

// ---------------- DOM ELEMENTS ----------------
const tabScanBtn = document.getElementById("tab-scan-btn") as HTMLButtonElement;
const tabGenerateBtn = document.getElementById("tab-generate-btn") as HTMLButtonElement;
const scanTab = document.getElementById("scan-tab") as HTMLDivElement;
const generateTab = document.getElementById("generate-tab") as HTMLDivElement;

const video = document.getElementById("video") as HTMLVideoElement;
const resultBox = document.getElementById("result-box") as HTMLDivElement;
const resultText = document.getElementById("scan-result-text") as HTMLDivElement;
const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;
const btnOpenLink = document.getElementById("btn-open-link") as HTMLButtonElement;

const qrInput = document.getElementById("qr-input") as HTMLTextAreaElement;
const qrOutput = document.getElementById("qr-output") as HTMLDivElement;
const qrCanvas = document.getElementById("qr-canvas") as HTMLCanvasElement;
const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
const toast = document.getElementById("toast") as HTMLDivElement;

// ---------------- STATE VARIABLES ----------------
let currentTab: "scan" | "generate" = "scan";
let stream: MediaStream | null = null;
let scanning = false;
let animationFrameId: number | null = null;
let lastScannedData = "";
let nativeDetector: any = null;

const processingCanvas = document.createElement("canvas");
const processingContext = processingCanvas.getContext("2d");

// Instantiate Native API if available
if ("BarcodeDetector" in window) {
  try {
    nativeDetector = new BarcodeDetector({ formats: ["qr_code"] });
  } catch (e) {
    console.warn("BarcodeDetector initialization failed:", e);
  }
}

// ---------------- TAB HANDLING ----------------
function switchTab(tab: "scan" | "generate") {
  if (currentTab === tab) return;
  currentTab = tab;

  tabScanBtn.classList.toggle("active", tab === "scan");
  tabGenerateBtn.classList.toggle("active", tab === "generate");
  scanTab.classList.toggle("active", tab === "scan");
  generateTab.classList.toggle("active", tab === "generate");

  if (tab === "scan") {
    void startCamera();
  } else {
    stopCamera();
  }
}

tabScanBtn.addEventListener("click", () => switchTab("scan"));
tabGenerateBtn.addEventListener("click", () => switchTab("generate"));

// ---------------- CAMERA STREAMS & SCAN LOOP ----------------
async function startCamera() {
  if (scanning) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    await video.play();

    scanning = true;
    lastScannedData = "";
    animationFrameId = requestAnimationFrame(scanLoop);
  } catch (err) {
    console.error("Camera acquisition failure:", err);
    alert("Camera permission is required to scan QR codes.");
  }
}

function stopCamera() {
  scanning = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
}

let lastScanTime = 0;
const SCAN_INTERVAL = 200; // Run scanning passes 5 times per second to save battery

async function scanLoop(timestamp: number) {
  if (!scanning) return;

  if (timestamp - lastScanTime >= SCAN_INTERVAL) {
    lastScanTime = timestamp;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      let rawResult: string | null = null;

      // 1. Primary Attempt: Native Hardware API
      if (nativeDetector) {
        try {
          const results = await nativeDetector.detect(video);
          if (results.length > 0) {
            rawResult = results[0].rawValue;
          }
        } catch (e) {
          console.debug("Native decoder check bypassed:", e);
        }
      }

      // 2. Secondary Attempt: Pure JavaScript Fallback (Offline Ready)
      if (!rawResult && processingContext) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        processingCanvas.width = width;
        processingCanvas.height = height;
        processingContext.drawImage(video, 0, 0, width, height);

        const imgData = processingContext.getImageData(0, 0, width, height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code) {
          rawResult = code.data;
        }
      }

      if (rawResult && rawResult !== lastScannedData) {
        handleScanSuccess(rawResult);
      }
    }
  }

  animationFrameId = requestAnimationFrame(scanLoop);
}

function handleScanSuccess(data: string) {
  lastScannedData = data;

  if (navigator.vibrate) {
    navigator.vibrate(100);
  }

  resultText.textContent = data;
  resultBox.style.display = "flex";

  // Display 'Open Link' button if value is a valid HTTP(S) URL
  try {
    const parsed = new URL(data);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      btnOpenLink.style.display = "inline-flex";
    } else {
      btnOpenLink.style.display = "none";
    }
  } catch {
    btnOpenLink.style.display = "none";
  }
}

// ---------------- SCAN ACTION CONTROLS ----------------
btnCopy.addEventListener("click", () => {
  if (lastScannedData) {
    navigator.clipboard
      .writeText(lastScannedData)
      .then(() => {
        showToast("Copied to clipboard!");
      })
      .catch((err) => {
        console.error("Failed to copy: ", err);
      });
  }
});

btnOpenLink.addEventListener("click", () => {
  if (lastScannedData.startsWith("http://") || lastScannedData.startsWith("https://")) {
    window.open(lastScannedData, "_blank", "noopener,noreferrer");
  }
});

// ---------------- GENERATION HANDLING ----------------
qrInput.addEventListener("input", () => {
  const value = qrInput.value.trim();
  if (!value) {
    qrOutput.style.display = "none";
    return;
  }

  QRCode.toCanvas(
    qrCanvas,
    value,
    {
      width: 300,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
      errorCorrectionLevel: "H",
    },
    (err) => {
      if (err) {
        console.error(err);
      } else {
        qrOutput.style.display = "flex";
      }
    },
  );
});

btnDownload.addEventListener("click", () => {
  const dataUrl = qrCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = `qr-code-${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
});

// ---------------- TOAST POPUP ----------------
function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

// ---------------- INITIALIZATION & SERVICE WORKER ----------------
function init() {
  void startCamera();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => console.log("Service Worker registered successfully"))
      .catch((err) => console.warn("Service Worker registration failed:", err));
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopCamera();
  } else if (currentTab === "scan") {
    void startCamera();
  }
});
