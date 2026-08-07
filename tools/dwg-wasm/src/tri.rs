//! Триангуляция плоского многоугольника с отверстиями.
//!
//! Грань ACIS задана не сеткой, а контурами: внешним и, если в грани есть
//! вырезы, внутренними. Чтобы получить треугольники, контуры сводятся в один
//! обход и режутся «отрезанием ушей».
//!
//! Метод выбран не из-за скорости, а из-за устойчивости: в чертежах попадаются
//! вырожденные контуры — повторяющиеся точки, почти нулевая площадь, обход не
//! в ту сторону. Отрезание ушей на таких данных деградирует предсказуемо, а не
//! падает. Граней в теле обычно десятки, точек в контуре — единицы или десятки,
//! так что квадратичная сложность роли не играет.

pub type P2 = [f64; 2];

/// Площадь со знаком: заодно показывает направление обхода.
fn signed_area(pts: &[P2], idx: &[usize]) -> f64 {
    let mut sum = 0.0;
    for i in 0..idx.len() {
        let a = pts[idx[i]];
        let b = pts[idx[(i + 1) % idx.len()]];
        sum += (b[0] - a[0]) * (b[1] + a[1]);
    }
    sum * 0.5
}

fn cross(o: P2, a: P2, b: P2) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/// Лежит ли точка внутри треугольника (границу считаем своей).
fn inside(a: P2, b: P2, c: P2, p: P2) -> bool {
    let d1 = cross(a, b, p);
    let d2 = cross(b, c, p);
    let d3 = cross(c, a, p);
    let neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(neg && pos)
}

/// Врезает отверстие во внешний контур мостом из двух совпадающих рёбер.
///
/// Идея стандартная: от самой правой точки отверстия пускаем луч вправо,
/// находим ближайшее ребро внешнего контура и соединяемся с его вершиной.
/// После врезки многоугольник остаётся односвязным, и его можно резать как
/// обычный.
fn bridge(pts: &[P2], outer: &mut Vec<usize>, hole: &[usize]) {
    // Самая правая точка отверстия — от неё гарантированно виден внешний контур
    let Some(hi) = (0..hole.len()).max_by(|&a, &b| {
        pts[hole[a]][0]
            .partial_cmp(&pts[hole[b]][0])
            .unwrap_or(core::cmp::Ordering::Equal)
    }) else {
        return;
    };
    let m = pts[hole[hi]];

    // Ближайшее пересечение луча с рёбрами внешнего контура
    let mut best: Option<(f64, usize)> = None;
    for i in 0..outer.len() {
        let a = pts[outer[i]];
        let b = pts[outer[(i + 1) % outer.len()]];
        // Ребро должно пересекать горизонталь точки m
        if (a[1] > m[1]) == (b[1] > m[1]) {
            continue;
        }
        let t = (m[1] - a[1]) / (b[1] - a[1]);
        let x = a[0] + t * (b[0] - a[0]);
        if x < m[0] {
            continue; // пересечение слева — луч идёт вправо
        }
        // Берём ту вершину ребра, что правее: она заведомо видна
        let v = if a[0] > b[0] { i } else { (i + 1) % outer.len() };
        if best.is_none_or(|(bx, _)| x < bx) {
            best = Some((x, v));
        }
    }

    let Some((_, at)) = best else { return };

    // Врезка: внешний контур … v, отверстие (с точки hi по кругу), v …
    let mut spliced = Vec::with_capacity(outer.len() + hole.len() + 2);
    spliced.extend_from_slice(&outer[..=at]);
    for k in 0..hole.len() {
        spliced.push(hole[(hi + k) % hole.len()]);
    }
    spliced.push(hole[hi]);
    spliced.extend_from_slice(&outer[at..]);
    *outer = spliced;
}

/// Режет контуры на треугольники.
///
/// Индексы в результате указывают в `pts` — тот же массив, что на входе.
/// Внешний контур и отверстия задаются списками индексов, чтобы вызывающая
/// сторона хранила точки один раз.
pub fn triangulate(pts: &[P2], outer: &[usize], holes: &[Vec<usize>]) -> Vec<[u32; 3]> {
    if outer.len() < 3 {
        return Vec::new();
    }

    // Внешний контур против часовой, отверстия по часовой — тогда мост
    // не самопересекается
    let mut poly: Vec<usize> = outer.to_vec();
    if signed_area(pts, &poly) > 0.0 {
        poly.reverse();
    }

    // Врезаем справа налево: так каждая следующая врезка не ломает предыдущую
    let mut sorted: Vec<Vec<usize>> = holes
        .iter()
        .filter(|h| h.len() >= 3)
        .map(|h| {
            let mut h = h.clone();
            if signed_area(pts, &h) < 0.0 {
                h.reverse();
            }
            h
        })
        .collect();
    sorted.sort_by(|a, b| {
        let ax = a.iter().map(|&i| pts[i][0]).fold(f64::MIN, f64::max);
        let bx = b.iter().map(|&i| pts[i][0]).fold(f64::MIN, f64::max);
        bx.partial_cmp(&ax).unwrap_or(core::cmp::Ordering::Equal)
    });
    for hole in &sorted {
        bridge(pts, &mut poly, hole);
    }

    let mut out = Vec::with_capacity(poly.len());
    let mut guard = poly.len() * 3; // защита от зацикливания на битом контуре

    while poly.len() > 3 && guard > 0 {
        guard -= 1;
        let n = poly.len();
        let mut clipped = false;

        for i in 0..n {
            let ia = poly[(i + n - 1) % n];
            let ib = poly[i];
            let ic = poly[(i + 1) % n];
            let (a, b, c) = (pts[ia], pts[ib], pts[ic]);

            // Ухо должно быть выпуклым…
            if cross(a, b, c) <= 0.0 {
                continue;
            }
            // …и пустым: иначе отрежем кусок с чужой вершиной внутри
            let mut empty = true;
            for &j in &poly {
                if j == ia || j == ib || j == ic {
                    continue;
                }
                if inside(a, b, c, pts[j]) {
                    empty = false;
                    break;
                }
            }
            if !empty {
                continue;
            }

            out.push([ia as u32, ib as u32, ic as u32]);
            poly.remove(i);
            clipped = true;
            break;
        }

        if !clipped {
            // Ухо не нашлось — контур самопересекается или вырожден.
            // Срезаем произвольную вершину: лучше слегка неточная грань,
            // чем потерянная целиком.
            let n = poly.len();
            out.push([poly[n - 1] as u32, poly[0] as u32, poly[1] as u32]);
            poly.remove(0);
        }
    }

    if poly.len() == 3 {
        out.push([poly[0] as u32, poly[1] as u32, poly[2] as u32]);
    }
    out
}
