'use strict';
// Everything runs in this tab: derive key -> check balances -> build transfer -> sign -> broadcast -> confirm.
// The secret is read from the input only when needed and is never stored, logged, or sent anywhere.

const TronWebClass = window.TronWeb.TronWeb || window.TronWeb;

const NETWORKS = {
  nile: { name: 'Nile testnet', host: 'https://nile.trongrid.io', scan: 'https://nile.tronscan.org', usdt: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' },
  shasta: { name: 'Shasta testnet', host: 'https://api.shasta.trongrid.io', scan: 'https://shasta.tronscan.org', usdt: '' },
  mainnet: { name: 'MAINNET', host: 'https://api.trongrid.io', scan: 'https://tronscan.org', usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
};
const FEE_LIMIT_SUN = 100_000_000; // max 100 TRX the transfer may burn
const SUN = 1_000_000n;

const $ = (id) => document.getElementById(id);
const el = {
  network: $('network'), secret: $('secret'), toggle: $('toggle'), dest: $('dest'), token: $('token'),
  amount: $('amount'), path: $('path'), apikey: $('apikey'), check: $('check'), move: $('move'),
  form: $('form'), info: $('info'), log: $('log'), banner: $('netBanner'),
};

// ---------- helpers ----------
function log(msg, cls = '', link) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  if (link) {
    const a = document.createElement('a');
    a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = ' view ↗';
    d.append(a);
  }
  el.log.prepend(d);
}

function fromUnits(v, dec) {
  if (dec === 0) return v.toString();
  const s = v.toString().padStart(dec + 1, '0');
  const frac = s.slice(-dec).replace(/0+$/, '');
  return frac ? `${s.slice(0, -dec)}.${frac}` : s.slice(0, -dec);
}

function toUnits(str, dec) {
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error('Amount must be a number like 12.5');
  const [i, f = ''] = str.split('.');
  if (f.length > dec) throw new Error(`Amount has more than ${dec} decimals`);
  return BigInt(i + f.padEnd(dec, '0'));
}

function decodeAbiString(hex) {
  try {
    const len = parseInt(hex.slice(64, 128), 16);
    const bytes = hex.slice(128, 128 + len * 2).match(/../g) || [];
    return new TextDecoder().decode(new Uint8Array(bytes.map((b) => parseInt(b, 16)))) || 'TOKEN';
  } catch {
    return 'TOKEN';
  }
}

function net() { return NETWORKS[el.network.value]; }

function client() {
  const key = el.apikey.value.trim();
  return new TronWebClass({ fullHost: net().host, headers: key ? { 'TRON-PRO-API-KEY': key } : undefined });
}

/** Turn the secret input into { privateKey, address }. Throws a generic error that never echoes the input. */
function readWallet() {
  const raw = el.secret.value.trim();
  if (!raw) throw new Error('Enter a private key or seed phrase');
  let pk;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) {
    pk = raw.replace(/^0x/, '');
  } else {
    const words = raw.toLowerCase().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) throw new Error('Not a valid private key or seed phrase');
    try {
      pk = TronWebClass.fromMnemonic(words.join(' '), el.path.value.trim()).privateKey.replace(/^0x/, '');
    } catch {
      throw new Error('Seed phrase is invalid (check spelling and word order)');
    }
  }
  let address;
  try { address = TronWebClass.address.fromPrivateKey(pk); } catch { address = false; }
  if (!address) throw new Error('Not a valid private key');
  return { privateKey: pk, address };
}

const addrParam = (value) => ({ type: 'address', value });

const isRateLimit = (e) => /429|rate limit|too many/i.test(String(e?.message ?? e));
const RATE_LIMIT_MSG = 'TronGrid is rate-limiting requests. Get a free API key at trongrid.io and paste it under Advanced, then try again.';

/** Retry a read call with backoff when TronGrid returns 429. */
async function retry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e)) throw e;
      if (i >= tries - 1) throw new Error(RATE_LIMIT_MSG);
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
}

async function constant(tw, contract, fn, params, from) {
  const r = await tw.transactionBuilder.triggerConstantContract(contract, fn, {}, params, from);
  if (!r?.result?.result) throw new Error(`${fn} call failed`);
  return r;
}

