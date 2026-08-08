//! DWG → геометрия сцены.
//!
//! Ключевая мысль: чертёж почти целиком состоит из повторов. В разобранном
//! файле 14 914 тел, но определений блоков всего около пятисот — остальное
//! копии одной и той же детали, расставленные вставками.
//!
//! Поэтому наружу уходит не сплошной ковёр треугольников, а разделённые части:
//! геометрия каждой детали один раз и список копий с матрицами. Разница
//! решающая — сплошным ковром тот же чертёж весит под 150 МБ и не лезет ни в
//! ограничение загрузки, ни в разумную видеопамять.

use std::collections::HashMap;
use std::io::Cursor;

use acadrust::io::dwg::DwgReader;

use crate::blocks;
use crate::tess::{self, Mesh};
use crate::xform::Xform;

/// Метка формата: JS проверяет её, чтобы не принять за геометрию мусор.
const MAGIC: &[u8; 4] = b"DWGM";
/// Версия 2: детали и копии врозь. В первой был сплошной список треугольников.
const FORMAT_VERSION: u32 = 2;

/// Копия детали в чертеже.
struct Instance {
    part: u32,
    at: Xform,
}

/// Итог разбора: детали, их копии и то, что честно не получилось.
pub struct Converted {
    pub parts: Vec<Mesh>,
    instances: Vec<Instance>,
    pub bodies_ok: usize,
    pub bodies_failed: usize,
}

impl Converted {
    pub fn triangles(&self) -> usize {
        self.parts.iter().map(|m| m.positions.len() / 9).sum()
    }
    pub fn instance_count(&self) -> usize {
        self.instances.len()
    }
    pub fn skipped(&self) -> usize {
        self.parts.iter().map(|m| m.skipped).sum()
    }
}

pub fn convert(bytes: Vec<u8>) -> Result<Converted, String> {
    let mut reader = DwgReader::from_stream(Cursor::new(bytes));
    let doc = reader.read().map_err(|e| format!("не разобрать DWG: {e}"))?;

    let mut parts: Vec<Mesh> = Vec::new();
    let mut instances: Vec<Instance> = Vec::new();
    let mut seen: HashMap<u64, Option<u32>> = HashMap::new();
    let (mut ok, mut failed) = (0usize, 0usize);

    blocks::for_each_body(&doc, &mut |id, acis, at| {
        // Деталь режем один раз; дальше от копии нужна только матрица
        let part = *seen.entry(id).or_insert_with(|| {
            let Some(sat) = acis.parse() else {
                failed += 1;
                return None;
            };
            ok += 1;
            let mut mesh = Mesh::default();
            // Режем в координатах самой детали: место копии добавится матрицей
            let placement = {
                let (m, t, s) = sat.placement();
                Xform::from_acis(m, t, s)
            };
            tess::tessellate(&sat, &placement, &mut mesh);
            if mesh.positions.is_empty() {
                return None;
            }
            parts.push(mesh);
            Some((parts.len() - 1) as u32)
        });

        if let Some(part) = part {
            instances.push(Instance { part, at: *at });
        }
    });

    if parts.is_empty() {
        return Err("в чертеже не нашлось объёмной геометрии".into());
    }

    Ok(Converted {
        parts,
        instances,
        bodies_ok: ok,
        bodies_failed: failed,
    })
}

/// Укладывает результат в буфер для JS.
///
/// Порядок: метка, версия, счётчики, затем детали (у каждой число вершин,
/// координаты и нормали) и следом копии (номер детали и матрица 3×4).
/// Всё в прямом порядке байт — так это читают типизированные массивы во всех
/// браузерах, где мы работаем.
pub fn encode(r: &Converted) -> Vec<u8> {
    let mut out = Vec::with_capacity(64 + r.triangles() * 72 + r.instances.len() * 52);

    out.extend_from_slice(MAGIC);
    for v in [
        FORMAT_VERSION,
        r.parts.len() as u32,
        r.instances.len() as u32,
        r.bodies_ok as u32,
        r.bodies_failed as u32,
        r.skipped() as u32,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }

    for part in &r.parts {
        let verts = (part.positions.len() / 3) as u32;
        out.extend_from_slice(&verts.to_le_bytes());
        for v in part.positions.iter().chain(part.normals.iter()) {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }

    for inst in &r.instances {
        out.extend_from_slice(&inst.part.to_le_bytes());
        // Координаты детали записаны от её собственного начала отсчёта,
        // поэтому его надо вернуть — иначе копия встанет со смещением
        let origin = r.parts[inst.part as usize].origin.unwrap_or([0.0; 3]);
        let shift = inst.at.point(origin);
        // Матрица построчно, последним столбцом — сдвиг: так её ждёт
        // Matrix4.set на стороне JS
        for row in 0..3 {
            for col in 0..3 {
                out.extend_from_slice(&(inst.at.l[row][col] as f32).to_le_bytes());
            }
            out.extend_from_slice(&(shift[row] as f32).to_le_bytes());
        }
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
