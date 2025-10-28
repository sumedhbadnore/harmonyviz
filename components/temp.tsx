// components/AudioVisualizer.tsx
"use client";
import { useRef, useEffect, useState, useCallback } from "react";

type Mode = "idle" | "mic" | "file";
type Track = { id: string; title: string; artist?: string; url: string };

const PRESET_TRACKS: Track[] = [
  { id: "t1", title: "Cascade Breathe", artist: "NverAvetyanMusic", url: "/audio/cascade-breathe.mp3" },
  { id: "t2", title: "Just Relax", artist: "MusicForVideo", url: "/audio/just-relax.mp3" },
  { id: "t3", title: "Running Night", artist: "AlexMakeMusic", url: "/audio/.mp3" },
];

export default function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // One shared AudioContext + Analyser for both mic and file
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Mic nodes
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Single hidden <audio> element + its MediaElementAudioSource (created once)
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mediaElSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Viz buffers + loop
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // UI state
  const [mode, setMode] = useState<Mode>("idle");
  const [isMicOn, setIsMicOn] = useState(false);
  const [isFilePlaying, setIsFilePlaying] = useState(false);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- Canvas ----------
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
    const onResize = () => { fitCanvas(); clearCanvas(); };
    fitCanvas(); clearCanvas();
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

  // ---------- Init: create one AudioContext, one Analyser, one <audio>, one MediaElementSource ----------
  useEffect(() => {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    audioCtxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    analyserRef.current = analyser;

    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.muted = true; // route audio only through Web Audio to avoid double playback
    audioElRef.current = el;

    const mediaSrc = ctx.createMediaElementSource(el);
    mediaElSourceRef.current = mediaSrc;

    // prepare viz buffer once
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

    // default: start mic
    startMic();

    return () => {
      stopRenderLoop();

      // cleanup mic
      try { micSourceRef.current?.disconnect(); } catch {}
      micSourceRef.current = null;
      try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      micStreamRef.current = null;

      // cleanup file
      if (audioElRef.current) {
        try { audioElRef.current.pause(); } catch {}
        try { audioElRef.current.src = ""; audioElRef.current.load(); } catch {}
      }
      try { mediaElSourceRef.current?.disconnect(); } catch {}
      mediaElSourceRef.current = null;

      // close context
      (async () => {
        try { await ctx.suspend(); } catch {}
        try { await ctx.close(); } catch {}
      })();
      audioCtxRef.current = null;
      analyserRef.current = null;
      dataArrayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Helpers to (dis)connect chains ----------
  const disconnectAll = useCallback(() => {
    try { micSourceRef.current?.disconnect(); } catch {}
    try { mediaElSourceRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
  }, []);

  const connectForMic = useCallback(() => {
    if (!audioCtxRef.current || !analyserRef.current || !micSourceRef.current) return;
    micSourceRef.current.connect(analyserRef.current);
    analyserRef.current.connect(audioCtxRef.current.destination);
  }, []);

  const connectForFile = useCallback(() => {
    if (!audioCtxRef.current || !analyserRef.current || !mediaElSourceRef.current) return;
    mediaElSourceRef.current.connect(analyserRef.current);
    analyserRef.current.connect(audioCtxRef.current.destination);
  }, []);

  // ---------- Mic control ----------

  const stopPresetPlayback = useCallback(async () => {
    if (!audioElRef.current) return;
    try {
      stopRenderLoop();
      audioElRef.current.onended = null;
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
      // Keep src empty or keep it — both are fine since we reuse the element.
      // audioElRef.current.src = ""; audioElRef.current.load(); // optional hard reset
    } catch {}
    disconnectAll();
    clearCanvas();
    setIsFilePlaying(false);
    setCurrentTrackId(null);
    setMode((m) => (m === "file" ? "idle" : m));
  }, [clearCanvas, disconnectAll]);

  const startMic = useCallback(async () => {
    if (!audioCtxRef.current) return;
    setBusy(true);
    await stopPresetPlayback(); // ensure file is stopped
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const src = audioCtxRef.current.createMediaStreamSource(stream);
      micSourceRef.current = src;

      disconnectAll();
      connectForMic();

      fitCanvas();
      clearCanvas();
      draw();

      setMode("mic");
      setIsMicOn(true);
      setIsFilePlaying(false);
      setCurrentTrackId(null);
    } catch (e: any) {
      setError(e?.message ?? "Microphone permission denied or unavailable.");
      clearCanvas();
      setMode("idle");
      setIsMicOn(false);
    } finally {
      setBusy(false);
    }
  }, [clearCanvas, connectForMic, disconnectAll, draw, fitCanvas, stopPresetPlayback]);

  const stopMic = useCallback(() => {
    if (!audioCtxRef.current) return;
    try {
      stopRenderLoop();
      try { micSourceRef.current?.disconnect(); } catch {}
      micSourceRef.current = null;
      try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      micStreamRef.current = null;
      clearCanvas();
      setIsMicOn(false);
      setMode((m) => (m === "mic" ? "idle" : m));
    } catch {}
  }, [clearCanvas]);

  // ---------- Preset playback (reusing the one media source) ----------
  const startPreset = useCallback(async (track: Track) => {
    if (!audioCtxRef.current || !audioElRef.current) return;
    if (busy) return;
    setBusy(true);

    // Stop mic if active
    stopMic();

    // Stop any current track (but keep the same <audio> & media source)
    try {
      audioElRef.current.onended = null;
      audioElRef.current.pause();
    } catch {}

    try {
      disconnectAll();
      connectForFile();

      // Switch source URL and play
      audioElRef.current.src = track.url;
      audioElRef.current.currentTime = 0;
      fitCanvas();
      clearCanvas();
      draw();

      await audioElRef.current.play();

      setMode("file");
      setIsFilePlaying(true);
      setCurrentTrackId(track.id);

      audioElRef.current.onended = () => {
        stopRenderLoop();
        setIsFilePlaying(false);
        setCurrentTrackId(null);
        setMode("idle");
        clearCanvas();
        disconnectAll();
      };
    } catch (e: any) {
      setError(e?.message ?? "Failed to play track.");
      setIsFilePlaying(false);
      setCurrentTrackId(null);
      setMode("idle");
      clearCanvas();
      disconnectAll();
    } finally {
      setBusy(false);
    }
  }, [busy, clearCanvas, connectForFile, disconnectAll, draw, fitCanvas, stopMic]);

  // ---------- UI ----------
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
          <button
            onClick={isMicOn ? stopMic : startMic}
            disabled={busy}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              isMicOn ? "bg-neutral-800 hover:bg-neutral-700" : "bg-emerald-600 hover:bg-emerald-500"
            } ${busy ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {isMicOn ? "Turn Mic Off" : "Use Mic"}
          </button>

          {mode === "file" && isFilePlaying && (
            <button
              onClick={stopPresetPlayback}
              disabled={busy}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition bg-neutral-800 hover:bg-neutral-700 ${
                busy ? "opacity-60 cursor-not-allowed" : ""
              }`}
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
                    disabled={busy}
                    className={`px-3 py-1.5 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 ${
                      busy ? "opacity-60 cursor-not-allowed" : ""
                    }`}
                  >
                    Play
                  </button>
                ) : (
                  <button
                    onClick={stopPresetPlayback}
                    disabled={busy}
                    className={`px-3 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 ${
                      busy ? "opacity-60 cursor-not-allowed" : ""
                    }`}
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
          {error}
        </p>
      )}
    </div>
  );
}
