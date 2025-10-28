// components/AudioVisualizer.tsx
"use client";
import { useRef, useEffect, useState, useCallback } from "react";

type Mode = "idle" | "mic" | "file";

type Track = {
  id: string;
  title: string;
  artist?: string;
  url: string; // path under /public
};

const PRESET_TRACKS: Track[] = [
  { id: "t1", title: "Cascade Breathe", artist: "NverAvetyanMusic", url: "/audio/cascade-breathe.mp3" },
  { id: "t2", title: "Just Relax", artist: "MusicForVideo", url: "/audio/just-relax.mp3" },
  { id: "t3", title: "Running Night", artist: "AlexMakeMusic", url: "/audio/synth-pulse.mp3" },
];

export default function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Web Audio graph
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Sources
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  // Preset file via <audio> element + MediaElementAudioSourceNode
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mediaElSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Viz buffers + loop
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // UI state
  const [mode, setMode] = useState<Mode>("idle");
  const [isMicOn, setIsMicOn] = useState(false);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- Canvas utilities ----------
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }, []);

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

  // ---------- Render loop ----------
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
      const hue = (i / n) * 300;
      ctx2d.fillStyle = `hsl(${hue},100%,50%)`;
      ctx2d.fillRect(x, H - barH, barW, barH);
      x += barW + 1;
    }
  }, []);

  // ---------- Context teardown ----------
  const teardownContext = useCallback(async () => {
    try {
      if (audioCtxRef.current) {
        try { await audioCtxRef.current.suspend(); } catch {}
        try { await audioCtxRef.current.close(); } catch {}
      }
    } finally {
      audioCtxRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
    }
  }, []);

  const stopPresetPlayback = useCallback(async () => {
    try {
      stopRenderLoop();

      const el = audioElRef.current;
      if (el) {
        try { el.onended = null; } catch {}
        try { el.pause(); } catch {}
        try { el.currentTime = 0; } catch {}
      }

      if (mediaElSourceRef.current) {
        try { mediaElSourceRef.current.disconnect(); } catch {}
        mediaElSourceRef.current = null;
      }

      await teardownContext();

      clearCanvas();
      setIsFilePlaying(false);
      setCurrentTrackId(null);
      setMode((m) => (m === "file" ? "idle" : m));
    } catch {}
  }, [clearCanvas, teardownContext]);

  // ---------- MIC control ----------
  const startMic = useCallback(async () => {
    await stopPresetPlayback(); // ensure file stopped

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

      const src = audioCtx.createMediaStreamSource(stream);
      micSourceRef.current = src;

      src.connect(analyser);

      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      fitCanvas();
      clearCanvas();
      draw();

      setMode("mic");
      setIsMicOn(true);
      setCurrentTrackId(null);
      setIsFilePlaying(false);
    } catch (e: any) {
      setError(e?.message ?? "Microphone permission denied or unavailable.");
      clearCanvas();
      setMode("idle");
      setIsMicOn(false);
    }
  }, [draw, fitCanvas, clearCanvas, stopPresetPlayback]);

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
  }, [clearCanvas, teardownContext]);

  // ---------- PRESET playback (via <audio>) ----------
  const ensureAudioElement = () => {
    if (!audioElRef.current) {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous"; // safe for same-origin /public
      audioElRef.current = el;
    }
    return audioElRef.current!;
  };

  const startPreset = useCallback(
    async (track: Track) => {
      // Stop mic (and any current file)
      await stopMic();
      await stopPresetPlayback();

      try {
        setError(null);

        const el = ensureAudioElement();
        el.src = track.url;

        const AudioCtx =
          window.AudioContext || (window as unknown as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;

        // Build analyser
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        // Media element source -> analyser
        const mediaSrc = audioCtx.createMediaElementSource(el);
        mediaSrc.connect(analyser);
        // NOTE: The element outputs audio to destination on its own;
        // if you want to force through context, also connect analyser to destination.
        analyser.connect(audioCtx.destination);

        mediaElSourceRef.current = mediaSrc;

        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

        fitCanvas();
        clearCanvas();
        draw();

        // Start playback
        await el.play();

        setMode("file");
        setCurrentTrackId(track.id);
        setIsFilePlaying(true);

        // When it ends, reset UI
        el.onended = async () => {
          stopRenderLoop();
          await teardownContext();
          mediaElSourceRef.current = null;
          setIsFilePlaying(false);
          setMode((m) => (m === "file" ? "idle" : m));
          clearCanvas();
        };
      } catch (e: any) {
        setError(e?.message ?? "Failed to play track.");
        clearCanvas();
        setIsFilePlaying(false);
        setMode("idle");
        mediaElSourceRef.current = null;
      }
    },
    [clearCanvas, draw, fitCanvas, stopMic, stopPresetPlayback, teardownContext]
  );

  // ---------- Lifecycle ----------
  useEffect(() => {
    // default behavior: start mic on mount
    startMic();
    return () => {
      stopRenderLoop();
      stopPresetPlayback();
      stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- UI helpers ----------
  const statusDot =
    mode === "mic" && isMicOn
      ? "bg-emerald-400"
      : mode === "file" && isFilePlaying
      ? "bg-sky-400"
      : "bg-gray-500";

  return (
    <div className="relative w-full max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} aria-hidden />
          <h2 className="text-lg font-semibold">
            {mode === "mic" && isMicOn && "Live Microphone Visualizer"}
            {mode === "file" && isFilePlaying && "Preset Track Visualizer"}
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

          {mode === "file" && isFilePlaying && (
            <button
              onClick={stopPresetPlayback}
              className="px-3 py-2 rounded-xl text-sm font-medium transition bg-neutral-800 hover:bg-neutral-700"
            >
              Stop Track
            </button>
          )}
        </div>
      </div>

      {/* Preset playlist */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_TRACKS.map((t) => {
          const active = currentTrackId === t.id && isFilePlaying && mode === "file";
          return (
            <div
              key={t.id}
              className={`flex items-center justify-between rounded-xl border border-white/10 p-3 ${
                active ? "bg-white/5" : "bg-white/[0.025]"
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{t.title}</div>
                {t.artist && <div className="truncate text-xs text-white/60">{t.artist}</div>}
              </div>
              <div className="flex gap-2">
                {!active ? (
                  <button
                    onClick={() => startPreset(t)}
                    className="px-3 py-1.5 rounded-lg text-sm bg-sky-600 hover:bg-sky-500"
                  >
                    Play
                  </button>
                ) : (
                  <button
                    onClick={stopPresetPlayback}
                    className="px-3 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Canvas */}
      <div className="rounded-xl overflow-hidden ring-1 ring-white/10 shadow-lg">
        <canvas ref={canvasRef} className="block w-full h-[360px] bg-black" />
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400">
          {error} — try a different input or check permissions.
        </p>
      )}
    </div>
  );
}
