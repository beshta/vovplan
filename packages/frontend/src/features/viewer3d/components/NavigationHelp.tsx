import { useState, useEffect } from 'react';
import { useViewerStore } from '../stores/viewerStore';

const STORAGE_KEY = 'vovplan_tutorial_seen';

/**
 * Onboarding tutorial + permanent controls hint.
 *
 * Layout (bottom-left corner, dedicated zone):
 * - Permanent compact hint (navigation controls)
 * - Button: perspective / top view toggle
 *
 * First visit → modal popup with 3D navigation instructions
 */
export default function NavigationHelp() {
  const [showTutorial, setShowTutorial] = useState(false);
  const cameraView = useViewerStore((s) => s.cameraView);
  const setCameraView = useViewerStore((s) => s.setCameraView);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setShowTutorial(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setShowTutorial(false);
  };

  const cycleCameraView = () => {
    if (cameraView === 'orbit') setCameraView('top');
    else if (cameraView === 'top') setCameraView('orbit');
    else setCameraView('orbit');
  };

  return (
    <>
      {/* Controls hint + view toggle (позицию задаёт HUD-сетка) */}
      <div className="flex flex-col gap-2 items-start">
        {/* View toggle button */}
        <button
          onClick={cycleCameraView}
          title={cameraView === 'top' ? 'Перейти в перспективу' : 'Вид сверху'}
          className="glass-chip text-xs"
        >
          {cameraView === 'top' ? '🔲 Перспектива' : '📐 Вид сверху'}
        </button>

        {/* Permanent hint */}
        <div className="glass rounded-xl text-slate-400 text-[11px] px-3 py-1.5 pointer-events-none">
          <div className="flex items-center gap-3 flex-wrap">
            <span><b className="text-slate-200">ЛКМ</b> — вращать</span>
            <span><b className="text-slate-200">ПКМ</b> — двигать</span>
            <span><b className="text-slate-200">Колесо</b> — зум</span>
          </div>
        </div>
      </div>

      {/* First-visit tutorial popup */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass max-w-md w-full mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h2 className="text-white font-semibold text-lg tracking-tight">Добро пожаловать в VOVPLAN</h2>
              <p className="text-slate-400 text-sm mt-1">Управление в 3D-сцене</p>
            </div>
            <div className="p-6 space-y-4">
              <TutorialRow icon="🖱️" title="Левая кнопка мыши (ЛКМ)" desc="Вращение камеры вокруг сцены. Клик по объекту — выбор." />
              <TutorialRow icon="🖱️" title="Правая кнопка мыши (ПКМ)" desc="Перемещение (панорама) камеры." />
              <TutorialRow icon="🔍" title="Колесо мыши" desc="Приближение / отдаление камеры." />
              <TutorialRow icon="⌨️" title="Shift + ЛКМ" desc="Альтернативный способ панорамирования." />
              <TutorialRow icon="✏️" title="Редактирование" desc="Выберите объект → «Изменить» → двигайте/вращайте/масштабируйте." />
              <TutorialRow icon="↩️" title="Ctrl+Z / Ctrl+Shift+Z" desc="Отмена / повтор последнего действия." />
              <TutorialRow icon="📐" title="Вид сверху" desc="Кнопка внизу слева переключает перспективу и вид сверху." />
            </div>
            <div className="px-6 py-4 border-t border-white/10">
              <button onClick={handleDismiss} className="btn-primary w-full text-sm">
                Понятно, начать работу
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TutorialRow({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="text-2xl flex-shrink-0">{icon}</div>
      <div>
        <p className="text-slate-100 text-sm font-medium">{title}</p>
        <p className="text-slate-400 text-xs mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