// ---------- read wallet state ----------
async function inspect(tw, from, dest, contract) {
  if (!TronWebClass.isAddress(contract)) throw new Error('Token contract address is invalid');
  if (el.network.value === 'mainnet' && contract !== NETWORKS.mainnet.usdt) {
    throw new Error('On mainnet only the official USDT contract is allowed');
  }
  let decimals;
  try {
    const r = await retry(() => constant(tw, contract, 'decimals()', [], from));
    decimals = Number(BigInt('0x' + r.constant_result[0]));
  } catch (e) {
    if (isRateLimit(e)) throw e;
    if (/not exist/i.test(String(e?.message ?? e))) throw new Error(`Token contract does not exist on ${net().name}`);
    throw new Error('This contract does not look like a TRC-20 token');
  }
  // Sequential (not parallel) so keyless mainnet TronGrid doesn't rate-limit us.
  const symR = await retry(() => constant(tw, contract, 'symbol()', [], from)).catch(() => null);
  const balR = await retry(() => constant(tw, contract, 'balanceOf(address)', [addrParam(from)], from));
  const account = await retry(() => tw.trx.getAccount(from));
  const res = await retry(() => tw.trx.getAccountResources(from));
  const params = await retry(() => tw.trx.getChainParameters());
  const symbol = symR ? decodeAbiString(symR.constant_result[0]) : 'TOKEN';
  const balance = BigInt('0x' + (balR.constant_result[0] || '0'));
  const trx = BigInt(account?.balance ?? 0);
  const activated = Boolean(account?.address);

  // Fee estimate: energy for transfer() minus energy the wallet already has, priced at the chain's energy fee.
  const energyPrice = BigInt(params.find((p) => p.key === 'getEnergyFee')?.value ?? 210);
  let energyNeeded = 0n;
  const probeDest = dest && TronWebClass.isAddress(dest) ? dest : from;
  if (balance > 0n) {
    try {
      const est = await retry(() => constant(tw, contract, 'transfer(address,uint256)',
        [addrParam(probeDest), { type: 'uint256', value: balance.toString() }], from));
      energyNeeded = BigInt(est.energy_used ?? 0);
    } catch {
      energyNeeded = 130_000n; // conservative fallback
    }
  }
  const energyHave = BigInt(res.EnergyLimit ?? 0) - BigInt(res.EnergyUsed ?? 0);
  const bwHave = Math.max(
    Number(res.freeNetLimit ?? 0) - Number(res.freeNetUsed ?? 0),
    Number(res.NetLimit ?? 0) - Number(res.NetUsed ?? 0),
  );
  const energyShort = energyNeeded > energyHave ? energyNeeded - (energyHave > 0n ? energyHave : 0n) : 0n;
  const bwBurn = bwHave >= 350 ? 0n : 350_000n; // ~350 bytes * 1000 sun
  const feeSun = energyShort * energyPrice + bwBurn;

  return { symbol, decimals, balance, trx, activated, energyNeeded, energyHave, feeSun };
}

function showInfo(from, s) {
  const rows = [
    ['Network', net().name],
    ['Your address', from],
    ['Token balance', `${fromUnits(s.balance, s.decimals)} ${s.symbol}`],
    ['TRX balance', `${fromUnits(s.trx, 6)} TRX`],
    ['Est. fee', s.feeSun === 0n ? '0 TRX (covered by Energy)' : `≈ ${fromUnits(s.feeSun, 6)} TRX`],
  ];
  el.info.replaceChildren();
  const dl = document.createElement('dl');
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  el.info.append(dl);
  el.info.hidden = false;
}

function problems(s) {
  const out = [];
  if (s.balance === 0n) out.push(`No ${s.symbol} in this wallet`);
  if (!s.activated) out.push('Wallet is not activated on this network (it has never received TRX)');
  if (s.trx < s.feeSun) out.push(`Not enough TRX for the fee: need ≈ ${fromUnits(s.feeSun, 6)} TRX, have ${fromUnits(s.trx, 6)} TRX`);
  return out;
}

// ---------- actions ----------
function busy(on) { el.check.disabled = on; el.move.disabled = on; }

async function onCheck() {
  busy(true);
  try {
    const tw = client();
    const { address } = readWallet();
    const s = await inspect(tw, address, el.dest.value.trim(), el.token.value.trim());
    showInfo(address, s);
    const p = problems(s);
    if (p.length) p.forEach((m) => log(m, 'warn'));
    else log('Wallet looks ready to move.', 'ok');
  } catch (e) {
    log(e.message || String(e), 'err');
  } finally {
    busy(false);
  }
}

