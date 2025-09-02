// utils/datetime.js
const WIB_OFFSET_MINUTES = 7 * 60;

export function toUtcDatetimeString(dateLike) {
    // Kembalikan 'YYYY-MM-DD HH:MM:SS' dalam UTC
    const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

export function parseMaybeWibToUtc(dateStrOrDate) {
    // Rules:
    // - Jika Date object / ISO dengan Z atau offset -> langsung pakai
    // - Jika string TANPA offset (pattern 'YYYY-MM-DD HH:mm:ss' atau mirip) -> treat sebagai WIB, lalu konversi ke UTC
    if (dateStrOrDate instanceof Date) return dateStrOrDate; // sudah aware TZ
    const v = String(dateStrOrDate || '').trim();

    // Ada offset? (contoh: ...Z, +07:00, -03:00)
    if (/[zZ]|([+\-]\d{2}:\d{2})$/.test(v)) {
        return new Date(v);
    }

    // Tidak ada offset -> asumsikan WIB
    // Normalisasi ke bentuk ISO lalu tambahkan +07:00
    // contoh input '2025-09-10 18:00:00' => '2025-09-10T18:00:00+07:00'
    const isoish = v.replace(' ', 'T');
    return new Date(`${isoish}+07:00`);
}
