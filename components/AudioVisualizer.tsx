// components/AudioVisualizer.tsx
"use client";
import { useRef, useEffect, useState, useCallback } from "react";

type Mode = "idle" | "mic" | "file";

export default function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Audio graph refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Source refs (mic vs file)
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const fileSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Render loop + buffers
  const rafIdRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // UI state
  const [mode, setMode] = useState<Mode>("idle");
  const [isMicOn, setIsMicOn] = useState(false);
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
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

  // Clear the canvas (fill black to match theme)
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
    const onResize = () => {
      fitCanvas();
      clearCanvas();
    };
    fitCanvas();
    clearCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
    analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);

    // Fade trail
    ctx2d.fillStyle = "rgba(0,0,0,0.15)";
    ctx2d.fillRect(0, 0, W, H);

    const n = dataArray.length;
    const barW = (W / n) * 2.2;
    let x = 0;

    for (let i = 0; i < n; i++) {
      const v = dataArray[i];
      const barH = (v / 255) * (H * 0.9);
      const hue = (i / n) * 300; // 0..300° rainbow
      ctx2d.fillStyle = `hsl(${hue},100%,50%)`;
      ctx2d.fillRect(x, H - barH, barW, barH);
      x += barW + 1;
    }
  }, []);

  const teardownContext = async () => {
    try {
      if (audioCtxRef.current) {
        try {
          await audioCtxRef.current.suspend();
        } catch {}
        try {
          await audioCtxRef.current.close();
        } catch {}
      }
    } finally {
      audioCtxRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
    }
  };

  // ----- MIC CONTROL -----
  const startMic = useCallback(async () => {
    await stopFilePlayback();

    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext || (window as unknown as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      micSourceRef.current = source;
      source.connect(analyser);

      // ✅ Create a typed ArrayBuffer to avoid TS "ArrayBufferLike" error
      const buffer = new ArrayBuffer(analyser.frequencyBinCount);
      const dataArray = new Uint8Array(buffer);
      dataArrayRef.current = dataArray;

      fitCanvas();
      clearCanvas();
      draw();

      setMode("mic");
      setIsMicOn(true);
      setIsFilePlaying(false);
      setFileName(null);
    } catch (e: any) {
      setError(e?.message ?? "Microphone permission denied or unavailable.");
      clearCanvas();
      setMode("idle");
      setIsMicOn(false);
    }
  }, [draw, fitCanvas, clearCanvas]);

  const stopMic = useCallback(async () => {
    try {
      stopRenderLoop();

      micSourceRef.current?.disconnect();
      micSourceRef.current = null;

      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;

      await teardownContext();

      clearCanvas();
      setIsMicOn(false);
      setMode((m) => (m === "mic" ? "idle" : m));
    } catch {}
  }, [clearCanvas]);

  // ----- FILE PLAYBACK CONTROL -----
  const startFilePlayback = useCallback(
    async (file: File) => {
      await stopMic();

      try {
        setError(null);

        const arrayBuffer = await file.arrayBuffer();
        const AudioCtx =
          window.AudioContext || (window as unknown as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const src = audioCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(analyser);
        analyser.connect(audioCtx.destination);

        fileSourceRef.current = src;

        // ✅ Typed buffer again
        const buffer = new ArrayBuffer(analyser.frequencyBinCount);
        const dataArray = new Uint8Array(buffer);
        dataArrayRef.current = dataArray;

        fitCanvas();
        clearCanvas();
        draw();

        src.start(0);
        setMode("file");
        setIsFilePlaying(true);
        setFileName(file.name);

        src.onended = async () => {
          stopRenderLoop();
          await teardownContext();
          fileSourceRef.current = null;
          setIsFilePlaying(false);
          setMode((m) => (m === "file" ? "idle" : m));
          clearCanvas();
        };
      } catch (e: any) {
        setError(e?.message ?? "Failed to play the selected audio file.");
        clearCanvas();
        setIsFilePlaying(false);
        setMode("idle");
        fileSourceRef.current = null;
      }
    },
    [draw, fitCanvas, clearCanvas, stopMic]
  );

  const stopFilePlayback = useCallback(async () => {
    try {
      stopRenderLoop();

      if (fileSourceRef.current) {
        try {
          fileSourceRef.current.stop(0);
        } catch {}
        try {
          fileSourceRef.current.disconnect();
        } catch {}
        fileSourceRef.current = null;
      }

      await teardownContext();

      clearCanvas();
      setIsFilePlaying(false);
      setMode((m) => (m === "file" ? "idle" : m));
      setFileName(null);
    } catch {}
  }, [clearCanvas]);

  useEffect(() => {
    startMic();
    return () => {
      stopRenderLoop();
      stopFilePlayback();
      stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    await startFilePlayback(f);
    ev.target.value = "";
  };

  const micIndicator =
    mode === "mic" && isMicOn
      ? "bg-emerald-400"
      : mode === "file" && isFilePlaying
      ? "bg-sky-400"
      : "bg-gray-500";

  return (
    <div className="relative w-full max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${micIndicator}`}
            aria-hidden
          />
          <h2 className="text-lg font-semibold">
            {mode === "mic" && isMicOn && "Live Microphone Visualizer"}
            {mode === "file" &&
              isFilePlaying &&
              (fileName ? `Playing: ${fileName}` : "Audio File Visualizer")}
            {mode === "idle" && "Audio Visualizer"}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {mode === "mic" ? (
            <button
              onClick={stopMic}
              className="px-4 py-2 rounded-xl text-sm font-medium transition bg-neutral-800 hover:bg-neutral-700"
            >
              Turn Mic Off
            </button>
          ) : (
            <button
              onClick={startMic}
              className="px-4 py-2 rounded-xl text-sm font-medium transition bg-emerald-600 hover:bg-emerald-500"
            >
              Use Mic
            </button>
          )}

          <label
            htmlFor="audioUpload"
            className="cursor-pointer px-4 py-2 rounded-xl text-sm font-medium transition bg-sky-600 hover:bg-sky-500"
          >
            Upload Audio
          </label>
          <input
            id="audioUpload"
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={onUpload}
          />

          {mode === "file" && isFilePlaying && (
            <button
              onClick={stopFilePlayback}
              className="px-3 py-2 rounded-xl text-sm font-medium transition bg-neutral-800 hover:bg-neutral-700"
            >
              Stop Audio
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden ring-1 ring-white/10 shadow-lg">
        <canvas ref={canvasRef} className="block w-full h-[360px] bg-black" />
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400">
          {error} — try a different input or check permissions.
        </p>
      )}

      {mode === "file" && isFilePlaying && fileName && (
        <p className="mt-2 text-xs text-white/60">Visualizing: {fileName}</p>
      )}
    </div>
  );
}