async function onMove(ev) {
  ev.preventDefault();
  busy(true);
  try {
    const tw = client();
    const { privateKey, address: from } = readWallet();
    const dest = el.dest.value.trim();
    const contract = el.token.value.trim();
    if (!TronWebClass.isAddress(dest) || !dest.startsWith('T')) throw new Error('Destination is not a valid TRON address (checksum failed)');
    if (dest === from) throw new Error('Destination is the same as the source wallet');

    log('Checking wallet…');
    const s = await inspect(tw, from, dest, contract);
    showInfo(from, s);
    const p = problems(s);
    if (p.length) throw new Error(p.join(' · '));

    const amount = el.amount.value.trim() ? toUnits(el.amount.value.trim(), s.decimals) : s.balance;
    if (amount <= 0n) throw new Error('Amount must be greater than 0');
    if (amount > s.balance) throw new Error('Amount is more than the balance');

    const human = `${fromUnits(amount, s.decimals)} ${s.symbol}`;
    const typed = window.prompt(
      `${net().name}\n\nMove ${human}\nfrom ${from}\nto   ${dest}\n\nEst. fee ≈ ${fromUnits(s.feeSun, 6)} TRX\n\n` +
      'Type the LAST 4 characters of the destination address to confirm:',
    );
    if (typed === null) { log('Cancelled.'); return; }
    if (typed.trim() !== dest.slice(-4)) throw new Error('Confirmation did not match. Nothing was sent.');

    log(`Building transfer of ${human}…`);
    const built = await retry(() => tw.transactionBuilder.triggerSmartContract(
      contract, 'transfer(address,uint256)', { feeLimit: FEE_LIMIT_SUN },
      [addrParam(dest), { type: 'uint256', value: amount.toString() }], from,
    ));
    if (!built?.result?.result) throw new Error('Could not build the transaction');

    const signed = await tw.trx.sign(built.transaction, privateKey);
    log('Signed locally. Broadcasting…');
    // Re-broadcasting the same signed tx is safe (same txid), so retrying on 429 can't double-send.
    const sent = await retry(() => tw.trx.sendRawTransaction(signed));
    const txid = sent?.txid ?? signed.txID;
    const link = `${net().scan}/#/transaction/${txid}`;
    if (sent?.result !== true) {
      const msg = sent?.message ? safeHex(sent.message) : sent?.code;
      throw new Error(`Broadcast rejected: ${msg || 'unknown error'}`);
    }
    log(`Broadcast OK. Tx ${txid}`, '', link);

    log('Waiting for confirmation…');
    const info = await waitForTx(tw, txid);
    if (!info) log('Not confirmed after 2 minutes. Check the explorer.', 'warn', link);
    else if (info.receipt?.result === 'SUCCESS') log(`Confirmed in block ${info.blockNumber}. ${human} moved.`, 'ok', link);
    else log(`Transaction FAILED on-chain: ${info.receipt?.result ?? 'unknown'}`, 'err', link);

    await onCheck().catch(() => {});
  } catch (e) {
    log(e.message || String(e), 'err');
  } finally {
    busy(false);
  }
}

function safeHex(m) {
  if (/^[0-9a-f]+$/i.test(m) && m.length % 2 === 0) {
    try { return new TextDecoder().decode(new Uint8Array(m.match(/../g).map((b) => parseInt(b, 16)))); } catch { /* fallthrough */ }
  }
  return m;
}

async function waitForTx(tw, txid) {
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    try {
      const info = await tw.trx.getTransactionInfo(txid);
      if (info?.blockNumber) return info;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

function onNetwork() {
  const n = net();
  el.token.value = n.usdt;
  // On mainnet the token is fixed to Tether USDT so a pasted/edited contract can't be used by mistake.
  el.token.readOnly = el.network.value === 'mainnet';
  el.banner.className = `banner ${el.network.value === 'mainnet' ? 'main' : 'test'}`;
  el.banner.textContent = el.network.value === 'mainnet'
    ? 'MAINNET USDT: real funds. Transfers cannot be undone.'
    : `${n.name}: test tokens only.${n.usdt ? '' : ' Enter a token contract under Advanced.'}`;
  el.info.hidden = true;
}

el.toggle.addEventListener('click', () => {
  const show = el.secret.type === 'password';
  el.secret.type = show ? 'text' : 'password';
  el.toggle.textContent = show ? 'Hide' : 'Show';
});
el.network.addEventListener('change', onNetwork);
el.check.addEventListener('click', onCheck);
el.form.addEventListener('submit', onMove);
window.addEventListener('pagehide', () => { el.secret.value = ''; });
onNetwork();
