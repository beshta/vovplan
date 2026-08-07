//! Разведка: что на самом деле лежит внутри тел ACIS.
//!
//! Первая разведка на LibreDWG показала только «64 тела ACIS» — этого мало,
//! чтобы планировать работу. Тесселяция пишется отдельно под каждый тип
//! поверхности: плоскость — это полигон с дырками, цилиндр и конус — развёртка
//! по параметру, сфера и тор — сетка по двум углам, сплайн — самое дорогое.
//!
//! Отчёт показывает, какие поверхности встречаются в реальных чертежах, чтобы
//! писать ровно нужное и не тратить недели на случаи, которых здесь нет.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Cursor;

use acadrust::entities::acis::SatDocument;
use acadrust::entities::solid3d::AcisData;
use acadrust::entities::EntityType;
use acadrust::io::dwg::DwgReader;
use acadrust::CadDocument;

/// Предел раскрытия вложенных блоков. Блок внутри блока — обычное дело,
/// но встречаются и circular-ссылки, поэтому глубина ограничена.
const MAX_DEPTH: u32 = 8;

#[derive(Default)]
struct Stats {
    /// Сущности чертежа: LINE, INSERT, 3DSOLID…
    entities: BTreeMap<String, usize>,
    /// Записи внутри ACIS: plane-surface, cone-surface, spline-surface…
    acis: BTreeMap<String, usize>,
    bodies_parsed: usize,
    bodies_failed: usize,
    faces: usize,
    /// Тела в двоичном SAB против текстового SAT — форматы разбираются
    /// по-разному, и полезно видеть, что вообще приходит.
    binary_bodies: usize,
    text_bodies: usize,
    /// Байт данных ACIS всего: пустые тела выглядят как сбой разбора,
    /// хотя на деле в них просто ничего нет.
    acis_bytes: usize,
}

fn bump(map: &mut BTreeMap<String, usize>, key: &str) {
    *map.entry(key.to_string()).or_insert(0) += 1;
}

/// Имя варианта перечисления без содержимого: `Solid3D(..)` → `Solid3D`.
fn variant_name(e: &EntityType) -> String {
    let dbg = format!("{e:?}");
    dbg.split(['(', ' ', '{'])
        .next()
        .unwrap_or("?")
        .to_string()
}

/// Разбирает данные тела независимо от формата: `parse` сам выбирает между
/// текстовым SAT и двоичным SAB (тот пришёл с DWG R2013 и новее).
fn probe_body(stats: &mut Stats, acis: &AcisData) {
    if acis.is_binary {
        stats.binary_bodies += 1;
    } else {
        stats.text_bodies += 1;
    }
    stats.acis_bytes += acis.size();
    probe_acis(stats, acis.parse());
}

fn probe_acis(stats: &mut Stats, sat: Option<SatDocument>) {
    let Some(doc) = sat else {
        stats.bodies_failed += 1;
        return;
    };
    stats.bodies_parsed += 1;
    stats.faces += doc.faces().len();
    for i in 0..doc.record_count() {
        if let Some(rec) = doc.record(i) {
            bump(&mut stats.acis, &rec.entity_type);
        }
    }
}

fn walk(stats: &mut Stats, doc: &mut CadDocument, items: Vec<EntityType>, depth: u32) {
    for item in items {
        bump(&mut stats.entities, &variant_name(&item));

        match &item {
            // Вставка блока: раскрываем содержимое с уже наложенными матрицами
            EntityType::Insert(_) if depth < MAX_DEPTH => {
                let children = doc.explode_entity(&item);
                if !children.is_empty() {
                    walk(stats, doc, children, depth + 1);
                }
            }
            EntityType::Solid3D(s) => probe_body(stats, &s.acis_data),
            EntityType::Region(r) => probe_body(stats, &r.acis_data),
            EntityType::Body(b) => probe_body(stats, &b.acis_data),
            _ => {}
        }
    }
}

/// Разбирает файл и складывает человекочитаемый отчёт.
pub fn report(bytes: Vec<u8>) -> String {
    let mut out = String::new();

    let mut reader = DwgReader::from_stream(Cursor::new(bytes));
    let mut doc = match reader.read() {
        Ok(d) => d,
        Err(e) => return format!("не разобрать файл: {e}"),
    };

    let top: Vec<EntityType> = doc.entities().cloned().collect();
    let _ = writeln!(out, "сущностей в модели: {}", top.len());

    let mut stats = Stats::default();
    walk(&mut stats, &mut doc, top, 0);

    let line = "─".repeat(52);
    let _ = writeln!(out, "\n{line}\nСУЩНОСТИ ЧЕРТЕЖА (блоки раскрыты)");
    let mut ents: Vec<_> = stats.entities.iter().collect();
    ents.sort_by(|a, b| b.1.cmp(a.1));
    for (k, v) in ents.iter().take(20) {
        let _ = writeln!(out, "  {k:<30} {v:>8}");
    }

    let _ = writeln!(
        out,
        "\nТЕЛА ACIS: разобрано {}, не вышло {}, граней {}",
        stats.bodies_parsed, stats.bodies_failed, stats.faces
    );
    let _ = writeln!(
        out,
        "  формат: двоичных SAB {}, текстовых SAT {}, данных {} КБ",
        stats.binary_bodies,
        stats.text_bodies,
        stats.acis_bytes / 1024
    );

    let _ = writeln!(out, "\nСОСТАВ ACIS");
    let mut acis: Vec<_> = stats.acis.iter().collect();
    acis.sort_by(|a, b| b.1.cmp(a.1));
    for (k, v) in acis.iter().take(30) {
        let _ = writeln!(out, "  {k:<30} {v:>8}");
    }

    // Главный вопрос: какие поверхности надо научиться резать
    let _ = writeln!(out, "\n{line}\nЧТО ПРИДЁТСЯ РЕАЛИЗОВАТЬ");
    for (key, label) in [
        ("plane-surface", "плоскости — триангуляция полигона"),
        ("cone-surface", "цилиндры и конусы — развёртка по параметру"),
        ("sphere-surface", "сферы — сетка по двум углам"),
        ("torus-surface", "торы — сетка по двум углам"),
        ("spline-surface", "сплайны — самое трудоёмкое"),
    ] {
        let n = stats.acis.get(key).copied().unwrap_or(0);
        let mark = if n > 0 { "нужно" } else { "не встречается" };
        let _ = writeln!(out, "  {label:<44} {n:>6}  {mark}");
    }

    out
}
