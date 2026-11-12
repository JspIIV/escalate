// Independent check that every EVM contract Escalate relies on runs exactly the source in this repository: UMA's
// Optimistic Oracle V3, Finder, Store and whitelists (vendor/uma, unmodified), NoDVM, the CourtEscalationManager and the
// test dollar. GenLayer Chain's explorer cannot verify source yet, so this compiles each with UMA's settings (solc 0.8.16,
// 1,000,000 runs), reads the code from the chain and compares byte for byte. Immutable values are set at deployment, so
// their slots are taken from the chain and printed.
//   node scripts/verify_evm.mjs
import { JsonRpcProvider } from 'ethers';
import { execSync } from 'child_process';
import fs from 'fs'; import path from 'path';
import { compile, ROOT } from './compile.mjs';

const chain = new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221);
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployment.json'), 'utf8'));
const TARGETS = [['finder', 'Finder'], ['identifier_whitelist', 'IdentifierWhitelist'], ['collateral_whitelist', 'AddressWhitelist'],
  ['store', 'Store'], ['optimistic_oracle_v3', 'OptimisticOracleV3'], ['no_dvm', 'NoDVM'],
  ['court_escalation_manager', 'CourtEscalationManager'], ['testusd', 'TestUSD']];
let all = true;
const commit = execSync('git rev-parse HEAD', { cwd: path.join(ROOT, 'vendor', 'uma') }).toString().trim();
console.log('UMA protocol at', commit.slice(0, 12), '| solc 0.8.16, 1,000,000 runs | chain 4221');
for (const [key, name] of TARGETS) {
  const c = compile(name);
  const live = (await chain.getCode(dep[key].address)).slice(2).toLowerCase();
  const filled = c.deployed.split('');
  const fixed = [];
  for (const spots of Object.values(c.refs)) for (const { start, length } of spots) {
    for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i];
    fixed.push('immutable 0x' + live.slice(start * 2, (start + length) * 2).slice(-40));
  }
  const same = filled.join('') === live;
  all = all && same;
  console.log(`${same ? 'MATCH    ' : 'DIFFERENT'} ${name.padEnd(24)} ${dep[key].address}  ${[...new Set(fixed)].slice(0, 2).join(', ')}`);
}
// UMA's own deployment of the Optimistic Oracle V3 on Base Sepolia (packages/core/networks/84532.json in vendor/uma),
// compiled from the same vendored source: the oracle this repository runs on GenLayer Chain is UMA's code as UMA ships it.
// UMA compiled from its own checkout, so the CBOR metadata at the end, which hashes source file paths, may differ.
{
  const UMA_BASE_OOV3 = '0x0F7fC5E6482f096380db6158f978167b57388deE';
  const base = new JsonRpcProvider(process.env.BASE_RPC || 'https://base-sepolia-rpc.publicnode.com', 84532, { staticNetwork: true });
  const c = compile('OptimisticOracleV3');
  const live = (await base.getCode(UMA_BASE_OOV3)).slice(2).toLowerCase();
  const filled = c.deployed.split('');
  for (const spots of Object.values(c.refs)) for (const { start, length } of spots) for (let i = start * 2; i < (start + length) * 2; i++) filled[i] = live[i];
  const strip = (hex) => hex.slice(0, hex.length - (parseInt(hex.slice(-4), 16) + 2) * 2);
  const exact = filled.join('') === live, code = strip(filled.join('')) === strip(live);
  all = all && code;
  console.log(`${exact ? 'MATCH    ' : code ? 'MATCH*   ' : 'DIFFERENT'} ${'OptimisticOracleV3'.padEnd(24)} ${UMA_BASE_OOV3}  UMA's own deployment on Base Sepolia${!exact && code ? '; * every executable byte, only the metadata hash of file paths differs' : ''}`);
}
console.log(all ? 'every contract on chain is the source in this repository' : 'at least one contract differs');
process.exit(all ? 0 : 1);
