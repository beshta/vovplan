import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { modelsApi, type Model3DPayload } from '../../../shared/api';

interface Props {
  projectId: string;
  onPlaceObject?: (model: Model3DPayload) => void;
}

/**
 * Model Library panel — upload GLB files, browse existing models, place on scene.
 */
export default function ModelLibrary({ projectId, onPlaceObject }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
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
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => modelsApi.remove(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models', projectId] });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = uploadName || file.name.replace(/\.(glb|gltf)$/i, '');
    uploadMutation.mutate({ file, name });
  };

  const models = modelsData?.data ?? [];

  return (
    <div className="w-72 bg-slate-950/95 backdrop-blur-xl border-l border-white/10 flex flex-col overflow-hidden text-slate-200">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/10">
        <h3 className="hud-title">📦 Библиотека моделей</h3>
      </div>

      {/* Upload zone */}
      <div className="p-4 border-b border-white/5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf"
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
          {uploadMutation.isPending ? '⏳ Загрузка...' : '⬆ Загрузить GLB'}
        </button>
        {uploadError && (
          <p className="mt-2 text-xs text-red-300">{uploadError}</p>
        )}
      </div>

      {/* Models list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading && (
          <p className="text-sm text-slate-500 text-center py-4">Загрузка...</p>
        )}
        {models.length === 0 && !isLoading && (
          <div className="text-center py-8 text-slate-500">
            <div className="text-3xl mb-2">📦</div>
            <p className="text-sm">Пока нет моделей</p>
            <p className="text-xs mt-1">Загрузите GLB-файл выше</p>
          </div>
        )}
        {models.map((model: Model3DPayload) => (
          <div
            key={model.id}
            className="group bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{model.name}</p>
                <p className="text-xs text-slate-500">
                  {(model.fileSize / 1024).toFixed(0)} KB · {model.format.toUpperCase()}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">by {model.uploadedBy}</p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(model.id)}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs px-1 transition-opacity"
                title="Удалить модель"
              >✕</button>
            </div>
            {onPlaceObject && (
              <button
                onClick={() => onPlaceObject(model)}
                className="mt-2 w-full px-3 py-1.5 bg-vovplan-600/20 text-vovplan-200 rounded-lg text-xs font-medium hover:bg-vovplan-600/35 transition-colors"
              >➕ Разместить на сцене</button>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
