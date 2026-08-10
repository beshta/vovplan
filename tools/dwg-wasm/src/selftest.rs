//! Проверка собранного модуля по поведению, а не по байтам.
//!
//! Собранный `.wasm` лежит в репозитории, и надо как-то убеждаться, что он
//! отвечает исходникам. Сравнивать файлы побайтово бесполезно: один и тот же
//! исходник под разными компиляторами даёт разные байты, и предупреждение
//! горело бы всегда — к нему бы просто привыкли.
//!
//! Поэтому модуль строит внутри себя тело с заранее известными размерами,
//! прогоняет его через ту же тесселяцию, что и настоящие чертежи, и отдаёт
//! измеренный результат. Расхождение означает, что сломалась работа с
//! геометрией: обход граней, ориентация треугольников, перенос координат.
//!
//! Настоящий чертёж для этого не нужен — и не годится: чертежи заказчиков в
//! публичный репозиторий не положить.

use acadrust::entities::acis::primitives;

use crate::tess::{self, Mesh};
use crate::xform::Xform;

/// Размеры проверочного тела, м. Числа разные по всем осям намеренно: на кубе
/// перепутанные оси не заметны, а здесь сразу видно.
const BOX_X: f64 = 3.0;
const BOX_Y: f64 = 5.0;
const BOX_Z: f64 = 7.0;

/// Что намерил модуль на самом себе.
pub struct SelfTest {
    pub faces: usize,
    pub triangles: usize,
    pub skipped: usize,
    /// Габарит в осях сцены (после разворота Z-вверх → Y-вверх)
    pub size: [f32; 3],
}

pub fn run() -> SelfTest {
    let sat = primitives::build_box([0.0, 0.0, 0.0], BOX_X, BOX_Y, BOX_Z);
    let faces = sat.faces().len();

    let mut mesh = Mesh::default();
    let placement = {
        let (m, t, s) = sat.placement();
        Xform::from_acis(m, t, s)
    };
    tess::tessellate(&sat, &placement, &mut mesh);

    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    for p in mesh.positions.chunks_exact(3) {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let size = if mesh.positions.is_empty() {
        [0.0; 3]
    } else {
        [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
    };

    SelfTest {
        faces,
        triangles: mesh.positions.len() / 9,
        skipped: mesh.skipped,
        size,
    }
}

/// Укладывает результат в буфер: три счётчика и три размера.
pub fn encode(r: &SelfTest) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 12 + 12);
    out.extend_from_slice(b"DWGT");
    for v in [r.faces as u32, r.triangles as u32, r.skipped as u32] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in r.size {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}
