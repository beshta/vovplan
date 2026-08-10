//! Обход чертежа с раскрытием вставок блоков.
//!
//! Блок в DWG — это определение, которое чертёж вставляет много раз, каждый раз
//! со своим сдвигом, поворотом и масштабом. Геометрия внутри блока лежит в его
//! собственных координатах, поэтому без раскрытия все копии сливаются в одну.
//!
//! Собственный обход понадобился потому, что `explode_entity` у acadrust
//! считает `INSERT` неделимой сущностью и возвращает пустой список: раскрытие
//! блоков — не её задача.

use acadrust::entities::solid3d::AcisData;
use acadrust::entities::{EntityType, Mesh as DwgMesh};
use acadrust::CadDocument;

use crate::xform::{V3, Xform};

/// Предел вложенности. Блок внутри блока — обычное дело, но в битых файлах
/// встречаются и кольцевые ссылки, на которых обход не кончится никогда.
const MAX_DEPTH: u32 = 12;

fn v3(v: acadrust::types::Vector3) -> V3 {
    [v.x, v.y, v.z]
}

/// Матрица одной вставки с учётом точки привязки её блока.
fn insert_xform(doc: &CadDocument, ins: &acadrust::entities::Insert) -> Xform {
    let base = doc
        .block_records
        .get(&ins.block_name)
        .map(|b| v3(b.base_point))
        .unwrap_or([0.0; 3]);
    Xform::insert(
        v3(ins.insert_point),
        [ins.x_scale(), ins.y_scale(), ins.z_scale()],
        ins.rotation,
        v3(ins.normal),
        base,
    )
}

