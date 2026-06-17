import "./style.css";
import { BarcodeDetectorPolyfill } from "@undecaf/barcode-detector-polyfill";
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

// Camera Toolbar and Placeholder Controls
const cameraPlaceholder = document.getElementById("camera-placeholder") as HTMLDivElement;
const btnEnableCamera = document.getElementById("btn-enable-camera") as HTMLButtonElement;
const btnTorch = document.getElementById("btn-torch") as HTMLButtonElement;
const btnSwitchCamera = document.getElementById("btn-switch-camera") as HTMLButtonElement;
const btnScanFile = document.getElementById("btn-scan-file") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;

// Generation Handling
const qrInput = document.getElementById("qr-input") as HTMLTextAreaElement;
const qrOutput = document.getElementById("qr-output") as HTMLDivElement;
const qrCanvas = document.getElementById("qr-canvas") as HTMLCanvasElement;
const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
const toast = document.getElementById("toast") as HTMLDivElement;

// History Panel
const historyList = document.getElementById("history-list") as HTMLDivElement;
const btnClearHistory = document.getElementById("btn-clear-history") as HTMLButtonElement;

// Dialog Modal
const infoDialog = document.getElementById("info-dialog") as HTMLDialogElement;
const btnInfo = document.getElementById("btn-info") as HTMLButtonElement;
const btnCloseDialog = document.getElementById("btn-close-dialog") as HTMLButtonElement;

// PWA Android/Chrome Prompts
const pwaInstallBanner = document.getElementById("pwa-install-banner") as HTMLDivElement;
const btnPwaInstall = document.getElementById("btn-pwa-install") as HTMLButtonElement;
const btnPwaDismiss = document.getElementById("btn-pwa-dismiss") as HTMLButtonElement;

// PWA iOS Safari Prompts
const pwaIosSheet = document.getElementById("pwa-ios-sheet") as HTMLDivElement;
const btnIosDismiss = document.getElementById("btn-ios-dismiss") as HTMLButtonElement;

// ---------------- STATE VARIABLES ----------------
let currentTab: "scan" | "generate" = "scan";
let stream: MediaStream | null = null;
let scanning = false;
let cameraActive = false;
let animationFrameId: number | null = null;
let lastScannedData = "";

// Resolve dynamic detector class (native fallback to WebAssembly ZBar polyfill)
let DetectorClass: any;
if ("BarcodeDetector" in window) {
  DetectorClass = (window as any).BarcodeDetector;
} else {
  DetectorClass = BarcodeDetectorPolyfill;
}

let detector: any = null;
try {
  detector = new DetectorClass({ formats: ["qr_code"] });
} catch (e) {
  console.warn("Detector initialization failed:", e);
}

// Camera state
let torchActive = false;
let videoDevices: MediaDeviceInfo[] = [];
let currentDeviceIndex = 0;

// History state
interface HistoryItem {
  id: string;
  type: "scan" | "generate";
  value: string;
  timestamp: number;
}
let historyItems: HistoryItem[] = [];
let debounceTimer: number | null = null;

// ---------------- TAB HANDLING ----------------
function switchTab(tab: "scan" | "generate") {
  if (currentTab === tab) return;
  currentTab = tab;

  tabScanBtn.classList.toggle("active", tab === "scan");
  tabGenerateBtn.classList.toggle("active", tab === "generate");
  scanTab.classList.toggle("active", tab === "scan");
  generateTab.classList.toggle("active", tab === "generate");

  if (tab === "scan") {
    if (cameraActive) {
      void startCamera();
    } else {
      stopCamera();
    }
  } else {
    const tempActive = cameraActive;
    stopCamera();
    cameraActive = tempActive;
  }
}

tabScanBtn.addEventListener("click", () => switchTab("scan"));
tabGenerateBtn.addEventListener("click", () => switchTab("generate"));

