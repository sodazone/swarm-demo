import type { RecoveredSignatureType } from "@noble/curves/abstract/weierstrass";
import type { Hex } from "viem";

export type RequestData = {
	sn: bigint;
	callbackContract: Hex;
	payload: Hex;
};

export type Sig = {
	peerId: number;
	signature: RecoveredSignatureType;
	message: Message;
};

export type Message = {
	sequence: number;
	from: number;
};

export type Bundle = {
	message: Message;
	sigs: Sig[];
};

export type PeerInfo = {
	id: number;
	pubKey: Uint8Array;
};

export type Network = {
	peers: PeerInfo[];
	workers: Worker[];
	t: number; // Byzantine peers
	d: number; // Network Adversarials
}
