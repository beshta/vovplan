//! Чтение DWG в браузере.
//!
//! Наружу торчит голый C-ABI: указатель и длина, никакого wasm-bindgen. Так
//! сборка не зависит от генератора обвязки и его версий — на выходе один
//! `.wasm`, который фронтенд грузит ленивым чанком.
//!
//! Обмен памятью: JS просит `dwg_alloc`, кладёт туда файл, зовёт разбор,
//! читает результат и возвращает память через `dwg_free`.

mod blocks;
mod convert;
mod probe;
mod rng;
mod tess;
mod tri;
mod xform;

use std::alloc::{alloc, dealloc, Layout};

/// Выделяет буфер под входной файл. JS пишет туда байты DWG.
///
/// # Safety
/// Полученный указатель обязан вернуться в [`dwg_free`] с той же длиной.
#[no_mangle]
pub unsafe extern "C" fn dwg_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return core::ptr::null_mut();
    }
    match Layout::from_size_align(len, 1) {
        Ok(layout) => alloc(layout),
        Err(_) => core::ptr::null_mut(),
    }
}

/// Освобождает буфер, выданный [`dwg_alloc`] или возвращённый разбором.
///
/// # Safety
/// `ptr` и `len` обязаны быть теми же, что при выделении.
#[no_mangle]
pub unsafe extern "C" fn dwg_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len, 1) {
        dealloc(ptr, layout);
    }
}

/// Длина последнего результата. JS читает её сразу после вызова разбора:
/// вернуть из функции два значения C-ABI не позволяет.
static mut LAST_LEN: usize = 0;

/// # Safety
/// Значение осмысленно только сразу после вызова, вернувшего непустой указатель.
#[no_mangle]
pub unsafe extern "C" fn dwg_last_len() -> usize {
    LAST_LEN
}

/// Отдаёт содержимое наружу: запоминает длину и передаёт владение памятью JS.
fn hand_over(bytes: Vec<u8>) -> *mut u8 {
    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    // wasm однопоточный, гонка невозможна
    unsafe { LAST_LEN = boxed.len() };
    core::mem::forget(boxed);
    ptr
}

/// Разбирает DWG и возвращает текстовый отчёт о содержимом — какие сущности
/// в чертеже и из каких поверхностей собраны тела ACIS.
///
/// Это разведка, а не конвертация: по её итогам видно, какие типы поверхностей
/// действительно нужно уметь резать на треугольники.
///
/// # Safety
/// `ptr` и `len` описывают буфер, полученный из [`dwg_alloc`]. Владение
/// буфером переходит в функцию — освобождать его отдельно не нужно.
#[no_mangle]
pub unsafe extern "C" fn dwg_probe(ptr: *mut u8, len: usize) -> *mut u8 {
    let bytes = Vec::from_raw_parts(ptr, len, len);
    let report = probe::report(bytes);
    hand_over(report.into_bytes())
}

/// Превращает DWG в треугольники сцены.
///
/// Возвращает двоичный блок: метка, счётчики, координаты, нормали. Разбор
/// длится секунды, поэтому вызывать стоит из Worker, чтобы не морозить вкладку.
///
/// # Safety
/// `ptr` и `len` описывают буфер из [`dwg_alloc`]; владение переходит внутрь.
#[no_mangle]
pub unsafe extern "C" fn dwg_convert(ptr: *mut u8, len: usize) -> *mut u8 {
    let bytes = Vec::from_raw_parts(ptr, len, len);
    let out = match convert::convert(bytes) {
        Ok(r) => convert::encode(&r),
        Err(e) => convert::encode_error(&e),
    };
    hand_over(out)
}
