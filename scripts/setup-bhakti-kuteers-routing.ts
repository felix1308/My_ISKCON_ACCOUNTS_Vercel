// ============================================================================
// setup-bhakti-kuteers-routing — routes Tumkur, Koramangala Bhakti Kuteer,
// and Electronic City payments through the "ICC BHAKTI KUTEERS" Razorpay
// gateway (pg_1771854136408 / rzp_live_SJbSLBxvykMWtI).
//
// - Creates center_electronic_city if missing (the other two exist).
// - Creates bank-account rows linked to the gateway where missing.
//   (Bank account number/name left blank — fill via the Bank Accounts page.)
//
// Idempotent: safe to re-run.
// Run: node --env-file=.env.local node_modules/.bin/tsx scripts/setup-bhakti-kuteers-routing.ts
// ============================================================================

import { directSql } from "../lib/db-direct";
import { getEnv } from "../lib/env";

const GATEWAY_ID = "pg_1771854136408"; // RP ICC BHAKTI KUTEERS
const TEMPLE_ID = "temple_iskcon_south_bengaluru";

const ROUTING: Array<{ centerId: string; centerName: string; city: string; bankId: string }> = [
  { centerId: "center_tumkur", centerName: "ISKCON Tumkur", city: "Tumkur", bankId: "bank_tumkur_bk" },
  { centerId: "center_koramangala_bhakti_kuteer", centerName: "Koramangala Bhakti Kuteer", city: "Bengaluru", bankId: "bank_koramangala_bk" },
  { centerId: "center_electronic_city", centerName: "ISKCON Electronic City", city: "Bengaluru", bankId: "bank_electronic_city_bk" },
];

async function main() {
  getEnv();
  const sql = directSql();
  const ts = new Date().toISOString();

  // Sanity: gateway exists and is active
  const gw = await sql`SELECT id, razorpay_key_id, is_active FROM payment_gateways WHERE id = ${GATEWAY_ID}`;
  if (!gw.length || !gw[0].is_active) throw new Error(`Gateway ${GATEWAY_ID} missing or inactive`);
  console.log(`Gateway OK: ${gw[0].razorpay_key_id}`);

  for (const r of ROUTING) {
    // 1. Center
    const c = await sql`SELECT id FROM centers WHERE id = ${r.centerId}`;
    if (!c.length) {
      await sql`
        INSERT INTO centers (id, name, city, state, temple_id, is_active, created_at, updated_at)
        VALUES (${r.centerId}, ${r.centerName}, ${r.city}, 'Karnataka', ${TEMPLE_ID}, TRUE, ${ts}, ${ts})
      `;
      console.log(`center created: ${r.centerId}`);
    } else {
      console.log(`center exists:  ${r.centerId}`);
    }

    // 2. Bank account linked to the gateway (any existing linked account for
    //    this center is enough — Koramangala already has one).
    const linked = await sql`
      SELECT id FROM bank_accounts
      WHERE center_id = ${r.centerId} AND payment_gateway_id IS NOT NULL AND payment_gateway_id <> ''
    `;
    if (linked.length) {
      // Ensure it points at the right gateway
      await sql`
        UPDATE bank_accounts SET payment_gateway_id = ${GATEWAY_ID}, updated_at = ${ts}
        WHERE center_id = ${r.centerId} AND payment_gateway_id IS NOT NULL AND payment_gateway_id <> ''
      `;
      console.log(`bank linked:    ${r.centerId} -> ${GATEWAY_ID} (existing row ${linked[0].id})`);
    } else {
      await sql`
        INSERT INTO bank_accounts (id, name, account_number, bank_name, center_id, payment_gateway_id, is_active, created_at, updated_at)
        VALUES (${r.bankId}, ${r.centerName + " Collections"}, '', '', ${r.centerId}, ${GATEWAY_ID}, TRUE, ${ts}, ${ts})
      `;
      console.log(`bank created:   ${r.bankId} -> ${GATEWAY_ID}`);
    }
  }

  // Verify final routing
  console.log("\nFinal routing:");
  const all = await sql`
    SELECT c.id AS center, b.id AS bank, b.payment_gateway_id AS gw
    FROM centers c LEFT JOIN bank_accounts b ON b.center_id = c.id AND b.payment_gateway_id IS NOT NULL AND b.payment_gateway_id <> ''
    ORDER BY c.id
  `;
  for (const r of all) console.log(`  ${r.center} -> ${r.gw ?? "(env fallback: RP ICC General)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
