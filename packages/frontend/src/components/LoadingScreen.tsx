export default function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-900">
      <div className="text-center">
        <div className="inline-block w-12 h-12 border-4 border-vovplan-500 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-slate-400 font-medium tracking-wider">VOVPLAN</p>
      </div>
    </div>
  );
}
