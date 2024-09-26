import type { RecoveredSignatureType } from "@noble/curves/abstract/weierstrass";
import type { Hex } from "viem";

export type RequestData = {
	sequenceNumber: bigint;
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
};

export type Fulfillment = {
	bundle: Bundle;
	who: number;
	requestData: RequestData;
	responseBuffer: Buffer;
};

export type NetworkInfo = {
	peers: PeerInfo[];
	t: number;
};

export type NewPeer = {
	id: number;
	byzantine: boolean;
};

export type Broadcast = {
	from: number;
	bundle: Bundle;
};

interface BaseWorkerMessage<V> {
	type:
		| "peer_info"
		| "broadcast"
		| "consensus"
		| "bundle"
		| "request"
		| "network_info"
		| "new_peer";
	value: V;
}

export interface PeerInfoMessage extends BaseWorkerMessage<PeerInfo> {
	type: "peer_info";
}

export interface BroadcastMessage extends BaseWorkerMessage<Broadcast> {
	type: "broadcast";
}

export interface ConsensusMessage extends BaseWorkerMessage<Fulfillment> {
	type: "consensus";
}

export interface BundleMessage extends BaseWorkerMessage<Bundle> {
	type: "bundle";
}

export interface RequestMessage extends BaseWorkerMessage<RequestData> {
	type: "request";
}

export interface NetworkInfoMessage extends BaseWorkerMessage<NetworkInfo> {
	type: "network_info";
}

export interface NewPeerMessage extends BaseWorkerMessage<NewPeer> {
	type: "new_peer";
}

export type ParentWorkerMessage =
	| PeerInfoMessage
	| BroadcastMessage
	| ConsensusMessage;
export type WorkerMessage =
	| BundleMessage
	| RequestMessage
	| NetworkInfoMessage
	| NewPeerMessage;
