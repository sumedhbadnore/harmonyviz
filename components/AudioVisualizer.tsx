// components/AudioVisualizer.tsx
"use client";
import { useRef, useEffect, useState, useCallback } from "react";

export default function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Audio graph refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Render loop
  const rafIdRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const [isMicOn, setIsMicOn] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fit canvas to device pixel ratio for crisp visuals
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }, []);

  // Clear the canvas (and fill black to match theme)
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    fitCanvas();
    clearCanvas();
    window.addEventListener("resize", () => {
      fitCanvas();
      clearCanvas();
    });
    return () => {
      window.removeEventListener("resize", () => {
        fitCanvas();
        clearCanvas();
      });
    };
  }, [fitCanvas, clearCanvas]);

  const stopRenderLoop = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    if (!canvas || !analyser || !dataArray) return;

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const W = canvas.width;
    const H = canvas.height;

    rafIdRef.current = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    // Fade trail
    ctx2d.fillStyle = "rgba(0,0,0,0.15)";
    ctx2d.fillRect(0, 0, W, H);

    const n = dataArray.length;
    const barW = (W / n) * 2.2;
    let x = 0;

    for (let i = 0; i < n; i++) {
      const v = dataArray[i];
      const barH = (v / 255) * (H * 0.9);
      const hue = (i / n) * 300; // rainbow
      ctx2d.fillStyle = `hsl(${hue},100%,50%)`;
      ctx2d.fillRect(x, H - barH, barW, barH);
      x += barW + 1;
    }
  }, []);

  const startMic = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext || (window as unknown as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      dataArrayRef.current = dataArray;

      fitCanvas();
      clearCanvas();
      draw();
      setIsMicOn(true);
    } catch (e: any) {
      setError(e?.message ?? "Microphone permission denied or unavailable.");
      clearCanvas(); // ensure no stale frame if permission fails
      setIsMicOn(false);
    }
  }, [draw, fitCanvas, clearCanvas]);

  const stopMic = useCallback(async () => {
    try {
      // Stop animation
      stopRenderLoop();

      // Disconnect nodes
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      sourceRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;

      // Stop all tracks
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      // Suspend/close context
      if (audioCtxRef.current) {
        try {
          await audioCtxRef.current.suspend();
        } catch {}
        try {
          await audioCtxRef.current.close();
        } catch {}
      }
      audioCtxRef.current = null;

      // Clear the canvas so the last frame doesn't linger
      clearCanvas();

      setIsMicOn(false);
    } catch {
      // no-op
    }
  }, [clearCanvas]);

  // Auto-start mic on mount; clean up on unmount
  useEffect(() => {
    startMic();
    return () => {
      stopMic();
    };
  }, [startMic, stopMic]);

  return (
    <div className="relative w-full max-w-4xl">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Live Microphone Visualizer</h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isMicOn ? "bg-emerald-400" : "bg-gray-500"
            }`}
            aria-hidden
          />
          <button
            onClick={isMicOn ? stopMic : startMic}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              isMicOn
                ? "bg-neutral-800 hover:bg-neutral-700"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {isMicOn ? "Turn Mic Off" : "Turn Mic On"}
          </button>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden ring-1 ring-white/10 shadow-lg">
        <canvas ref={canvasRef} className="block w-full h-[360px] bg-black" />
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400">
          {error} — check browser permissions or input device.
        </p>
      )}
    </div>
  );
}
