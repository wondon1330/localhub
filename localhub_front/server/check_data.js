const fs = require('fs');
const p = require('path').join(__dirname, '..', 'src', 'data', '대전_충청권_음식점.json');
try {
  const data = JSON.parse(fs.readFileSync(p, 'utf8')).items || [];
  console.log('total', data.length);
  const fd01 = data.filter(x => (x.lclsSystm2 || '').includes('FD01'));
  console.log('FD01 count', fd01.length);
  console.log('sample titles (first 10):');
  data.slice(0, 10).forEach((d, i) => console.log(i + 1, d.title));
} catch (e) {
  console.error('error reading file', e);
}
