import { useState, useEffect } from 'react';

const STORAGE_KEY = 'vovplan_tutorial_seen';

/**
 * Onboarding tutorial + permanent controls hint.
 *
 * 1. First visit → modal popup with 3D navigation instructions
 * 2. After dismiss → permanent compact hint in bottom-left corner
 */
export default function NavigationHelp() {
  const [showTutorial, setShowTutorial] = useState(false);

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

  return (
    <>
      {/* Permanent hint — bottom left, above TerrainPanel */}
      <div className="absolute left-4 bottom-[68px] z-10 bg-slate-900/80 backdrop-blur text-slate-300 text-xs rounded-lg px-3 py-2 pointer-events-none">
        <div className="flex items-center gap-3 flex-wrap">
          <span>🖱️ <b className="text-slate-100">ЛКМ</b> — вращать</span>
          <span>🖱️ <b className="text-slate-100">ПКМ</b> — двигать</span>
          <span>🖱️ <b className="text-slate-100">Колесо</b> — зум</span>
          <span>⌨️ <b className="text-slate-100">Shift+ЛКМ</b> — панорама</span>
        </div>
      </div>

      {/* First-visit tutorial popup */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-700 max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 bg-slate-800 border-b border-slate-700">
              <h2 className="text-white font-bold text-lg">Добро пожаловать в VOVPLAN!</h2>
              <p className="text-slate-400 text-sm mt-1">Управление в 3D-сцене</p>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <TutorialRow icon="🖱️" title="Левая кнопка мыши (ЛКМ)" desc="Вращение камеры вокруг сцены. Клик по объекту — выбор." />
              <TutorialRow icon="🖱️" title="Правая кнопка мыши (ПКМ)" desc="Перемещение (панорама) камеры вправо/влево/вверх/вниз." />
              <TutorialRow icon="🔍" title="Колесо мыши" desc="Приближение / отдаление камеры." />
              <TutorialRow icon="⌨️" title="Shift + ЛКМ" desc="Альтернативный способ панорамирования." />
              <TutorialRow icon="✏️" title="Редактирование" desc="Выберите объект → нажмите «Изменить» → двигайте/вращайте/масштабируйте." />
              <TutorialRow icon="↩️" title="Ctrl+Z / Ctrl+Shift+Z" desc="Отмена / повтор последнего действия." />
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-800/50 border-t border-slate-700">
              <button
                onClick={handleDismiss}
                className="w-full px-4 py-2.5 bg-vovplan-600 text-white rounded-lg text-sm font-medium hover:bg-vovplan-700 transition-colors"
              >
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
