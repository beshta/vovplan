//! Разведка: что на самом деле лежит внутри чертежа.
//!
//! Тесселяция пишется отдельно под каждый тип поверхности: плоскость — это
//! полигон с дырками, цилиндр и конус — развёртка по параметру, сфера и тор —
//! сетка по двум углам, сплайн — самое дорогое. Отчёт показывает, что реально
//! встречается, чтобы писать нужное и не тратить время на остальное.
//!
//! Второе назначение — сверка положения. Габариты, посчитанные по геометрии,
//! сравниваются с теми, что записал сам AutoCAD в заголовок файла. Расхождение
//! означает потерянные матрицы вставок, и увидеть это надо сразу, а не когда
//! модель окажется в сцене не на своём месте.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Cursor;

use acadrust::entities::acis::{SatDocument, SatPoint};
use acadrust::io::dwg::DwgReader;

use crate::blocks;
use crate::xform::Xform;

#[derive(Default)]
struct Stats {
    /// Записи внутри ACIS: plane-surface, cone-surface, spline-surface…
    acis: BTreeMap<String, usize>,
    bodies_parsed: usize,
    bodies_failed: usize,
    faces: usize,
    /// Тела в двоичном SAB против текстового SAT — форматы разбираются
    /// по-разному, и полезно видеть, что вообще приходит.
    binary_bodies: usize,
    text_bodies: usize,
    acis_bytes: usize,
    /// Габарит геометрии на своих местах — для сверки с заголовком чертежа.
    lo: [f64; 3],
    hi: [f64; 3],
    /// Насколько далеко вставки блоков уносят тела и сколько тел остаются
    /// на месте: по этому видно, доходит ли цепочка вставок до геометрии.
    shift_max: f64,
    no_shift: usize,
    /// Отдельный габарит тел, лежащих прямо в модели, без всяких блоков.
    /// Если он верен, а общий — нет, виноваты матрицы вставок; если неверен
    /// и он, дело в разборе самих данных ACIS.
    plain_lo: [f64; 3],
    plain_hi: [f64; 3],
    plain_bodies: usize,
}

impl Stats {
    /// Габарит копится минимумами и максимумами, поэтому начинать надо
    /// с противоположных краёв, а не с нулей.
    fn new() -> Self {
        Self {
            lo: [f64::MAX; 3],
            hi: [f64::MIN; 3],
            plain_lo: [f64::MAX; 3],
            plain_hi: [f64::MIN; 3],
            ..Default::default()
        }
    }

    fn see(&mut self, p: [f64; 3], plain: bool) {
        for k in 0..3 {
            self.lo[k] = self.lo[k].min(p[k]);
            self.hi[k] = self.hi[k].max(p[k]);
            if plain {
                self.plain_lo[k] = self.plain_lo[k].min(p[k]);
                self.plain_hi[k] = self.plain_hi[k].max(p[k]);
            }
        }
    }
}

fn scan(stats: &mut Stats, doc: &SatDocument, at: &Xform, plain: bool) {
    stats.bodies_parsed += 1;
    if plain {
        stats.plain_bodies += 1;
    }
    stats.faces += doc.faces().len();
    for i in 0..doc.record_count() {
        let Some(rec) = doc.record(i) else { continue };
        *stats.acis.entry(rec.entity_type.clone()).or_insert(0) += 1;

        // Точки смотрим уже поставленными на место: только так габарит
        // сопоставим с заголовком файла
        if rec.entity_type == "point" {
            if let Some(p) = SatPoint::from_record(rec) {
                let (x, y, z) = p.position();
                stats.see(at.point([x, y, z]), plain);
            }
        }
    }
}

