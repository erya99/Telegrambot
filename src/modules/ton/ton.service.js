// src/modules/ton/ton.service.js
// TON ödeme doğrulama — gelen işlemleri kontrol et

const { query } = require('../../database/db');

const TON_API_URL = process.env.TON_API_URL || 'https://testnet.toncenter.com/api/v2/jsonRPC';
const TON_API_KEY = process.env.TON_API_KEY || '';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS;

// ── ÖDEME DOĞRULAMA ──────────────────────────────────────────
// Kullanıcı TON gönderdi, tx hash'i ile doğrula

async function verifyPayment(txHash, expectedAmountNano, fromAddress = null) {
  try {
    // TonCenter API'den işlem detayını çek
    const res = await fetch(`${TON_API_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TON_API_KEY,
      },
      body: JSON.stringify({
        id: '1',
        jsonrpc: '2.0',
        method: 'getTransactions',
        params: {
          address: PLATFORM_WALLET,
          limit: 50,
        },
      }),
    });

    const data = await res.json();
    if (!data.result) throw new Error('TON API yanıt vermedi');

    // İşlemleri tara, hash'i bul
    const tx = data.result.find(t =>
      t.transaction_id?.hash === txHash ||
      t.in_msg?.hash === txHash
    );

    if (!tx) {
      return { verified: false, reason: 'İşlem bulunamadı. Birkaç dakika bekleyip tekrar deneyin.' };
    }

    const receivedNano = BigInt(tx.in_msg?.value || '0');
    const expected     = BigInt(expectedAmountNano);

    // Miktar yeterli mi? (%1 tolerans — gas farkları için)
    const tolerance = expected / 100n;
    if (receivedNano < expected - tolerance) {
      return {
        verified: false,
        reason: `Yetersiz ödeme. Beklenen: ${nanoToTon(expected)} TON, Gelen: ${nanoToTon(receivedNano)} TON`,
      };
    }

    // Gönderici adresi kontrolü (opsiyonel)
    if (fromAddress && tx.in_msg?.source !== fromAddress) {
      return { verified: false, reason: 'Gönderici adresi eşleşmiyor' };
    }

    // Daha önce kullanılmış mı?
    const { rows: [used] } = await query(
      `SELECT id FROM ton_transactions WHERE tx_hash = $1`,
      [txHash]
    );
    if (used) {
      return { verified: false, reason: 'Bu işlem zaten kullanılmış' };
    }

    return {
      verified: true,
      receivedNano: receivedNano.toString(),
      receivedTon:  nanoToTon(receivedNano),
      senderAddress: tx.in_msg?.source,
    };

  } catch (err) {
    console.error('TON verify error:', err);
    return { verified: false, reason: 'Doğrulama sırasında hata oluştu' };
  }
}

// ── ÖDEME BEKLE (polling) ────────────────────────────────────
// Kullanıcıdan ödeme bekleniyor — 2 dk içinde gelir mi?

async function waitForPayment(expectedAmountNano, memo, timeoutMs = 120_000) {
  const interval = 5_000; // 5 saniyede bir kontrol
  const start    = Date.now();

  while (Date.now() - start < timeoutMs) {
    await sleep(interval);

    try {
      const res = await fetch(`${TON_API_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': TON_API_KEY,
        },
        body: JSON.stringify({
          id: '1',
          jsonrpc: '2.0',
          method: 'getTransactions',
          params: { address: PLATFORM_WALLET, limit: 20 },
        }),
      });

      const data = await res.json();
      if (!data.result) continue;

      // Memo'ya göre eşleştir (comment alanı)
      const tx = data.result.find(t => {
        const comment = t.in_msg?.message || '';
        const value   = BigInt(t.in_msg?.value || '0');
        const expected = BigInt(expectedAmountNano);
        const tolerance = expected / 100n;

        return comment.includes(memo) && value >= expected - tolerance;
      });

      if (tx) {
        // Daha önce kullanılmış mı?
        const txHash = tx.transaction_id?.hash;
        const { rows: [used] } = await query(
          `SELECT id FROM ton_transactions WHERE tx_hash = $1`, [txHash]
        );
        if (!used) {
          return {
            found: true,
            txHash,
            receivedNano: tx.in_msg?.value,
            receivedTon: nanoToTon(BigInt(tx.in_msg?.value || '0')),
            senderAddress: tx.in_msg?.source,
          };
        }
      }
    } catch (err) {
      console.error('Payment polling error:', err);
    }
  }

  return { found: false, reason: 'Ödeme 2 dakika içinde alınamadı' };
}

// ── ÖDEME TALİMATI OLUŞTur ──────────────────────────────────
// Kullanıcıya gösterilecek ödeme talimatı

function createPaymentInstruction(amountNano, memo, purpose) {
  const ton = nanoToTon(BigInt(amountNano));
  return {
    address: PLATFORM_WALLET,
    amount:  ton,
    amountNano: amountNano.toString(),
    memo,
    deepLink: `ton://transfer/${PLATFORM_WALLET}?amount=${amountNano}&text=${encodeURIComponent(memo)}`,
    message:
      `💳 *TON Ödemesi*\n\n` +
      `📦 İşlem: ${purpose}\n` +
      `💰 Miktar: *${ton} TON*\n` +
      `📮 Adres: \`${PLATFORM_WALLET}\`\n` +
      `📝 Not/Memo: \`${memo}\`\n\n` +
      `⚠️ *Memo'yu yazmayı unutma!* Yoksa işlem otomatik doğrulanamaz.\n\n` +
      `Gönderince /onayla komutunu kullan.`,
  };
}

// ── YARDIMCI ────────────────────────────────────────────────

function nanoToTon(nano) {
  return (Number(nano) / 1_000_000_000).toFixed(2);
}

function generateMemo(userId, purpose) {
  const short = userId.replace(/-/g, '').substring(0, 8).toUpperCase();
  return `FBV-${purpose.toUpperCase()}-${short}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  verifyPayment,
  waitForPayment,
  createPaymentInstruction,
  generateMemo,
  nanoToTon,
};
