---
name: escalate-uma-court
description: Have Internet Court arbitrate disputes on UMA's Optimistic Oracle V3 through an escalation manager, so a disputed assertion is ruled from its cited sources by GenLayer in minutes instead of a DVM vote in days, and settled on UMA's oracle with no relayer. Use when an agent or app asserts facts on UMA's OOv3 and needs fast, evidence-based dispute resolution.
---

# Escalate: Internet Court for UMA's Optimistic Oracle V3

Internet Court lists UMA under verification and disputes, with no public skill yet. This skill is a working one. It
uses UMA's own extension point, the escalation manager: an assertion that names the CourtEscalationManager is arbitrated
by Internet Court on GenLayer instead of UMA's DVM.

```text
UMA assertion, disputed                  OptimisticOracleV3.disputeAssertion(id)
  -> escalation manager                  CourtEscalationManager (requestPrice + disputed callback)
  -> evidence                            fileClaim(id, text): the exact asserted text, checked against the id
  -> GenLayer Intelligent Contract       Escalate.arbitrate(id): TRUE or FALSE from the claim's cited sources
  -> ruling, no relayer                  the court's Ghost calls rule(id, verdict) on GenLayer Chain
  -> UMA settles                         the manager answers UMA's price and calls settleAssertion(id): bonds move
```

## Deployed on GenLayer Bradbury Phase 2 (chain 4221)

| Contract | Address | Source |
|---|---|---|
| Escalate (Intelligent Contract, the court) | `0x1A04EFFf53525738Bb6a5B01326E9BE88a20cf99` | `contracts/escalate.py` |
| CourtEscalationManager | `0x46574d6f1804a4BE27cbA7bEbA55B5e8880b51C5` | `evm/CourtEscalationManager.sol` |
| OptimisticOracleV3 | `0xe2c7f71B000fdc898feE10aC13f6558F891bB4E2` | UMA protocol, unmodified |
| Finder | `0xeB53B19007FA3318C09EF22A0B5E4b3c40314ef7` | same |
| Store | `0x3a87057e49ceC1534d1cF8E9C88bC6F1670E4Cb9` | same |
| IdentifierWhitelist (`ASSERT_TRUTH`) | `0x7591523209Cd29846A5e881f036E56696133b797` | same |
| AddressWhitelist (bond currencies) | `0xCC9c414f10DB6162C6Ec160b1Dae69c024331961` | same |
| NoDVM (the DVM's slot, refuses) | `0x3fD45464669df7D8FAD0C5c852b6b011B2D03632` | `evm/NoDVM.sol` |
| Test dollar (bonds, final fee 1) | `0xCb0d20ab00c146349b23b92a4a2E7199BeD4A68B` | `evm/TestUSD.sol`, anyone may mint |

RPC for GenLayer writes: `https://rpc-bradbury.genlayer.com`. RPC for EVM calls: `https://rpc.testnet-chain.genlayer.com`.

## Workflow

1. **Assert, naming the court.** Write the claim so it cites an https page that states the fact.
   ```js
   await oo.assertTruth(toUtf8Bytes(claim), asserter, ZeroAddress, COURT_ESCALATION_MANAGER, liveness,
     TEST_USD, bond, encodeBytes32String('ASSERT_TRUTH'), ZeroHash);   // bond >= getMinimumBond(currency)
   ```
   If nobody disputes it, anybody calls `settleAssertion(id)` after the liveness: true, bond back. The court is not involved.
2. **Dispute.** `oo.disputeAssertion(id, disputer)` with the same bond. UMA's oracle asks the manager for a price.
3. **File the text.** `manager.fileClaim(id, claimBytes)`. Anybody may; only the exact asserted text is accepted.
4. **Ask the court.** `Escalate.arbitrate(id)` on GenLayer, funding the message that delivers the ruling:
   ```js
   const gasLimit = 900000n, maxGasPrice = 1000000000n, budget = gasLimit * maxGasPrice;
   const feeParams = AbiCoder.defaultAbiCoder().encode(['uint256','uint256'], [gasLimit, maxGasPrice]);
   const messageAllocations = [{ messageType: 0, onAcceptance: false, recipient: COURT_ESCALATION_MANAGER, budget, feeParams }];
   const e = await client.estimateTransactionFees({ totalMessageFees: budget, messageAllocations });
   await client.writeContract({ address: ESCALATE, functionName: 'arbitrate', args: [id],
     fees: { distribution: e.distribution, feeValue: e.feeValue, messageAllocations } });
   ```
5. **Read the outcome.** `oo.getAssertionResult(id)` for UMA's answer, `Escalate.case(id)` for the verdict and reasoning,
   `manager.facts(id)` for the state. If a ruling was recorded but did not land, `Escalate.resend(id)` repeats it.

## What the court guarantees

- It judges the text that was asserted: the manager accepts a text only if it hashes to the assertion id.
- It rules only on disputed assertions, once; nobody else can rule.
- The asserter carries the burden of proof: no readable https source, or one that does not show the claim, is FALSE.
- The claim and its pages are untrusted in both directions; instructions to the judges are ignored.
- Bonds move by UMA's unmodified `settleAssertion`: the winner gets both bonds minus the burned half of one, which goes
  to UMA's Store.

## Decision payload

| Field | Where | Meaning |
|---|---|---|
| `verdict` | `Escalate.case(id).verdict` | `TRUE` or `FALSE`, agreed by the round |
| `why` | same | the leading judge's words, not agreed by the round |
| `sources` | same | the https URLs read, at most two |
| `reason` | `CourtEscalationManager.cases(id).reason` | sha256 of `escalate|<id>|<verdict>` |
| result | `OptimisticOracleV3.getAssertionResult(id)` | what every UMA integration reads |

## Reproduce

- Interface: https://jspiiv.github.io/escalate/
- Scripts: `node scripts/prove.mjs` (the full case), `node scripts/verify.mjs` and `node scripts/verify_evm.mjs`

## Limits

- UMA's oracle here is deployed on GenLayer Chain, where the court can call it directly. Assertions on UMA's mainnet
  deployments would need a bridge or relay to carry the ruling.
- Sources are read when the court rules. Cite pages that state the fact and will keep stating it.
