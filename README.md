# USDT Mover (TRON mainnet)

A small local web page: paste a private key or seed phrase, paste a destination address, click **Move**.
It sends TRON USDT (TRC-20, contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, locked on mainnet) from your wallet to the new address.

```
seed phrase / private key
  → derive TRON key (m/44'/195'/0'/0/0) and address
  → check token + TRX balance and estimate the fee
  → build transfer(destination, amount)
  → sign in the browser
  → broadcast to TronGrid
  → wait for confirmation
```

## Run

```bash
npm install
npm start
```

Open http://127.0.0.1:3000.

## How the key is handled

- The key is used only inside the browser tab. The local server (`server.js`) only serves static files and never receives the key.
- The page's network access is restricted (CSP) to TronGrid (Nile, Shasta, mainnet). The signed transaction is the only thing sent.
- Nothing is stored. Closing the tab drops the key.
- Use it on a computer you trust. Malware or a malicious browser extension on the machine could read anything you paste.

## Fees

The **source wallet pays the fee in TRX**. It needs either enough TRX (roughly 7–15 TRX per USDT transfer on mainnet; the page shows the live estimate) or staked Energy.
**Check wallet** shows the estimate and blocks the move if TRX is too low.

If the wallet is compromised, a sweeper bot may take any TRX you send to it for fees. In that case, stake TRX from
a safe wallet and **delegate Energy** to the compromised address first; delegated Energy cannot be stolen.

## Test first

1. Mainnet is the default. For a dry test pick **Nile testnet** instead. Its USDT contract is prefilled.
2. Get test TRX and USDT from the Nile faucet (https://nileex.io/join/getJoinPage) for a test wallet.
3. Move them to a second test address and check the transaction on nile.tronscan.org.
4. Then switch back to **Mainnet**. Without a TronGrid API key (free at trongrid.io, paste it under Advanced) mainnet may rate-limit you.
