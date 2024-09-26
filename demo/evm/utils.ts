import { keccak_256 } from "@noble/hashes/sha3";
import { toHex } from "viem";

export function toEthAddress(pubKey: Uint8Array) {
	return keccak_256(pubKey.slice(1)).slice(-20);
}

export function toHexEthAddress(pubKey: Uint8Array) {
	return toHex(toEthAddress(pubKey));
}
