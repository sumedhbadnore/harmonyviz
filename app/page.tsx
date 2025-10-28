import AudioVisualizer from "@/components/AudioVisualizer";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
      <h1 className="text-4xl font-bold text-center">🎶 HarmonyViz</h1>
      <p className="text-gray-400 text-center max-w-md">
        Visualize live music in real-time. Speak, sing, or play your favorite track.
      </p>
      <AudioVisualizer />
    </main>
  );
}
