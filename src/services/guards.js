export async function isPaidByJobKey(jobKey) {
    // format rekomendasi: 'pay:INV-12345'
    if (!jobKey?.startsWith('pay:')) return false;
    const invoice = jobKey.split(':')[1];
    // TODO: panggil API/DB kamu: return true jika invoice sudah lunas
    return false;
}

export async function isCheckedInByJobKey(jobKey) {
    // format contoh: 'event:IM26:UID123'
    // TODO: panggil sistem attendance/check-in
    return false;
}
