//! DWG → треугольники сцены.
//!
//! Собирает всё тело чертежа в один буфер: разбирает файл, раскрывает вставки
//! блоков и режет тела ACIS. Наружу уходит плоский двоичный блок, который JS
//! отдаёт в BufferGeometry без разбора и перекладываний.

use std::io::Cursor;

use acadrust::io::dwg::DwgReader;

use crate::blocks;
use crate::tess::{self, Mesh};

/// Метка формата: JS проверяет её, чтобы не принять за геометрию мусор.
const MAGIC: &[u8; 4] = b"DWGM";
const FORMAT_VERSION: u32 = 1;

/// Итог разбора: геометрия плюс то, что честно не получилось.
pub struct Converted {
    pub mesh: Mesh,
    pub bodies_ok: usize,
    pub bodies_failed: usize,
}

pub fn convert(bytes: Vec<u8>) -> Result<Converted, String> {
    let mut reader = DwgReader::from_stream(Cursor::new(bytes));
    let doc = reader.read().map_err(|e| format!("не разобрать DWG: {e}"))?;

    let mut mesh = Mesh::default();
    let (mut ok, mut failed) = (0, 0);

    blocks::for_each_body(&doc, &mut |acis, at| match acis.parse() {
        Some(sat) => {
            ok += 1;
            tess::tessellate(&sat, at, &mut mesh);
        }
        None => failed += 1,
    });

    Ok(Converted {
        mesh,
        bodies_ok: ok,
        bodies_failed: failed,
    })
}

/// Укладывает результат в буфер для JS.
///
/// Порядок: метка, версия формата, счётчики, потом координаты и нормали.
/// Всё в прямом порядке байт — так его читает `DataView` и типизированные
/// массивы на всех платформах, где работает браузер.
pub fn encode(r: &Converted) -> Vec<u8> {
    let verts = (r.mesh.positions.len() / 3) as u32;
    let mut out = Vec::with_capacity(24 + r.mesh.positions.len() * 8);

    out.extend_from_slice(MAGIC);
    for v in [
        FORMAT_VERSION,
        verts,
        r.bodies_ok as u32,
        r.bodies_failed as u32,
        r.mesh.skipped as u32,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in &r.mesh.positions {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in &r.mesh.normals {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Сообщение об ошибке в том же буфере — по метке JS отличит его от геометрии.
pub fn encode_error(msg: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"DWGE");
    out.extend_from_slice(msg.as_bytes());
    out
}
