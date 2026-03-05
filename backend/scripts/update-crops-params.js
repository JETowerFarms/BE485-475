// Updates crop economic parameters in the crops table.
// Usage:
//   node scripts/update-crops-params.js            # update rows
//   node scripts/update-crops-params.js --inspect  # print columns + sample rows, no updates
// Assumes DB connection env vars already configured (see backend/src/database.js expectations).

const { db } = require('../src/database');

const inspectOnly = process.argv.includes('--inspect');

async function ensureColumns() {
  await db.none(
    `ALTER TABLE IF EXISTS crops
       ADD COLUMN IF NOT EXISTS yield_per_acre numeric,
       ADD COLUMN IF NOT EXISTS price_per_unit_0 numeric,
       ADD COLUMN IF NOT EXISTS unit text,
       ADD COLUMN IF NOT EXISTS cost_per_acre numeric,
       ADD COLUMN IF NOT EXISTS escalation_rate numeric DEFAULT 0`
  );
}

const crops = [
  { id: 16, name: 'alfalfa_hay', yield_per_acre: 2.6, price_per_unit_0: 173.0, unit: 'ton', cost_per_acre: 595.4, escalation_rate: 0.0 },
  { id: 8, name: 'apples', yield_per_acre: 31000, price_per_unit_0: 0.283, unit: 'lb', cost_per_acre: 10521, escalation_rate: 0.0 },
  { id: 13, name: 'asparagus', yield_per_acre: 36, price_per_unit_0: 90.9, unit: 'cwt', cost_per_acre: 3357, escalation_rate: 0.0 },
  { id: 9, name: 'blueberries', yield_per_acre: 4970, price_per_unit_0: 1.76, unit: 'lb', cost_per_acre: 10392, escalation_rate: 0.0 },
  { id: 14, name: 'carrots', yield_per_acre: 50000, price_per_unit_0: 0.289, unit: 'lb', cost_per_acre: 4500, escalation_rate: 0.0 },
  { id: 1, name: 'corn_grain', yield_per_acre: 181, price_per_unit_0: 4.16, unit: 'bushel', cost_per_acre: 651, escalation_rate: 0.0 },
  { id: 11, name: 'cucumbers', yield_per_acre: 125, price_per_unit_0: 12.7, unit: 'cwt', cost_per_acre: 862, escalation_rate: 0.0 },
  { id: 4, name: 'dry_beans', yield_per_acre: 24.7, price_per_unit_0: 40.5, unit: 'cwt', cost_per_acre: 500, escalation_rate: 0.0 },
  { id: 10, name: 'grapes', yield_per_acre: 2.75, price_per_unit_0: 2453, unit: 'ton', cost_per_acre: 1691, escalation_rate: 0.0 },
  { id: 15, name: 'onions', yield_per_acre: 16.5, price_per_unit_0: 397, unit: 'ton', cost_per_acre: 6474, escalation_rate: 0.0 },
  { id: 6, name: 'potatoes', yield_per_acre: 430, price_per_unit_0: 16.5, unit: 'cwt', cost_per_acre: 3895, escalation_rate: 0.0 },
  { id: 2, name: 'soybeans', yield_per_acre: 49, price_per_unit_0: 10.5, unit: 'bushel', cost_per_acre: 347, escalation_rate: 0.0 },
  { id: 5, name: 'sugar_beets', yield_per_acre: 30.7, price_per_unit_0: 80.9, unit: 'ton', cost_per_acre: 1563, escalation_rate: 0.0 },
  { id: 7, name: 'tart_cherries', yield_per_acre: 6570, price_per_unit_0: 0.193, unit: 'lb', cost_per_acre: 3099, escalation_rate: 0.0 },
  { id: 12, name: 'tomatoes', yield_per_acre: 25, price_per_unit_0: 119, unit: 'ton', cost_per_acre: 1924.26, escalation_rate: 0.0 },
  { id: 3, name: 'wheat', yield_per_acre: 87, price_per_unit_0: 5.55, unit: 'bushel', cost_per_acre: 315, escalation_rate: 0.0 },
];

async function run() {
  try {
    if (!inspectOnly) {
      await ensureColumns();
    }

    if (inspectOnly) {
      const columns = await db.any(
        `select column_name, data_type
           from information_schema.columns
          where table_schema = 'public' and table_name = 'crops'
          order by ordinal_position`);
      const sample = await db.any('select * from crops limit 5');
      console.log('crops columns:', columns);
      console.log('sample rows:', sample);
      process.exit(0);
    }

    for (const crop of crops) {
      await db.none(
        `UPDATE crops
         SET name = $/name/,
             yield_per_acre = $/yield_per_acre/,
             price_per_unit_0 = $/price_per_unit_0/,
             unit = $/unit/,
             cost_per_acre = $/cost_per_acre/,
             escalation_rate = $/escalation_rate/
         WHERE id = $/id/`,
        crop,
      );
    }
    console.log(`Updated ${crops.length} crops.`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to update crops:', err);
    process.exit(1);
  }
}

run();
