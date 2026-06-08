import fs from 'fs';

const raw = fs.readFileSync('scripts/checkins-raw.json', 'utf8').replace(/^\uFEFF/, '');
const data = JSON.parse(raw);
const items = data.Items;

const breakdown = {};
let total = 0;

for (const i of items) {
  const amt = parseFloat(i.doorFeeAmount?.N || '0');
  const refunded = !!i.refundedAt?.S;
  if (!breakdown[amt]) breakdown[amt] = { count: 0, total: 0, refunded: 0, active: 0 };
  breakdown[amt].count++;
  breakdown[amt].total += amt;
  if (refunded) breakdown[amt].refunded++;
  else breakdown[amt].active++;
  total += amt;
}

console.log(`Total check-in records: ${items.length}`);
console.log(`\n=== DOOR FEE BREAKDOWN (ALL check-ins) ===`);
for (const [a, b] of Object.entries(breakdown).sort((x, y) => y[1].count - x[1].count)) {
  console.log(`  $${Number(a).toFixed(2)} x ${b.count} = $${b.total.toFixed(2)}  (active: ${b.active}, refunded: ${b.refunded})`);
}
console.log(`  ─────────────────────`);
console.log(`  GRAND TOTAL: $${total.toFixed(2)}`);

const active = items.filter(i => !i.refundedAt?.S);
const refunded = items.filter(i => !!i.refundedAt?.S);
const activeTotal = active.reduce((s, i) => s + parseFloat(i.doorFeeAmount?.N || '0'), 0);
const refundedTotal = refunded.reduce((s, i) => s + parseFloat(i.doorFeeAmount?.N || '0'), 0);

console.log(`\nActive: ${active.length} check-ins, $${activeTotal.toFixed(2)}`);
console.log(`Refunded: ${refunded.length} check-ins, $${refundedTotal.toFixed(2)}`);
