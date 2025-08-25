const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const EMAIL_DIR = path.join(__dirname, '../../templates/email');
const WA_DIR = path.join(__dirname, '../../templates/whatsapp');

const cache = { email: new Map(), wa: new Map() };

function renderEmail(fileName, vars = {}) {
    if (!fileName) throw new Error('emailFile not set');
    if (!cache.email.has(fileName)) {
        const src = fs.readFileSync(path.join(EMAIL_DIR, fileName), 'utf8');
        cache.email.set(fileName, Handlebars.compile(src));
    }
    return cache.email.get(fileName)(vars);
}

function renderWhatsapp(moduleName, vars = {}) {
    if (!moduleName) throw new Error('whatsappModule not set');
    if (!cache.wa.has(moduleName)) {
        const modPath = path.join(WA_DIR, moduleName);
        delete require.cache[require.resolve(modPath)];
        const fn = require(modPath);
        if (typeof fn !== 'function') throw new Error(`${moduleName} must export a function`);
        cache.wa.set(moduleName, fn);
    }
    return cache.wa.get(moduleName)(vars);
}

module.exports = { renderEmail, renderWhatsapp };
