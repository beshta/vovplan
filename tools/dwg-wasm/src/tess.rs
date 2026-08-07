//! Разрез тел ACIS на треугольники.
//!
//! Тело задано границей: оболочка из граней, у каждой грани — контуры из рёбер,
//! а под контурами лежит поверхность (плоскость, конус, сфера, тор, сплайн).
//! Треугольников там нет вообще, их нужно построить.
//!
//! Порядок работы: обойти грань по рёбрам и получить контуры точками, потом
//! спроецировать контуры в параметры поверхности и триангулировать уже плоскую
//! задачу. В треугольники идут исходные трёхмерные точки, а не пересчитанные из
//! параметров, — так на границах граней не расходятся швы.
//!
//! Кривизна между точками контура теряется, поэтому рёбра дробятся заранее с
//! запасом по стрелке прогиба: чем круче дуга, тем чаще точки.

use acadrust::entities::acis::{
    SatBody, SatConeSurface, SatDocument, SatEdge, SatEllipseCurve, SatFace, SatLoop, SatLump,
    SatPlaneSurface, SatPointer, SatRecord, SatShell, SatSphereSurface, SatStraightCurve,
    SatTorusSurface, SatVertex, Sense,
};

use crate::tri::{self, P2};
use crate::xform::{V3, Xform};

/// Допустимая стрелка прогиба как доля радиуса. 0,01 даёт около 22 отрезков на
/// полный круг — глазом огранка уже не видна, а треугольников ещё немного.
const CHORD_TOL: f64 = 0.01;
/// Пределы дробления одной дуги: снизу чтобы не выродилась, сверху чтобы
/// окружность радиуса в километр не съела всю память.
const MIN_SEGS: usize = 2;
const MAX_SEGS: usize = 64;

// ── векторная арифметика ─────────────────────────────────────────────────────

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn len(a: V3) -> f64 {
    dot(a, a).sqrt()
}
fn unit(a: V3) -> V3 {
    let l = len(a);
    if l > 1e-12 {
        mul(a, 1.0 / l)
    } else {
        [0.0, 0.0, 1.0]
    }
}
fn t3(t: (f64, f64, f64)) -> V3 {
    [t.0, t.1, t.2]
}

// ── результат ────────────────────────────────────────────────────────────────

/// Треугольники без индексов: каждая вершина принадлежит своему треугольнику.
///
/// Общих вершин здесь и не должно быть — у соседних граней тела разные нормали,
/// и склейка превратила бы рёбра в мыло. Индексный буфер при таком раскладе
/// вырождается в 0,1,2,… и только занимает место.
#[derive(Default)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    /// Грани, которые не удалось разрезать: попадают в отчёт, чтобы потеря
    /// геометрии была видна, а не молча списана.
    pub skipped: usize,
}

impl Mesh {
    /// Кладёт треугольник, переводя оси чертежа в оси сцены.
    ///
    /// В CAD вертикаль — это Z, в three.js — Y. Поворот делается здесь один
    /// раз, чтобы дальше по коду не гадать, в какой системе точка.
    fn push_tri(&mut self, a: V3, b: V3, c: V3, flip: bool) {
        let raw = cross(sub(b, a), sub(c, a));
        let l = len(raw);
        if l < 1e-20 {
            return; // вырожденный треугольник: площади нет, нормали тоже
        }
        let n = if flip {
            mul(raw, -1.0 / l)
        } else {
            mul(raw, 1.0 / l)
        };
        let tri = if flip { [a, c, b] } else { [a, b, c] };
        for p in tri {
            self.positions.push(p[0] as f32);
            self.positions.push(p[2] as f32);
            self.positions.push(-p[1] as f32);
            self.normals.push(n[0] as f32);
            self.normals.push(n[2] as f32);
            self.normals.push(-n[1] as f32);
        }
    }
}

// ── доступ к записям ─────────────────────────────────────────────────────────

fn rec<'a>(doc: &'a SatDocument, p: SatPointer) -> Option<&'a SatRecord> {
    doc.resolve(p)
}

/// Сколько отрезков нужно дуге, чтобы прогиб уложился в допуск.
fn arc_segments(sweep: f64) -> usize {
    // Стрелка прогиба хорды: r(1 - cos(шаг/2)) ≤ tol·r — радиус сокращается,
    // поэтому шаг зависит только от допуска
    let step = 2.0 * (1.0 - CHORD_TOL).clamp(-1.0, 1.0).acos();
    let n = (sweep.abs() / step.max(1e-6)).ceil() as usize;
    n.clamp(MIN_SEGS, MAX_SEGS)
}

