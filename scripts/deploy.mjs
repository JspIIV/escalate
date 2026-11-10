// Deploy Escalate end to end on GenLayer Bradbury. On GenLayer Chain (the EVM side, chain 4221): UMA's Optimistic Oracle
// V3 and the infrastructure it reads, unmodified (Finder, IdentifierWhitelist, AddressWhitelist, Store), a test dollar
// for bonds, NoDVM in the DVM's place, and the CourtEscalationManager. Then the Escalate Intelligent Contract, then the
// one time wiring of the manager to it. Every step is recorded in deployment.json and skipped if already done.
//   PCHG=<pw> node scripts/deploy.mjs
import { Wallet, JsonRpcProvider, ContractFactory, Contract, encodeBytes32String, parseUnits } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { client, fees, EXPLORER } from './net.mjs';
import { compile, ROOT } from './compile.mjs';

const PW = process.env.PCHG || '';
if (!PW) { console.error('set PCHG'); process.exit(1); }
const KS = path.join(os.homedir(), '.genlayer', 'keystores');
const w = await Wallet.fromEncryptedJson(fs.readFileSync(path.join(KS, 'pchg.json'), 'utf8'), PW);
const evm = w.connect(new JsonRpcProvider('https://rpc.testnet-chain.genlayer.com', 4221));
const OUT = path.join(ROOT, 'deployment.json');
const dep = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { network: 'genlayer testnet bradbury phase 2', chain_id: 4221 };
const save = () => fs.writeFileSync(OUT, JSON.stringify(dep, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIVENESS = 7200; // UMA's default two hours

async function deploy(key, name, args = []) {
  if (dep[key]) return dep[key].address;
  const c = compile(name);
  fs.mkdirSync(path.join(ROOT, 'evm', 'abi'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'evm', 'abi', name + '.json'), JSON.stringify(c.abi, null, 2));
  const contract = await new ContractFactory(c.abi, c.bytecode, evm).deploy(...args);
  await contract.waitForDeployment();
  dep[key] = { address: await contract.getAddress(), tx: contract.deploymentTransaction().hash };
  dep.compiler = c.version;
  save();
  console.log('deployed', key.padEnd(20), dep[key].address);
  return dep[key].address;
}
async function step(key, fn) {
  if (dep.steps?.[key]) return;
  const tx = await fn();
  await tx.wait();
  dep.steps = { ...(dep.steps || {}), [key]: tx.hash };
  save();
  console.log('step', key);
}
const at = (name, addr) => new Contract(addr, compile(name).abi, evm);

console.log('deployer', w.address);
const tusd = await deploy('testusd', 'TestUSD');
const finder = await deploy('finder', 'Finder');
const ids = await deploy('identifier_whitelist', 'IdentifierWhitelist');
const coll = await deploy('collateral_whitelist', 'AddressWhitelist');
const store = await deploy('store', 'Store', [[0n], [0n], '0x0000000000000000000000000000000000000000']);
const nodvm = await deploy('no_dvm', 'NoDVM');
await step('identifier', () => at('IdentifierWhitelist', ids).addSupportedIdentifier(encodeBytes32String('ASSERT_TRUTH')));
await step('collateral', () => at('AddressWhitelist', coll).addToWhitelist(tusd));
await step('final_fee', () => at('Store', store).setFinalFee(tusd, [parseUnits('1', 18)]));
for (const [name, addr] of [['IdentifierWhitelist', ids], ['CollateralWhitelist', coll], ['Store', store], ['Oracle', nodvm]])
  await step('finder_' + name, () => at('Finder', finder).changeImplementationAddress(encodeBytes32String(name), addr));
const oo = await deploy('optimistic_oracle_v3', 'OptimisticOracleV3', [finder, tusd, LIVENESS]);
await step('finder_OptimisticOracleV3', () => at('Finder', finder).changeImplementationAddress(encodeBytes32String('OptimisticOracleV3'), oo));
const manager = await deploy('court_escalation_manager', 'CourtEscalationManager', [oo]);

if (!dep.escalate) {
  const c = client(w.privateKey);
  const code = fs.readFileSync(path.join(ROOT, 'contracts', 'escalate.py'), 'utf8');
  const hash = await c.deployContract({ code, args: [manager], fees: await fees(c) });
  console.log('escalate tx', hash);
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const tx = await c.getTransaction({ hash });
    if (['ACCEPTED', 'FINALIZED'].includes(tx.statusName)) {
      if (tx.txExecutionResultName !== 'FINISHED_WITH_RETURN') { console.error('deploy failed', tx.txExecutionResultName); process.exit(1); }
      dep.escalate = { address: tx.txDataDecoded?.contractAddress || tx.recipient, tx: hash };
      dep.address = dep.escalate.address; dep.tx = hash; dep.deployed_at = new Date().toISOString();
      save();
      break;
    }
  }
}
await step('court', () => at('CourtEscalationManager', manager).setCourt(dep.escalate.address));
console.log('ESCALATE', dep.escalate?.address, EXPLORER + '/address/' + dep.escalate?.address);
process.exit(0);
