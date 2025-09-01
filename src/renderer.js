import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';

const ROOT = path.resolve(process.cwd(), 'templates');

export async function renderEmail(templateRef, payload) {
    const filePath = path.join(ROOT, 'email', templateRef);
    const src = await fs.readFile(filePath, 'utf8');
    const tpl = Handlebars.compile(src, { noEscape: true });
    return tpl(payload || {});
}

export async function renderWaText(templateRef, payload) {
    const filePath = path.join(ROOT, 'whatsapp', templateRef);
    const src = await fs.readFile(filePath, 'utf8');
    const tpl = Handlebars.compile(src, { noEscape: true });
    return tpl(payload || {});
}