/// Точка вершины ребра.
fn vertex_point(doc: &SatDocument, p: SatPointer) -> Option<V3> {
    let v = SatVertex::from_record(rec(doc, p)?)?;
    let pt = acadrust::entities::acis::SatPoint::from_record(rec(doc, v.point())?)?;
    Some(t3(pt.position()))
}

/// Разбивает ребро на точки. Концы берутся у вершин — они точные, а середина
/// достраивается по типу кривой.
fn sample_edge(doc: &SatDocument, edge: &SatEdge) -> Vec<V3> {
    let start = vertex_point(doc, edge.start_vertex());
    let end = vertex_point(doc, edge.end_vertex());

    let curve = rec(doc, edge.curve());
    let kind = curve.map(|r| r.entity_type.as_str()).unwrap_or("");

    // Тип кривой в SAT может прийти с приставкой подтипа, поэтому ищем вхождение
    if kind.contains("ellipse") {
        if let Some(e) = curve.and_then(SatEllipseCurve::from_record) {
            let center = t3(e.center());
            let major = t3(e.major_axis());
            let radius = len(major);
            let minor = mul(unit(cross(t3(e.normal()), major)), radius * e.ratio());
            let (t0, t1) = (edge.start_param(), edge.end_param());
            let sweep = t1 - t0;
            // Параметры дуги иногда приходят мусором; тогда дробить нечего
            if sweep.is_finite() && sweep.abs() > 1e-9 && radius.is_finite() {
                let n = arc_segments(sweep);
                let mut pts = Vec::with_capacity(n + 1);
                for i in 0..=n {
                    let t = t0 + sweep * (i as f64 / n as f64);
                    pts.push(add(center, add(mul(major, t.cos()), mul(minor, t.sin()))));
                }
                // Концы подменяем вершинами: параметры бывают неточны, а швы
                // между гранями должны сходиться идеально
                if let Some(s) = start {
                    pts[0] = s;
                }
                if let Some(e) = end {
                    let last = pts.len() - 1;
                    pts[last] = e;
                }
                return pts;
            }
        }
    }

    // Сплайновые рёбра (intcurve) в acadrust 0.4.1 наружу не отдаются — их
    // выборка появилась только в ветке разработки. Пока такие рёбра идут
    // хордой между вершинами: это 220 рёбер из 9586, около двух процентов,
    // и заметно только на скруглениях.

    if let (Some(s), Some(e)) = (start, end) {
        return vec![s, e];
    }

    // Вершин нет — так бывает у замкнутых рёбер. Отрезок по параметрам прямой:
    // единственный случай, где параметр можно брать напрямую, потому что у
    // прямой он и есть длина вдоль направления.
    if kind.contains("straight") {
        if let Some(c) = curve.and_then(SatStraightCurve::from_record) {
            let (t0, t1) = (edge.start_param(), edge.end_param());
            // У бесконечных рёбер параметры уходят в огромные значения —
            // такое ребро контуру не поможет, а сцену растянет на километры
            if t0.is_finite() && t1.is_finite() && t0.abs() < 1e9 && t1.abs() < 1e9 {
                let root = t3(c.root_point());
                let dir = t3(c.direction());
                return vec![add(root, mul(dir, t0)), add(root, mul(dir, t1))];
            }
        }
    }

    Vec::new()
}

/// Собирает контур грани точками, идя по полурёбрам.
fn loop_points(doc: &SatDocument, lp: &SatLoop) -> Vec<V3> {
    let mut pts: Vec<V3> = Vec::new();
    let first = lp.first_coedge();
    let mut cur = first;
    let mut guard = 4096; // контуры бывают закольцованы с ошибкой

    loop {
        guard -= 1;
        if guard == 0 {
            break;
        }
        let Some(ce) = rec(doc, cur).and_then(acadrust::entities::acis::SatCoedge::from_record)
        else {
            break;
        };
        if let Some(edge) = rec(doc, ce.edge()).and_then(SatEdge::from_record) {
            let mut seg = sample_edge(doc, &edge);
            // Полуребро может смотреть против направления ребра
            if ce.sense() == Sense::Reversed {
                seg.reverse();
            }
            for p in seg {
                // Соседние рёбра делят вершину — дубли контуру вредят
                if pts.last().is_none_or(|l| len(sub(*l, p)) > 1e-9) {
                    pts.push(p);
                }
            }
        }
        cur = ce.next();
        if cur.is_null() || cur.index() == first.index() {
            break;
        }
    }

    // Замыкание тоже дубль
    if pts.len() > 1 && len(sub(pts[0], *pts.last().unwrap())) < 1e-9 {
        pts.pop();
    }
    pts
}