/// Чем в чертеже задан объём.
///
/// Два способа, и работы с ними принципиально разное количество: тело — это
/// граница из поверхностей, её надо резать; сетка уже готова.
pub enum Shape<'a> {
    /// Тело ACIS: 3DSOLID, REGION, BODY
    Acis(&'a AcisData),
    /// Готовая сетка: MESH
    Mesh(&'a DwgMesh),
}

/// Что обход увидел в пространстве модели.
///
/// Нужно ради внятного отказа: «в чертеже не нашлось объёмной геометрии» не
/// отличает файл, где тел нет вовсе, от файла, где объём сделан сетками, —
/// а это разные беды с разными ответами человеку.
#[derive(Default)]
pub struct Seen {
    /// Сущностей просмотрено, с раскрытием вставок блоков
    pub entities: usize,
    /// Из них таких, которые обход читать не умеет (сетки, поверхности, прокси)
    pub unhandled: usize,
    /// POLYFACE_MESH — сетка из граней, обычная для старых чертежей
    pub polyface: usize,
    /// 3DFACE — отдельные треугольники и четырёхугольники
    pub faces3d: usize,
    /// SURFACE — поверхности ACAD_SURFACE (выдавливание, вращение и прочее)
    pub surfaces: usize,
}

impl Seen {
    /// Чем в этом чертеже сделан объём — перечисление для отказа.
    /// Пусто, если ничего похожего на объём не нашлось вовсе.
    pub fn shapes(&self) -> String {
        [
            ("POLYFACE_MESH", self.polyface),
            ("3DFACE", self.faces3d),
            ("SURFACE", self.surfaces),
        ]
        .iter()
        .filter(|(_, n)| *n > 0)
        .map(|(name, n)| format!("{name} — {n}"))
        .collect::<Vec<_>>()
        .join(", ")
    }
}

/// Прогоняет `f` по каждому телу ACIS чертежа вместе с его местом в мире.
///
/// Тела отдаются как есть, в своих координатах, а место передаётся отдельной
/// матрицей — так одно и то же определение блока не приходится копировать и
/// переписывать на каждую из сотен вставок.
///
/// Первым аргументом идёт дескриптор тела. Он один и тот же у всех копий
/// одного определения блока, и по нему вызывающая сторона узнаёт повтор:
/// резать одну и ту же деталь заново для каждой из сотен вставок незачем.
pub fn for_each_body(doc: &CadDocument, f: &mut impl FnMut(u64, Shape, &Xform)) -> Seen {
    // Начинать надо строго с пространства модели. Общий список документа
    // содержит и внутренности определений блоков: пойти по нему значит выдать
    // каждый блок лишний раз, в его собственных координатах у нуля, вдобавок
    // к настоящим копиям, расставленным вставками.
    let root: Vec<&EntityType> = doc
        .block_records
        .iter()
        .find(|b| b.is_model_space())
        .map(|ms| {
            ms.entity_handles
                .iter()
                .filter_map(|h| doc.get_entity(*h))
                .collect()
        })
        .unwrap_or_default();

    let mut chain: Vec<String> = Vec::new();
    let mut seen = Seen::default();
    walk(doc, &root, &Xform::ID, 0, &mut chain, &mut seen, f);
    seen
}

fn walk(
    doc: &CadDocument,
    items: &[&EntityType],
    at: &Xform,
    depth: u32,
    // Цепочка блоков, внутри которых мы сейчас находимся. Нужна против
    // самоссылок: блок, который прямо или через другой блок вставляет сам
    // себя, иначе раскрывался бы до предела глубины, каждый раз добавляя
    // свой сдвиг, и разносил бы геометрию на километры от чертежа.
    chain: &mut Vec<String>,
    seen: &mut Seen,
    f: &mut impl FnMut(u64, Shape, &Xform),
) {
    for item in items {
        // Дескриптор сущности уникален в файле и одинаков у всех копий блока
        let id = item.common().handle.value();
        seen.entities += 1;
        match item {
            EntityType::Solid3D(s) => f(id, Shape::Acis(&s.acis_data), at),
            EntityType::Region(r) => f(id, Shape::Acis(&r.acis_data), at),
            EntityType::Body(b) => f(id, Shape::Acis(&b.acis_data), at),
            EntityType::Mesh(m) => f(id, Shape::Mesh(m), at),

            EntityType::Insert(ins) if depth < MAX_DEPTH => {
                if chain.iter().any(|b| b == &ins.block_name) {
                    continue; // самоссылка: дальше только повторы
                }
                let Some(block) = doc.block_records.get(&ins.block_name) else {
                    continue;
                };
                // Содержимое блока достаём по ссылкам: сами сущности лежат
                // общим списком документа
                let children: Vec<&EntityType> = block
                    .entity_handles
                    .iter()
                    .filter_map(|h| doc.get_entity(*h))
                    .collect();
                if children.is_empty() {
                    continue;
                }

                let step = at.then(&insert_xform(doc, ins));

                // MINSERT: одна вставка может задавать целую решётку копий.
                // Обычно строка и столбец ровно один, но если их больше,
                // пропустить остальные значит потерять геометрию.
                let cols = ins.column_count.max(1) as i32;
                let rows = ins.row_count.max(1) as i32;
                chain.push(ins.block_name.clone());
                for r in 0..rows {
                    for c in 0..cols {
                        let cell = if r == 0 && c == 0 {
                            step
                        } else {
                            // Шаг решётки задан в координатах блока,
                            // поэтому поворот вставки на него тоже действует
                            let off = step.dir([
                                c as f64 * ins.column_spacing,
                                r as f64 * ins.row_spacing,
                                0.0,
                            ]);
                            Xform {
                                l: step.l,
                                t: [
                                    step.t[0] + off[0],
                                    step.t[1] + off[1],
                                    step.t[2] + off[2],
                                ],
                            }
                        };
                        walk(doc, &children, &cell, depth + 1, chain, seen, f);
                    }
                }
                chain.pop();
            }
            // Сетки, поверхности, прокси и вся плоская графика: читать их
            // обход не умеет, но знать, что именно было, — важно
            other => {
                seen.unhandled += 1;
                match other {
                    EntityType::PolyfaceMesh(_) => seen.polyface += 1,
                    EntityType::Face3D(_) => seen.faces3d += 1,
                    EntityType::Surface(_) => seen.surfaces += 1,
                    _ => {}
                }
            }
        }
    }
}
