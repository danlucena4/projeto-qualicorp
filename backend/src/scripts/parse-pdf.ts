// Extrai texto de um PDF local e dumpa num .txt pra análise.
// Uso: npx tsx src/scripts/parse-pdf.ts <caminho-do-pdf>

import fs from 'node:fs';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

const input = process.argv[2];
if (!input) {
  console.error('Uso: npx tsx src/scripts/parse-pdf.ts <caminho-do-pdf>');
  process.exit(1);
}

const abs = path.resolve(input);
if (!fs.existsSync(abs)) {
  console.error('Arquivo não existe:', abs);
  process.exit(1);
}

const data = new Uint8Array(fs.readFileSync(abs));

(async () => {
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  const outPath = abs.replace(/\.pdf$/i, '.txt');
  fs.writeFileSync(outPath, result.text, 'utf-8');
  const pages = result.pages?.length ?? 0;
  console.log(`[parse] ${pages} páginas, ${result.text.length} chars → ${outPath}`);
  await parser.destroy();
})();