// ── проекция в параметры поверхности ─────────────────────────────────────────

/// Способ разложить точки грани на плоскость для триангуляции.
enum Proj {
    /// Плоскость: обычный базис в её же плоскости.
    Plane { origin: V3, u: V3, v: V3 },
    /// Тело вращения: угол вокруг оси и смещение вдоль неё.
    Axial { center: V3, axis: V3, u: V3, v: V3 },
}

impl Proj {
    fn map(&self, p: V3) -> P2 {
        match self {
            Proj::Plane { origin, u, v } => {
                let d = sub(p, *origin);
                [dot(d, *u), dot(d, *v)]
            }
            Proj::Axial { center, axis, u, v } => {
                let d = sub(p, *center);
                let h = dot(d, *axis);
                let radial = sub(d, mul(*axis, h));
                [dot(radial, *v).atan2(dot(radial, *u)), h]
            }
        }
    }
    fn angular(&self) -> bool {
        matches!(self, Proj::Axial { .. })
    }
    /// Переносит саму проекцию в мир — контуры туда уже перенесены.
    fn moved(self, x: &Xform) -> Proj {
        match self {
            Proj::Plane { origin, u, v } => Proj::Plane {
                origin: x.point(origin),
                u: unit(x.dir(u)),
                v: unit(x.dir(v)),
            },
            Proj::Axial { center, axis, u, v } => Proj::Axial {
                center: x.point(center),
                axis: unit(x.dir(axis)),
                u: unit(x.dir(u)),
                v: unit(x.dir(v)),
            },
        }
    }
}