/// Разбирает файл и складывает человекочитаемый отчёт.
pub fn report(bytes: Vec<u8>) -> String {
    let mut out = String::new();

    let mut reader = DwgReader::from_stream(Cursor::new(bytes));
    let doc = match reader.read() {
        Ok(d) => d,
        Err(e) => return format!("не разобрать файл: {e}"),
    };

    // Большинство тел встают правильно, картину портит меньшинство. Поэтому
    // разбираем не первые попавшиеся, а те, что вышли за габариты чертежа:
    // именно они и объясняют расхождение.
    let hx = (
        doc.header.model_space_extents_min,
        doc.header.model_space_extents_max,
    );
    let margin = ((hx.1.x - hx.0.x).abs() + (hx.1.y - hx.0.y).abs()) * 0.5 + 1.0;
    let out_of_range = |p: [f64; 3]| {
        p[0] < hx.0.x - margin
            || p[0] > hx.1.x + margin
            || p[1] < hx.0.y - margin
            || p[1] > hx.1.y + margin
    };

    let mut detail = String::new();
    let mut shown = 0;
    let mut strays = 0usize;
    blocks::for_each_body(&doc, &mut |acis, at| {
        let Some(sat) = acis.parse() else { return };
        let (mut lo, mut hi) = ([f64::MAX; 3], [f64::MIN; 3]);
        let mut n_tr = 0;
        for i in 0..sat.record_count() {
            let Some(r) = sat.record(i) else { continue };
            if r.entity_type == "transform" {
                n_tr += 1;
            }
            if r.entity_type != "point" {
                continue;
            }
            if let Some(p) = SatPoint::from_record(r) {
                let (x, y, z) = p.position();
                for (k, v) in [x, y, z].into_iter().enumerate() {
                    lo[k] = lo[k].min(v);
                    hi[k] = hi[k].max(v);
                }
            }
        }
        if lo[0] > hi[0] {
            return;
        }

        // Куда тело встаёт на самом деле
        let placed = at.then(&crate::xform::acis_placement(&sat));
        let centre = placed.point([
            (lo[0] + hi[0]) * 0.5,
            (lo[1] + hi[1]) * 0.5,
            (lo[2] + hi[2]) * 0.5,
        ]);
        if !out_of_range(centre) {
            return;
        }
        strays += 1;
        if shown >= 5 {
            return;
        }
        shown += 1;
        let (_, t, s) = sat.placement();
        let _ = writeln!(
            detail,
            "  тело {shown}: точки X {:.0}…{:.0} Y {:.0}…{:.0} Z {:.0}…{:.0}",
            lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]
        );
        let _ = writeln!(
            detail,
            "     размещение ACIS: сдвиг ({:.0}, {:.0}, {:.0}) масштаб {s:.3}, записей transform {n_tr}",
            t[0], t[1], t[2]
        );
        let _ = writeln!(
            detail,
            "     вставками перенесено на ({:.0}, {:.0}, {:.0})",
            at.t[0], at.t[1], at.t[2]
        );
    });

    let mut stats = Stats::new();
    blocks::for_each_body(&doc, &mut |acis, at| {
        if acis.is_binary {
            stats.binary_bodies += 1;
        } else {
            stats.text_bodies += 1;
        }
        stats.acis_bytes += acis.size();

        // Куда вставки блоков переносят тело. Если сдвиги почти нулевые,
        // значит цепочка вставок до тела не доходит.
        let far = at.t[0].abs().max(at.t[1].abs()).max(at.t[2].abs());
        stats.shift_max = stats.shift_max.max(far);
        // Тело лежит прямо в модели, если ни одна вставка его не двигала
        let plain = far < 1e-9;
        if plain {
            stats.no_shift += 1;
        }

        match acis.parse() {
            Some(sat) => {
                let placed = at.then(&crate::xform::acis_placement(&sat));
                scan(&mut stats, &sat, &placed, plain);
            }
            None => stats.bodies_failed += 1,
        }
    });

    let line = "─".repeat(52);

    // Разброс параметров по всем вставкам файла: точки вставок должны лежать
    // в пределах чертежа, а масштабы — быть разумными. Выброс здесь объясняет
    // выброс в геометрии.
    let _ = writeln!(
        out,
        "ТЕЛА ВНЕ ГАБАРИТОВ ЧЕРТЕЖА: {strays}\n{detail}"
    );

    let _ = writeln!(out, "ВСТАВКИ");
    let mut n_ins = 0usize;
    let (mut pmin, mut pmax) = ([f64::MAX; 3], [f64::MIN; 3]);
    let (mut smin, mut smax) = (f64::MAX, f64::MIN);
    let mut tilted = 0usize;
    let mut names: BTreeMap<String, usize> = BTreeMap::new();
    for e in doc.entities() {
        let acadrust::entities::EntityType::Insert(ins) = e else {
            continue;
        };
        n_ins += 1;
        *names.entry(ins.block_name.clone()).or_insert(0) += 1;
        let p = [ins.insert_point.x, ins.insert_point.y, ins.insert_point.z];
        for k in 0..3 {
            pmin[k] = pmin[k].min(p[k]);
            pmax[k] = pmax[k].max(p[k]);
        }
        for s in [ins.x_scale(), ins.y_scale(), ins.z_scale()] {
            smin = smin.min(s);
            smax = smax.max(s);
        }
        // Ось выдавливания не вертикальна — такая вставка переставляет оси
        if (ins.normal.z - 1.0).abs() > 1e-9 {
            tilted += 1;
        }
    }
    let _ = writeln!(out, "  всего {n_ins}, разных блоков {}", names.len());
    if n_ins > 0 {
        let _ = writeln!(
            out,
            "  точки: X {:.0}…{:.0}  Y {:.0}…{:.0}  Z {:.0}…{:.0}",
            pmin[0], pmax[0], pmin[1], pmax[1], pmin[2], pmax[2]
        );
        let _ = writeln!(
            out,
            "  масштабы {smin:.3}…{smax:.3}, с непрямой осью: {tilted}"
        );
    }
    let mut top: Vec<_> = names.iter().collect();
    top.sort_by(|a, b| b.1.cmp(a.1));
    for (name, count) in top.iter().take(6) {
        let _ = writeln!(out, "    «{name}» ×{count}");
    }
    let _ = writeln!(out);

    // Сверка положения — первое, что нужно видеть
    let h_lo = doc.header.model_space_extents_min;
    let h_hi = doc.header.model_space_extents_max;
    let _ = writeln!(out, "ПОЛОЖЕНИЕ");
    let _ = writeln!(
        out,
        "  заголовок чертежа: X {:.0}…{:.0}  Y {:.0}…{:.0}  Z {:.0}…{:.0}",
        h_lo.x, h_hi.x, h_lo.y, h_hi.y, h_lo.z, h_hi.z
    );
    if stats.lo[0] <= stats.hi[0] {
        let _ = writeln!(
            out,
            "  наша геометрия:    X {:.0}…{:.0}  Y {:.0}…{:.0}  Z {:.0}…{:.0}",
            stats.lo[0], stats.hi[0], stats.lo[1], stats.hi[1], stats.lo[2], stats.hi[2]
        );
    }
    if stats.plain_lo[0] <= stats.plain_hi[0] {
        let _ = writeln!(
            out,
            "  из них без блоков ({} тел): X {:.0}…{:.0}  Y {:.0}…{:.0}  Z {:.0}…{:.0}",
            stats.plain_bodies,
            stats.plain_lo[0], stats.plain_hi[0],
            stats.plain_lo[1], stats.plain_hi[1],
            stats.plain_lo[2], stats.plain_hi[2]
        );
    }

    let _ = writeln!(
        out,
        "\n{line}\nТЕЛА ACIS: разобрано {}, не вышло {}, граней {}",
        stats.bodies_parsed, stats.bodies_failed, stats.faces
    );
    let _ = writeln!(
        out,
        "  перенос вставками: макс. {:.0}, тел без переноса {}",
        stats.shift_max, stats.no_shift
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
    for (k, v) in acis.iter().take(24) {
        let _ = writeln!(out, "  {k:<30} {v:>8}");
    }

    let _ = writeln!(out, "\n{line}\nПОВЕРХНОСТИ");
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
