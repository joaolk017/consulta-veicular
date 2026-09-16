const { Pool } = require('pg');

(async () => {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (!url) {
    console.log('ORDERS_CHECK: FAIL - DATABASE_URL ausente');
    process.exit(0);
  }

  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10000,
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
  });

  try {
    const total = await pool.query('SELECT COUNT(*)::int AS total FROM orders');
    const latest = await pool.query(`
      SELECT payment_status, fulfillment_status, amount_cents,
             provider_transaction_id IS NOT NULL AS has_provider_tx,
             created_at
        FROM orders
       ORDER BY created_at DESC
       LIMIT 1
    `);

    if (!latest.rows.length) {
      console.log(`ORDERS_CHECK: OK - tabela acessível; total=${total.rows[0].total}; nenhum pedido encontrado`);
    } else {
      const row = latest.rows[0];
      console.log(`ORDERS_CHECK: OK - total=${total.rows[0].total}; ultimo_status=${row.payment_status}; atendimento=${row.fulfillment_status}; valor_centavos=${row.amount_cents}; transacao_registrada=${row.has_provider_tx}; criado_em=${new Date(row.created_at).toISOString()}`);
    }
  } catch (err) {
    console.log(`ORDERS_CHECK: FAIL - ${err.message}`);
  } finally {
    await pool.end().catch(() => {});
    process.exit(0);
  }
})();
