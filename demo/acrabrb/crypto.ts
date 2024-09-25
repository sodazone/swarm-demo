import type { RecoveredSignatureType } from "@noble/curves/abstract/weierstrass";
import { secp256k1 } from "@noble/curves/secp256k1";
import { type Hex, concat, encodeAbiParameters, keccak256, toHex } from "viem";

import type { RequestData } from "./types";

export function generateKeyPair() {
	const priv = secp256k1.utils.randomPrivateKey();
	const pub = secp256k1.getPublicKey(priv, false);
	return { publicKey: pub, privateKey: priv };
}

export function sign(msgHash: Hex, priv: Uint8Array): RecoveredSignatureType {
	return secp256k1.sign(msgHash.slice(2), priv);
}

export function verify(
	sig: RecoveredSignatureType,
	msgHash: Hex,
	pub: Uint8Array,
): boolean {
	return secp256k1.verify(sig, msgHash.slice(2), pub);
}

export function encodeRequestData(requestData: RequestData) {
	return encodeAbiParameters(
		[
			{
				type: "tuple",
				components: [
					{
						type: "uint256",
					},
					{ type: "address" },
					{ type: "bytes" },
				],
			},
		],
		[[requestData.sn, requestData.callbackContract, requestData.payload]],
	);
}

export function hashResponse(
	responsePayload: Uint8Array,
	requestData: RequestData,
): Hex {
	const encodedRequestData = encodeRequestData(requestData);
	const hashRequest = keccak256(encodedRequestData);
	return keccak256(concat([toHex(responsePayload), hashRequest]));
}