/// Строит базис в плоскости с нормалью `n`, стараясь опереться на `u`.
fn basis(n: V3, u: V3) -> (V3, V3) {
    // Направление u иногда вырождено или сонаправлено с нормалью —
    // тогда берём любую ось, заведомо не параллельную нормали
    let u = if len(cross(u, n)) < 1e-6 {
        let alt = if n[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        unit(cross(alt, n))
    } else {
        unit(u)
    };
    (u, cross(n, u))
}

/// Строит проекцию по типу поверхности грани.
fn projection(doc: &SatDocument, face: &SatFace, pts: &[V3]) -> Option<Proj> {
    let surf = rec(doc, face.surface())?;
    let kind = surf.entity_type.as_str();

    if kind.contains("plane") {
        let s = SatPlaneSurface::from_record(surf)?;
        let n = unit(t3(s.normal()));
        let (u, v) = basis(n, t3(s.u_direction()));
        return Some(Proj::Plane {
            origin: t3(s.root_point()),
            u,
            v,
        });
    }

    // Конус, сфера и тор различаются только тем, откуда брать ось: для
    // триангуляции всем троим достаточно угла вокруг оси и хода вдоль неё
    let axial = if kind.contains("cone") {
        let s = SatConeSurface::from_record(surf)?;
        Some((t3(s.center()), unit(t3(s.axis())), t3(s.major_axis())))
    } else if kind.contains("sphere") {
        let s = SatSphereSurface::from_record(surf)?;
        Some((t3(s.center()), unit(t3(s.pole())), t3(s.u_direction())))
    } else if kind.contains("torus") {
        let s = SatTorusSurface::from_record(surf)?;
        Some((t3(s.center()), unit(t3(s.normal())), t3(s.u_direction())))
    } else {
        None
    };

    if let Some((center, axis, u_hint)) = axial {
        let (u, v) = basis(axis, u_hint);
        return Some(Proj::Axial {
            center,
            axis,
            u,
            v,
        });
    }

    // Сплайн и всё незнакомое: подбираем плоскость по самим точкам. Для почти
    // плоского куска это точно, для сильно выгнутого — приближение, но таких
    // граней в чертежах доли процента.
    plane_through(pts)
}

/// Плоскость, наилучшим образом проходящая через набор точек.
fn plane_through(pts: &[V3]) -> Option<Proj> {
    if pts.len() < 3 {
        return None;
    }
    // Нормаль по методу Ньюэлла: устойчива к почти вырожденным контурам,
    // в отличие от векторного произведения трёх произвольных точек
    let mut n = [0.0; 3];
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    if len(n) < 1e-15 {
        return None;
    }
    let n = unit(n);
    let (u, v) = basis(n, [1.0, 0.0, 0.0]);
    Some(Proj::Plane {
        origin: pts[0],
        u,
        v,
    })
}

/// Разворачивает углы вдоль контура.
///
/// Угол считается через atan2 и прыгает с π на −π на шве. Если контур шов
/// пересекает, без разворота он в параметрах самопересечётся и триангуляция
/// выдаст мусор.
fn unwrap_angles(uv: &mut [P2]) {
    use core::f64::consts::{PI, TAU};
    for i in 1..uv.len() {
        let d = uv[i][0] - uv[i - 1][0];
        if d > PI {
            uv[i][0] -= TAU;
        } else if d < -PI {
            uv[i][0] += TAU;
        }
    }
}

/// Обходит ли контур ось целиком — тогда в параметрах он вырождается в отрезок
/// и резать его как многоугольник нельзя.
fn spans_full_turn(uv: &[P2]) -> bool {
    use core::f64::consts::PI;
    if uv.len() < 3 {
        return false;
    }
    let (min, max) = uv
        .iter()
        .fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
    max - min > 1.5 * PI
}

/// Сшивает два кольцевых контура лентой треугольников.
///
/// Так выглядит боковая поверхность цилиндра: два круга без боковых рёбер.
/// В параметрах оба круга — горизонтальные отрезки нулевой площади, поэтому
/// обычная триангуляция здесь бессильна.
fn stitch_rings(mesh: &mut Mesh, a: &[(f64, V3)], b: &[(f64, V3)], flip: bool) {
    if a.len() < 3 || b.len() < 3 {
        return;
    }
    // Кольца бывают разбиты на разное число отрезков, поэтому идём по
    // объединённому набору углов и берём в каждом ближайшую точку кольца
    let at = |ring: &[(f64, V3)], ang: f64| -> V3 {
        let mut best = ring[0];
        let mut bd = f64::MAX;
        for &(a2, p) in ring {
            let mut d = (a2 - ang).abs();
            if d > core::f64::consts::PI {
                d = core::f64::consts::TAU - d;
            }
            if d < bd {
                bd = d;
                best = (a2, p);
            }
        }
        best.1
    };
    let mut angles: Vec<f64> = a.iter().chain(b.iter()).map(|&(x, _)| x).collect();
    angles.sort_by(|x, y| x.partial_cmp(y).unwrap_or(core::cmp::Ordering::Equal));
    angles.dedup_by(|x, y| (*x - *y).abs() < 1e-6);
    if angles.len() < 3 {
        return;
    }

    for i in 0..angles.len() {
        let a0 = angles[i];
        let a1 = angles[(i + 1) % angles.len()];
        let (p0, p1) = (at(a, a0), at(a, a1));
        let (q0, q1) = (at(b, a0), at(b, a1));
        mesh.push_tri(p0, p1, q1, flip);
        mesh.push_tri(p0, q1, q0, flip);
    }
}

// ── грань ────────────────────────────────────────────────────────────────────

fn tess_face(doc: &SatDocument, face: &SatFace, x: &Xform, mesh: &mut Mesh) {
    // Собираем все контуры грани
    let mut loops: Vec<Vec<V3>> = Vec::new();
    let mut lp_ptr = face.first_loop();
    let mut guard = 256;
    while !lp_ptr.is_null() && guard > 0 {
        guard -= 1;
        let Some(lp) = rec(doc, lp_ptr).and_then(SatLoop::from_record) else {
            break;
        };
        let pts = loop_points(doc, &lp);
        if pts.len() >= 3 {
            loops.push(pts.into_iter().map(|p| x.point(p)).collect());
        }
        lp_ptr = lp.next_loop();
    }

    if loops.is_empty() {
        mesh.skipped += 1;
        return;
    }

    let flip = face.sense() == Sense::Reversed;
    let all: Vec<V3> = loops.iter().flatten().copied().collect();
    let Some(proj) = projection(doc, face, &all).map(|p| p.moved(x)) else {
        mesh.skipped += 1;
        return;
    };

    // Переводим контуры в параметры
    let mut uvs: Vec<Vec<P2>> = loops
        .iter()
        .map(|l| l.iter().map(|&p| proj.map(p)).collect::<Vec<_>>())
        .collect();
    if proj.angular() {
        for uv in &mut uvs {
            unwrap_angles(uv);
        }

        // Боковина цилиндра: два кольца, ни одно не режется как многоугольник
        if loops.len() == 2 && uvs.iter().all(|uv| spans_full_turn(uv)) {
            let ring = |i: usize| -> Vec<(f64, V3)> {
                uvs[i]
                    .iter()
                    .zip(loops[i].iter())
                    .map(|(uv, &p)| (uv[0], p))
                    .collect()
            };
            stitch_rings(mesh, &ring(0), &ring(1), flip);
            return;
        }
        // Одно кольцо: конус со сходом в точку либо купол. Веер к средней
        // точке — для конуса это точно, для остального близко.
        if loops.len() == 1 && spans_full_turn(&uvs[0]) {
            let ring = &loops[0];
            let apex = mul(
                ring.iter().fold([0.0; 3], |a, &b| add(a, b)),
                1.0 / ring.len() as f64,
            );
            for i in 0..ring.len() {
                mesh.push_tri(apex, ring[i], ring[(i + 1) % ring.len()], flip);
            }
            return;
        }
    }

    // Обычный случай: внешний контур — самый большой по охвату
    let span = |uv: &Vec<P2>| {
        let (x0, x1) = uv
            .iter()
            .fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[0]), hi.max(p[0])));
        let (y0, y1) = uv
            .iter()
            .fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[1]), hi.max(p[1])));
        (x1 - x0) * (y1 - y0)
    };
    let biggest = uvs
        .iter()
        .enumerate()
        .max_by(|a, b| {
            span(a.1)
                .partial_cmp(&span(b.1))
                .unwrap_or(core::cmp::Ordering::Equal)
        })
        .map(|(i, _)| i)
        .unwrap_or(0);

    // Складываем точки всех контуров в один массив: триангуляция работает
    // с индексами, чтобы не копировать координаты
    let mut flat: Vec<P2> = Vec::new();
    let mut pos3: Vec<V3> = Vec::new();
    let mut outer: Vec<usize> = Vec::new();
    let mut holes: Vec<Vec<usize>> = Vec::new();
    for (i, uv) in uvs.iter().enumerate() {
        let idx: Vec<usize> = (0..uv.len()).map(|k| flat.len() + k).collect();
        flat.extend_from_slice(uv);
        pos3.extend_from_slice(&loops[i]);
        if i == biggest {
            outer = idx;
        } else {
            holes.push(idx);
        }
    }

    let tris = tri::triangulate(&flat, &outer, &holes);
    if tris.is_empty() {
        mesh.skipped += 1;
        return;
    }
    for t in tris {
        mesh.push_tri(
            pos3[t[0] as usize],
            pos3[t[1] as usize],
            pos3[t[2] as usize],
            flip,
        );
    }
}

