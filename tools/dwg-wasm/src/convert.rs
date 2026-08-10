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
use crate::units;
use crate::tess::{self, Mesh};
use crate::xform::Xform;

/// Метка формата: JS проверяет её, чтобы не принять за геометрию мусор.
const MAGIC: &[u8; 4] = b"DWGM";
/// Версия 3: добавлены единицы чертежа. Во второй появились детали и копии
/// врозь, в первой был сплошной список треугольников.
const FORMAT_VERSION: u32 = 3;

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
    /// Во сколько метров перевели юнит чертежа. Пересчёт уже сделан, но
    /// множитель отдаём наружу: человек должен видеть, из чего мы исходили,
    /// и мочь поправить неверно подписанный чертёж.
    pub unit_scale: f64,
}

impl Converted {
    pub fn triangles(&self) -> usize {
        self.parts.iter().map(|m| m.positions.len() / 9).sum()
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

    let seen = blocks::for_each_body(&doc, &mut |id, shape, at| {
        // Деталь режем один раз; дальше от копии нужна только матрица
        let part = *seen.entry(id).or_insert_with(|| {
            let mut mesh = Mesh::default();
            match shape {
                blocks::Shape::Acis(acis) => {
                    let Some(sat) = acis.parse() else {
                        failed += 1;
                        return None;
                    };
                    ok += 1;
                    // Режем в координатах самой детали: место копии добавится матрицей
                    let placement = {
                        let (m, t, s) = sat.placement();
                        Xform::from_acis(m, t, s)
                    };
                    tess::tessellate(&sat, &placement, &mut mesh);
                }
                // У сетки резать нечего — вершины и грани уже готовы
                blocks::Shape::Mesh(src) => {
                    ok += 1;
                    crate::mesh::build(src, &mut mesh);
                }
            }
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
        /*
         * Раньше здесь была одна фраза на три совершенно разные беды, и по ней
         * нельзя было понять, что делать: экспортировать чертёж иначе, прислать
         * файл на разбор или чинить тесселяцию. Теперь отказ говорит, что
         * именно увидел обход.
         */
        return Err(if ok == 0 && failed == 0 {
            let shapes = seen.shapes();
            let made_of = if shapes.is_empty() {
                "и ничего похожего на объём тоже".to_string()
            } else {
                format!("объём в нём сделан так: {shapes}")
            };
            format!(
                "тел ACIS (3DSOLID, REGION, BODY) в чертеже нет — {made_of}. \
                 Просмотрено {} объектов, из них {} не тех видов, что мы читаем. \
                 Пересохраните из AutoCAD с преобразованием в тела (CONVTOSOLID) \
                 либо экспортируйте FBX/OBJ.",
                seen.entities, seen.unhandled,
            )
        } else if ok == 0 {
            format!(
                "тел найдено {failed}, но ни одно не удалось разобрать — \
                 похоже, в чертеже ACIS той версии, которую мы ещё не понимаем",
            )
        } else {
            format!(
                "тел разобрано {ok} (не поддалось {failed}), но ни одно не дало \
                 ни одного треугольника — это уже наша ошибка в тесселяции",
            )
        });
    }

    // Приводим к метрам сцены. Масштабируем координаты деталей и сдвиги копий,
    // но не линейную часть матриц: повороты и зеркала от смены единиц не
    // зависят, а повторный множитель там дал бы масштаб в квадрате.
    let insunits = doc.header.insertion_units;
    let (unit_scale, _) = units::resolve(insunits);
    if unit_scale != 1.0 {
        let k = unit_scale as f32;
        for part in &mut parts {
            for v in &mut part.positions {
                *v *= k;
            }
            if let Some(o) = part.origin.as_mut() {
                for v in o.iter_mut() {
                    *v *= unit_scale;
                }
            }
        }
        for inst in &mut instances {
            for v in inst.at.t.iter_mut() {
                *v *= unit_scale;
            }
        }
    }

    Ok(Converted {
        parts,
        instances,
        bodies_ok: ok,
        bodies_failed: failed,
        unit_scale,
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
        // Множитель в миллиметрах на юнит: целым числом, чтобы не заводить
        // в заголовке единственное дробное поле ради одного значения
        (r.unit_scale * 1000.0).round() as u32,
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
