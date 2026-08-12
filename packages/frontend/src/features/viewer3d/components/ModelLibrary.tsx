import { useRef, useState } from 'react';
import { Package, Upload, Plus, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { modelsApi, type Model3DPayload } from '../../../shared/api';
import { convertToGlb, unsupportedReason, ACCEPT_EXTENSIONS } from '../../../shared/modelConvert';

/** Держать в согласии с utils/uploadLimits.ts на бэкенде */
const MODEL_LIMIT = 300 * 1024 * 1024;
const humanMb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} МБ`;

interface Props {
  projectId: string;
  onPlaceObject?: (model: Model3DPayload) => void;
}

/**
 * Model Library panel — загрузка моделей, просмотр библиотеки, размещение в сцене.
 *
 * Принимает популярные форматы (FBX, OBJ, STL, DAE, 3DS...) и приводит их к GLB
 * прямо в браузере — для пользователя это один шаг, конвертации он не видит.
 */
export default function ModelLibrary({ projectId, onPlaceObject }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  /** Что происходит прямо сейчас: чтение FBX и сборка GLB занимают секунды */
  const [stage, setStage] = useState('');
  const queryClient = useQueryClient();

  const { data: modelsData, isLoading } = useQuery({
    queryKey: ['models', projectId],
    queryFn: () => modelsApi.list(projectId),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, name }: { file: File; name: string }) =>
      modelsApi.upload(projectId, file, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models', projectId] });
      setUploadName('');
      setUploadError('');
      setStage('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: Error) => {
      setUploadError(err.message);
      setStage('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => modelsApi.remove(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models', projectId] });
    },
  });

  /**
   * Приводим файл к GLB прямо в браузере и грузим уже его. Для пользователя
   * это один шаг: он выбрал свой FBX или OBJ — модель появилась в библиотеке.
   */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    const reason = unsupportedReason(file.name);
    if (reason) {
      setUploadError(reason);
      e.target.value = '';
      return;
    }

    const name = uploadName || file.name.replace(/\.[^.]+$/, '');
    try {
      const glb = await convertToGlb(file, setStage);

      /*
       * Размер проверяем здесь, а не после отправки.
       *
       * Сервер откажет всё равно, но человек к тому моменту уже отправит
       * сотни мегабайт — на медленном канале это минуты ожидания ради
       * сообщения об отказе. Размер известен сразу после сборки, и сказать
       * о нём надо сразу.
       */
      if (glb.size > MODEL_LIMIT) {
        setUploadError(
          `Модель весит ${humanMb(glb.size)} — это больше предела в ${humanMb(MODEL_LIMIT)}. ` +
            'Упростите геометрию или разбейте на части.',
        );
        setStage('');
        e.target.value = '';
        return;
      }

      // Стадию не сбрасываем: отправка идёт дальше, и `onSuccess` погасит
      // её сам. Раньше сброс стоял в `finally` и срабатывал сразу после
      // `mutate`, из-за чего долгая отправка выглядела как «Загрузка...»
      // без объяснений — и по индикатору нельзя было понять, где затык.
      setStage('Отправляю на сервер...');
      uploadMutation.mutate({ file: glb, name });
    } catch (err) {
      // Битый или нестандартный файл: показываем, что именно не вышло,
      // вместо общего «ошибка загрузки»
      setUploadError(`Не удалось прочитать файл: ${(err as Error).message}`);
      setStage('');
      e.target.value = '';
    }
  };

  const models = modelsData?.data ?? [];

  return (
    <div className="w-72 bg-white/95 border-l border-slate-900/10 text-slate-700 dark:bg-slate-950/95 dark:border-white/10 dark:text-slate-200 backdrop-blur-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/10">
        <h3 className="hud-title flex items-center gap-1.5"><Package size={14} /> Библиотека моделей</h3>
      </div>

      {/* Upload zone */}
      <div className="p-4 border-b border-white/5">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_EXTENSIONS}
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          type="text"
          placeholder="Название модели (необязательно)"
          value={uploadName}
          onChange={(e) => setUploadName(e.target.value)}
          className="input-field text-sm mb-2"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="btn-primary w-full text-sm"
        >
          {stage || uploadMutation.isPending ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              {stage || 'Загрузка...'}
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5"><Upload size={15} /> Загрузить модель</span>
          )}
        </button>
        <p className="mt-2 text-[11px] text-muted leading-relaxed">
          DWG, GLB, FBX, OBJ, STL, DAE, 3DS, PLY, 3MF, VRML — приведём к нужному формату сами
        </p>
        {uploadError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400 leading-relaxed">{uploadError}</p>
        )}
      </div>

      {/* Models list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">Загрузка...</p>
        )}
        {models.length === 0 && !isLoading && (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400">
            <div className="flex justify-center mb-2 text-slate-600"><Package size={32} /></div>
            <p className="text-sm">Пока нет моделей</p>
            <p className="text-xs mt-1">Загрузите GLB-файл выше</p>
          </div>
        )}
        {models.map((model: Model3DPayload) => (
          <div
            key={model.id}
            className="group bg-slate-900/5 hover:bg-slate-900/10 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl p-3 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{model.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(model.fileSize / 1024).toFixed(0)} KB · {model.format.toUpperCase()}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">by {model.uploadedBy}</p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(model.id)}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs px-1 transition-opacity"
                title="Удалить модель"
              ><X size={13} /></button>
            </div>
            {onPlaceObject && (
              <button
                onClick={() => onPlaceObject(model)}
                className="mt-2 w-full px-3 py-1.5 bg-vovplan-500/10 text-vovplan-700 dark:bg-vovplan-600/20 dark:text-vovplan-200 rounded-lg text-xs font-medium hover:bg-vovplan-600/35 transition-colors"
              ><span className="flex items-center justify-center gap-1"><Plus size={13} /> Разместить на сцене</span></button>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
