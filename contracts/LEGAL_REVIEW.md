# Legal review gate for optional modules

The following modules are implemented but **must stay OFF (feature flags unset, contracts not deployed to production) until legal review is complete in both India and the United States.** This is a hold note, not legal advice.

| Module | Flag | Contract | Why review is needed |
| --- | --- | --- | --- |
| Creator tokenization | `FEATURE_TOKENIZATION` | `ClippoCreatorProfile.sol` | On-chain personal data and track record (privacy, DPDP Act 2023 in India, CCPA/state privacy laws and right to deletion in the US). Design is non-transferable with no tradable token and no secondary market, to avoid securities / virtual digital asset treatment; counsel must confirm that holds. |
| Referral program | `FEATURE_REFERRAL` | `ClippoReferral.sol` | Paying a cut for introducing users may be treated as a multi-level or pyramid scheme, commission, or promotion (India: Prize Chits and Money Circulation Schemes (Banning) Act and consumer-protection rules; US: FTC endorsement/disclosure rules, state MLM and money-transmitter analysis). Single level only, capped, and fraud-limited in code. |
| Status ladder | `FEATURE_STATUS_LADDER` | none | Merit-based tiers (not follower counts). Review for fairness and non-discrimination, and any benefits attached to tiers. |

## Cross-cutting items for counsel
- Tax: TDS on virtual digital asset transfers and creator payouts in India (Income-tax Act s.194S and related); 1099 and W-8/W-9 collection in the US.
- Sanctions / KYC / AML screening of referrers and creators receiving USDC.
- Consent, disclosure and terms for opt-in profiles; ability to revoke (`optOut`, `revoke`) and erase off-chain data.
- Referral disclosures to referred users, and advertising disclosure for shared campaign links.

## Switch-on checklist
1. Written legal sign-off for India and the US for the specific module.
2. Update terms of service and privacy policy.
3. Set the flag in the production environment and deploy the contract.
4. Keep the owner kill switches: `ClippoReferral.setPaused`, `setFrozen`; `ClippoCreatorProfile.revoke`.
