import { USDC_DECIMALS } from "./config";

const SCALE = 10 ** USDC_DECIMALS;

/** USDC (JSON number) -> base units (bigint), rounded to the nearest micro-USDC. */
export const toUnits = (usdc: number): bigint => BigInt(Math.round(usdc * SCALE));
/** base units -> USDC number (safe for amounts below ~9e9 USDC). */
export const fromUnits = (units: bigint): number => Number(units) / SCALE;

/** `bps` basis points of `amount` base units, rounded down like the contract. */
export const bpsOf = (amount: bigint, bps: number): bigint => (amount * BigInt(bps)) / 10_000n;