// ── тело ─────────────────────────────────────────────────────────────────────

/// Разрезает все тела документа и ставит их на место.
///
/// `at` — где тело стоит в чертеже: произведение матриц всех вставок блоков,
/// внутри которых оно лежит. Внутри к нему добавляется собственное размещение
/// данных ACIS, если оно там задано.
pub fn tessellate(doc: &SatDocument, at: &Xform, mesh: &mut Mesh) {
    let x = at.then(&crate::xform::acis_placement(doc));

    for i in 0..doc.record_count() {
        let Some(r) = doc.record(i) else { continue };
        if r.entity_type != "body" {
            continue;
        }
        let Some(body) = SatBody::from_record(r) else {
            continue;
        };

        // тело → комки → оболочки → грани
        let mut lump_ptr = body.lump();
        let mut lg = 256;
        while !lump_ptr.is_null() && lg > 0 {
            lg -= 1;
            let Some(lump) = rec(doc, lump_ptr).and_then(SatLump::from_record) else {
                break;
            };
            let mut shell_ptr = lump.shell();
            let mut sg = 256;
            while !shell_ptr.is_null() && sg > 0 {
                sg -= 1;
                let Some(shell) = rec(doc, shell_ptr).and_then(SatShell::from_record) else {
                    break;
                };
                let mut face_ptr = shell.face();
                let mut fg = 65536;
                while !face_ptr.is_null() && fg > 0 {
                    fg -= 1;
                    let Some(face) = rec(doc, face_ptr).and_then(SatFace::from_record) else {
                        break;
                    };
                    tess_face(doc, &face, &x, mesh);
                    face_ptr = face.next_face();
                }
                shell_ptr = shell.next_shell();
            }
            lump_ptr = lump.next_lump();
        }
    }
}
