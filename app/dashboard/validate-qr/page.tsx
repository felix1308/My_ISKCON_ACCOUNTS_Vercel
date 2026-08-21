"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { callApi } from "@/lib/client";

export default function ValidateQRPage() {
  const { isSuperuser } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ isOk: boolean; message?: string; error?: string } | null>(null);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => { return () => { stopCamera(); }; }, [stopCamera]);

  async function startCamera() {
    setCameraError("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      scanLoop();
    } catch {
      setCameraError("Camera access denied. Please allow camera permissions.");
    }
  }

  function scanLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Use jsQR if available (loaded via CDN in the original; we'll do a basic check)
    const jsQR = (globalThis as unknown as { jsQR?: (data: ImageData["data"], w: number, h: number) => { data: string } | null }).jsQR;
    if (jsQR) {
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        handleQRCode(code.data);
        return;
      }
    }

    animRef.current = requestAnimationFrame(scanLoop);
  }

  async function handleQRCode(qrData: string) {
    stopCamera();
    setResult({ isOk: true, message: "Validating..." });
    const res = await callApi("validateQR", { qrData });
    setResult(res as { isOk: boolean; message?: string; error?: string });
  }

  if (!isSuperuser) return <div className="text-center py-12 text-theme-muted">Superadmin or Scanner access required.</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl card-shadow p-6">
        <h3 className="font-display text-xl font-semibold text-theme-primary mb-1">Validate Receipt QR Codes</h3>
        <p className="text-sm text-theme-secondary mb-6">Scan Entry, Seva or Prasadam QR codes from donor receipts. Each QR can be used only once.</p>

        <div className="flex flex-col items-center gap-4">
          {/* Camera viewport */}
          <div className="relative rounded-lg overflow-hidden border-2 border-theme bg-black" style={{ maxWidth: 320, width: "100%", aspectRatio: "1" }}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 border-4 border-green-400 rounded-lg opacity-80" />
              </div>
            )}
          </div>

          {/* Controls */}
          {!scanning ? (
            <button onClick={startCamera} className="btn-primary px-6 py-2 rounded-lg text-sm font-medium">Start Camera</button>
          ) : (
            <button onClick={stopCamera} className="px-6 py-2 rounded-lg text-sm font-medium border border-theme text-theme-secondary">Stop Camera</button>
          )}

          {cameraError && <p className="text-red-600 text-sm">{cameraError}</p>}

          {/* Result */}
          {result && (
            <div className={`w-full max-w-sm rounded-lg p-4 text-center text-sm ${
              result.isOk ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"
            }`}>
              {result.message || result.error}
            </div>
          )}

          {!scanning && !result && (
            <p className="text-sm text-theme-muted">Allow camera access when prompted. Point at a QR code to scan.</p>
          )}
        </div>
      </div>
    </div>
  );
}
