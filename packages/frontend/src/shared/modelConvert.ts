import * as THREE from 'three';

/**
 * Приведение популярных 3D-форматов к GLB — прозрачно для пользователя:
 * он выбирает свой файл, а в проект уже уходит наш формат.
 *
 * Конвертация идёт В БРАУЗЕРЕ, а не на сервере, и это осознанно:
 *  - не занимает процессор и память VPS, где и так тесно;
 *  - не тянет в образ нативные конвертеры (десятки мегабайт);
 *  - быстрее для пользователя: наверх уходит только GLB, а он обычно в
 *    несколько раз легче исходного FBX или OBJ с текстурами;
 *  - загрузчики three.js изначально рассчитаны на браузер.
 *
 * Код загрузчиков подгружается по требованию: тот, кто не грузит модели,
 * не платит за него весом страницы.
 */

/** Расширение → как разбирать. Порядок важен для подсказок в интерфейсе. */
const FORMATS = {
  glb: { label: 'glTF Binary', native: true },
  gltf: { label: 'glTF', native: true },
  fbx: { label: 'Autodesk FBX', native: false },
  obj: { label: 'Wavefront OBJ', native: false },
  stl: { label: 'STL', native: false },
  dae: { label: 'Collada', native: false },
  '3ds': { label: '3D Studio', native: false },
  ply: { label: 'PLY', native: false },
  '3mf': { label: '3MF', native: false },
  // Rhino 3DM намеренно не поддержан: его загрузчик тянет WebAssembly со
  // стороннего CDN, то есть добавляет внешнюю зависимость в рантайме,
  // которая может оказаться недоступна. Все остальные — полностью локальные.
  wrl: { label: 'VRML', native: false },
  vtk: { label: 'VTK', native: false },
} as const;

export type SupportedExt = keyof typeof FORMATS;

/** Форматы, которые понимает загрузка — для атрибута accept у поля файла */
export const ACCEPT_EXTENSIONS = Object.keys(FORMATS).map((e) => `.${e}`).join(',');

/** Человекочитаемый список для подсказки */
export const SUPPORTED_LABELS = Object.entries(FORMATS).map(([ext, f]) => `${ext.toUpperCase()} (${f.label})`);

/**
 * Форматы, которые выглядят как 3D, но требуют отдельного разговора.
 * Молчать о них нельзя: человек выберет .dwg и не поймёт, почему не вышло.
 */
const KNOWN_UNSUPPORTED: Record<string, string> = {
  dwg:
    'DWG — закрытый формат AutoCAD, надёжного открытого чтения для него не существует. ' +
    'Экспортируйте из AutoCAD в FBX, OBJ или DAE — они поддерживаются полностью.',
  dxf:
    'DXF — чертёжный формат, в нём обычно плоские линии, а не объёмная модель. ' +
    'Если нужен объём, экспортируйте FBX, OBJ или DAE.',
  rvt: 'RVT — внутренний формат Revit. Экспортируйте FBX или IFC → FBX.',
  skp: 'SKP — формат SketchUp. Экспортируйте DAE (Collada) или FBX.',
  max: 'MAX — сцена 3ds Max. Экспортируйте FBX или OBJ.',
  blend: 'BLEND — файл Blender. Экспортируйте glTF/GLB, FBX или OBJ.',
  '3dm': 'Rhino 3DM пока не поддержан. Экспортируйте из Rhino в OBJ, FBX или DAE.',
  ifc: 'IFC — формат BIM. Экспортируйте FBX или DAE из вашей BIM-программы.',
  step: 'STEP — формат станочного CAD. Экспортируйте STL, OBJ или FBX.',
  stp: 'STEP — формат станочного CAD. Экспортируйте STL, OBJ или FBX.',
  igs: 'IGES — формат станочного CAD. Экспортируйте STL, OBJ или FBX.',
};

export function extOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function isSupported(filename: string): boolean {
  return extOf(filename) in FORMATS;
}

/** Понятное объяснение, если формат заведомо не поддерживается */
export function unsupportedReason(filename: string): string | null {
  const ext = extOf(filename);
  if (ext in FORMATS) return null;
  return (
    KNOWN_UNSUPPORTED[ext] ??
    `Формат .${ext} не поддерживается. Экспортируйте модель в GLB, FBX, OBJ или DAE.`
  );
}

/** Разобранная сцена → GLB-файл */
async function sceneToGlb(object: THREE.Object3D, name: string): Promise<File> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('экспортёр вернул не двоичные данные'));
      },
      (err) => reject(err instanceof Error ? err : new Error('не удалось собрать GLB')),
      { binary: true },
    );
  });

  return new File([buffer], `${name}.glb`, { type: 'model/gltf-binary' });
}

/**
 * Приводит файл к GLB. Уже готовый GLB возвращается как есть — лишняя
 * пересборка только испортила бы исходник.
 *
 * @param onStage — обратная связь для интерфейса: конвертация тяжёлых FBX
 *                  занимает секунды, и молчать всё это время нельзя.
 */
export async function convertToGlb(
  file: File,
  onStage?: (text: string) => void,
): Promise<File> {
  const ext = extOf(file.name) as SupportedExt;
  const format = FORMATS[ext];

  if (!format) {
    throw new Error(unsupportedReason(file.name) ?? 'Неизвестный формат');
  }
  // GLB уже наш — не трогаем
  if (ext === 'glb') return file;

  const baseName = file.name.replace(/\.[^.]+$/, '');
  onStage?.(`Читаю ${format.label}...`);

  const buffer = await file.arrayBuffer();
  const object = await parse(ext, buffer);
  if (!object) throw new Error('в файле не нашлось геометрии');

  onStage?.('Собираю GLB...');
  return sceneToGlb(object, baseName);
}

/** Разбор конкретного формата. Загрузчик подгружается только когда нужен. */
async function parse(ext: SupportedExt, buffer: ArrayBuffer): Promise<THREE.Object3D | null> {
  const text = () => new TextDecoder().decode(buffer);

  switch (ext) {
    case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      return gltf.scene;
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
      return new FBXLoader().parse(buffer, '');
    }
    case 'obj': {
      // Материалы (.mtl) и текстуры лежат отдельными файлами, которых у нас
      // нет — геометрия импортируется, оформление задаётся уже в сцене
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
      return new OBJLoader().parse(text());
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geo = new STLLoader().parse(buffer);
      return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
      return new ColladaLoader().parse(text(), '').scene;
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
      return new TDSLoader().parse(buffer, '');
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geo = new PLYLoader().parse(buffer);
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      return new ThreeMFLoader().parse(buffer);
    }
    case 'wrl': {
      const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
      return new VRMLLoader().parse(text(), '');
    }
    case 'vtk': {
      const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js');
      const geo = new VTKLoader().parse(buffer, '');
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    }
    default:
      return null;
  }
}