// ---------------- CAMERA STREAMS & SCAN LOOP ----------------
async function startCamera(deviceId?: string) {
  if (scanning) return;
  try {
    torchActive = false;
    btnTorch.classList.remove("active");
    btnTorch.style.display = "none";
    btnSwitchCamera.style.display = "none";

    const videoConstraints: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: "environment" };

    stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
    });

    cameraPlaceholder.style.display = "none";
    video.style.display = "block";
    const overlay = document.querySelector(".scanner-overlay") as HTMLDivElement;
    if (overlay) overlay.style.display = "flex";

    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    await video.play();

    scanning = true;
    cameraActive = true;
    lastScannedData = "";
    animationFrameId = requestAnimationFrame(scanLoop);

    // Setup controls (Torch and Switcher)
    const track = stream.getVideoTracks()[0];
    if (track && typeof track.getCapabilities === "function") {
      const caps = track.getCapabilities() as any;
      if (caps.torch) {
        btnTorch.style.display = "inline-flex";
      }
    }

    // Enumerate devices for switcher
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter((d) => d.kind === "videoinput");
      if (videoDevices.length > 1) {
        btnSwitchCamera.style.display = "inline-flex";
        // Sync current device index
        const settings = track.getSettings();
        if (settings.deviceId) {
          const idx = videoDevices.findIndex((d) => d.deviceId === settings.deviceId);
          if (idx !== -1) {
            currentDeviceIndex = idx;
          }
        }
      } else {
        btnSwitchCamera.style.display = "none";
      }
    } catch (err) {
      console.warn("Failed to enumerate devices:", err);
      btnSwitchCamera.style.display = "none";
    }
  } catch (err: any) {
    console.error("Camera acquisition failure:", err);
    cameraActive = false;
    scanning = false;

    cameraPlaceholder.style.display = "flex";
    video.style.display = "none";
    const overlay = document.querySelector(".scanner-overlay") as HTMLDivElement;
    if (overlay) overlay.style.display = "none";

    const placeholderText = cameraPlaceholder.querySelector("p");
    if (placeholderText) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        placeholderText.textContent =
          "Camera access denied. Please enable camera permissions in browser settings to scan.";
      } else {
        placeholderText.textContent =
          "Could not access camera. Please select an image file to scan instead.";
      }
    }
  }
}

function stopCamera() {
  scanning = false;
  cameraActive = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;

  video.style.display = "none";
  const overlay = document.querySelector(".scanner-overlay") as HTMLDivElement;
  if (overlay) overlay.style.display = "none";
  cameraPlaceholder.style.display = "flex";

  const placeholderText = cameraPlaceholder.querySelector("p");
  if (placeholderText) {
    placeholderText.textContent = "Grant camera permission to begin scanning";
  }

  btnTorch.style.display = "none";
  btnSwitchCamera.style.display = "none";
}

let lastScanTime = 0;
const SCAN_INTERVAL = 200; // Run scanning passes 5 times per second to save battery

