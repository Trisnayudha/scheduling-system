module.exports = (v = {}) => {
    const name = v.name || 'Teman';
    const title = v.event?.title ? `\nEvent: ${v.event.title}` : '';
    const date = v.event?.date ? `\nTanggal: ${v.event.date}` : '';
    return `Halo ${name}! 👋
Terima kasih sudah bergabung di Indonesia Miner.${title}${date}`;
};
