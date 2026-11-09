const fs = require('node:fs/promises');
const { importStations, workbookRows } = require('./import-data');

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Cách dùng: npm run import:stations -- "C:\\duong-dan\\BTS_BH.xlsx"');
  const buffer = await fs.readFile(filename);
  const rows = await workbookRows(buffer, filename);
  const count = importStations(rows, filename);
  console.log(`Đã nhập/cập nhật ${count} trạm từ ${filename}.`);
}

main().catch(error => {
  console.error(`Không thể nhập danh sách trạm: ${error.message}`);
  process.exitCode = 1;
});