async function scanLoop(timestamp: number) {
  if (!scanning) return;

  if (timestamp - lastScanTime >= SCAN_INTERVAL) {
    lastScanTime = timestamp;

    if (video.readyState === video.HAVE_ENOUGH_DATA && detector) {
      try {
        const results = await detector.detect(video);
        if (results.length > 0) {
          const rawResult = results[0].rawValue;
          if (rawResult && rawResult !== lastScannedData) {
            handleScanSuccess(rawResult);
          }
        }
      } catch (e) {
        console.debug("Detection check bypassed/failed:", e);
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

  // Add to local history
  addHistoryItem("scan", data);
}

// ---------------- CAMERA CONTROLS EVENTS ----------------
btnTorch.addEventListener("click", async () => {
  const track = stream?.getVideoTracks()[0];
  if (track) {
    try {
      torchActive = !torchActive;
      await track.applyConstraints({
        advanced: [{ torch: torchActive }],
      } as any);
      btnTorch.classList.toggle("active", torchActive);
    } catch (err) {
      console.error("Failed to apply torch constraint:", err);
      torchActive = false;
      btnTorch.classList.remove("active");
    }
  }
});

btnSwitchCamera.addEventListener("click", () => {
  if (videoDevices.length <= 1) return;
  currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
  const targetDevice = videoDevices[currentDeviceIndex];
  stopCamera();
  void startCamera(targetDevice.deviceId);
});

// ---------------- FILE UPLOAD SCANNING ----------------
btnScanFile.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      if (detector) {
        try {
          const results = await detector.detect(img);
          if (results.length > 0) {
            const rawResult = results[0].rawValue;
            handleScanSuccess(rawResult);
            showToast("QR Code scanned successfully!");
          } else {
            showToast("No QR code found in this image.");
          }
        } catch (err) {
          console.error("File detection failed:", err);
          showToast("Error scanning image file.");
        }
      }
      fileInput.value = "";
    };
    img.src = e.target?.result as string;
  };
  reader.readAsDataURL(file);
});

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

        // Add to history debounced to avoid spamming
        if (debounceTimer) {
          window.clearTimeout(debounceTimer);
        }
        debounceTimer = window.setTimeout(() => {
          addHistoryItem("generate", value);
        }, 1000);
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

// ---------------- HISTORY MANAGEMENT ----------------
function loadHistory() {
  try {
    const raw = localStorage.getItem("qr_offline_history");
    if (raw) {
      historyItems = JSON.parse(raw);
    } else {
      historyItems = [];
    }
  } catch (e) {
    console.error("Failed to parse history:", e);
    historyItems = [];
  }
  renderHistory();
}

function saveHistory() {
  try {
    localStorage.setItem("qr_offline_history", JSON.stringify(historyItems));
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

function addHistoryItem(type: "scan" | "generate", value: string) {
  // Prevent duplicate additions if same as latest item
  if (historyItems.length > 0 && historyItems[0].type === type && historyItems[0].value === value) {
    return;
  }

  const item: HistoryItem = {
    id: Math.random().toString(36).substring(2, 9),
    type,
    value,
    timestamp: Date.now(),
  };

  historyItems.unshift(item);
  if (historyItems.length > 50) {
    historyItems.pop();
  }

  saveHistory();
  renderHistory();
}

function deleteHistoryItem(id: string) {
  historyItems = historyItems.filter((item) => item.id !== id);
  saveHistory();
  renderHistory();
}

btnClearHistory.addEventListener("click", () => {
  historyItems = [];
  saveHistory();
  renderHistory();
});

function renderHistory() {
  historyList.innerHTML = "";

  if (historyItems.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.id = "history-empty";
    empty.textContent = "No history items yet";
    historyList.appendChild(empty);
    return;
  }

  historyItems.forEach((item) => {
    const el = document.createElement("div");
    el.className = "history-item";

    const info = document.createElement("div");
    info.className = "history-item-info";

    const tag = document.createElement("span");
    tag.className = `history-item-tag ${item.type}`;
    tag.textContent = item.type;

    const text = document.createElement("div");
    text.className = "history-item-text";
    text.textContent = item.value;

    const time = document.createElement("span");
    time.className = "history-item-time";
    time.textContent = formatTime(item.timestamp);

    info.appendChild(tag);
    info.appendChild(text);
    info.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "history-action-btn copy";
    copyBtn.textContent = "📋";
    copyBtn.title = "Copy value";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard
        .writeText(item.value)
        .then(() => showToast("Copied to clipboard!"))
        .catch(() => {});
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "history-action-btn delete";
    deleteBtn.textContent = "🗑️";
    deleteBtn.title = "Delete item";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHistoryItem(item.id);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    el.appendChild(info);
    el.appendChild(actions);

    el.addEventListener("click", () => {
      if (item.type === "scan") {
        switchTab("scan");
        handleScanSuccess(item.value);
      } else {
        switchTab("generate");
        qrInput.value = item.value;
        qrInput.dispatchEvent(new Event("input"));
      }
    });

    historyList.appendChild(el);
  });
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
  // Bind enable camera button click listener
  btnEnableCamera.addEventListener("click", () => {
    void startCamera();
  });

  loadHistory();

  // Dialog Open/Close Handlers
  if (btnInfo && infoDialog && btnCloseDialog) {
    btnInfo.addEventListener("click", () => {
      infoDialog.showModal();
    });

    btnCloseDialog.addEventListener("click", () => {
      infoDialog.close();
    });

    // Close on clicking dialog backdrop
    infoDialog.addEventListener("click", (e) => {
      const rect = infoDialog.getBoundingClientRect();
      const isInDialog =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;
      if (!isInDialog) {
        infoDialog.close();
      }
    });
  }

  // PWA Prompt Installation Logic
  setupPwaPrompts();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => console.log("Service Worker registered successfully"))
      .catch((err) => console.warn("Service Worker registration failed:", err));
  }
}

// ---------------- PWA INSTALLATION PROMPTS ----------------
const SNOOZE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function isSnoozed(): boolean {
  const dismissedTime = localStorage.getItem("pwa-prompt-dismissed");
  if (!dismissedTime) return false;
  return Date.now() - parseInt(dismissedTime, 10) < SNOOZE_DURATION;
}

function snoozePrompt() {
  localStorage.setItem("pwa-prompt-dismissed", Date.now().toString());
}

function setupPwaPrompts() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isStandalone =
    (navigator as any).standalone ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);

  if (isStandalone) {
    console.log("App is running in standalone PWA mode");
    return;
  }

  if (isSnoozed()) {
    console.log("PWA install prompt is currently snoozed");
    return;
  }

  // Handle iOS Safari custom banner
  if (isIOS && isSafari) {
    if (pwaIosSheet && btnIosDismiss) {
      setTimeout(() => {
        pwaIosSheet.style.display = "block";
        // Trigger style recalculation for animation
        void pwaIosSheet.offsetHeight;
        pwaIosSheet.classList.add("show");
      }, 2500); // Delay showing for smoother UX

      btnIosDismiss.addEventListener("click", () => {
        pwaIosSheet.classList.remove("show");
        setTimeout(() => {
          pwaIosSheet.style.display = "none";
        }, 400);
        snoozePrompt();
      });
    }
    return;
  }

  // Handle Android/Chrome beforeinstallprompt event
  let deferredPrompt: any = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Prevent standard browser bar from showing
    e.preventDefault();
    deferredPrompt = e;

    if (pwaInstallBanner && btnPwaInstall && btnPwaDismiss && !isSnoozed()) {
      pwaInstallBanner.style.display = "flex";
      // Trigger style recalculation for animation
      void pwaInstallBanner.offsetHeight;
      pwaInstallBanner.classList.add("show");

      btnPwaInstall.addEventListener("click", () => {
        pwaInstallBanner.classList.remove("show");
        setTimeout(() => {
          pwaInstallBanner.style.display = "none";
        }, 400);

        if (deferredPrompt) {
          void deferredPrompt.prompt();
          deferredPrompt.userChoice.then((choiceResult: { outcome: string }) => {
            if (choiceResult.outcome === "accepted") {
              console.log("User accepted PWA installation");
            }
            deferredPrompt = null;
          });
        }
      });

      btnPwaDismiss.addEventListener("click", () => {
        pwaInstallBanner.classList.remove("show");
        setTimeout(() => {
          pwaInstallBanner.style.display = "none";
        }, 400);
        snoozePrompt();
      });
    }
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    const wasActive = cameraActive;
    stopCamera();
    cameraActive = wasActive;
  } else if (currentTab === "scan" && cameraActive) {
    void startCamera();
  }
});
