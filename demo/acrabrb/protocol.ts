// ACRABRB
// Authenticated Commit-Reveal over
// Asynchronous Byzantine Reliable Broadcast

import { getLogger } from "@logtape/logtape";
import { type Hex, toHex } from "viem";
import { generateKeyPair, hashResponse, sign, verify } from "./crypto";
import type { Bundle, Message, PeerInfo, RequestData, Sig } from "./types";

const logger = getLogger(["demo"]);

function createMessageKey(m: Message): string {
	return `${m.from}!${m.sequence}`;
}

export type FulfillFn = (
	who: number,
	b: Bundle,
	response: Buffer,
	request: RequestData,
) => Promise<void> | void;

export class Peer {
	id: number;
	pubKey: Uint8Array;
	byzantine = false;
	onFulfill?: FulfillFn;
	peerInfos: PeerInfo[] = [];
	t = 3;

	private responses: Map<number, Buffer> = new Map();
	private requests: Map<number, RequestData> = new Map();

	private privKey: Uint8Array;
	private signatures: Sig[] = [];
	private deliveredMessages = new Set<string>();

	constructor(id: number) {
		this.id = id;
		const keys = generateKeyPair();
		this.privKey = keys.privateKey;
		this.pubKey = keys.publicKey;
	}

	onRequest(requestData: RequestData) {
		const delay = Math.random() * 100;

		logger.info("[{id}] RQ data={data} delay={delay}ms", {
			id: this.id,
			data: requestData,
			delay,
		});

		setTimeout(() => {
			const payload = this.byzantine
				? Buffer.from("FAULTY MESSAGE")
				: Buffer.from("CORRECT MESSAGE");
			const seq = Number(requestData.sn);
			this.responses.set(seq, payload);
			this.requests.set(seq, requestData);

			const message: Message = {
				sequence: seq,
				from: this.id,
			};

			this.signAndBroadcast(message);
		}, delay);
	}

	onBundle(bundle: Bundle) {
		const { message } = bundle;

		if (
			this.isMessageDelivered(message) ||
			!this.hasValidResponse(bundle) ||
			!this.verifySignatures(message, bundle.sigs)
		) {
			logger.debug`${this.id} drop`;
			return;
		}

		this.collectSignatures(bundle);

		if (this.isNotSignedBySelf(bundle)) {
			this.signAndBroadcast(message);
		}

		if (this.isQuorumReached()) {
			this.handleConsensus(bundle);
		}
	}

	private handleConsensus(bundle: Bundle) {
		const { message } = bundle;
		const resolved = { message, sigs: this.signatures };
		this.markDelivered(message);

		if (this.onFulfill) {
			const response = this.responses.get(message.sequence);
			const request = this.requests.get(message.sequence);

			if (response === undefined || request === undefined) {
				throw new Error("fatal: request or response not found!");
			}

			logger.info("[{id}] FULFILL rq={rq} rs={rs} sigs={s}", {
				id: this.id,
				rq: request,
				rs: toHex(response),
				s: resolved.sigs.length,
			});

			this.onFulfill(this.id, resolved, response, request);
		}

		this.broadcastMessage(message);
	}

	private signAndBroadcast(message: Message) {
		if (!this.signatures.some((s) => s.peerId === this.id)) {
			this.signMessage(message);
		}
		this.broadcastMessage(message);
	}

	private hashStoredResponse(message: Message): Hex {
		const response = this.responses.get(message.sequence);
		const request = this.requests.get(message.sequence);

		if (!response || !request) {
			throw new Error("Missing response or request data");
		}

		return hashResponse(response, request);
	}

	private hasValidResponse(bundle: Bundle): boolean {
		const { message, sigs } = bundle;

		if (!this.responses.has(message.sequence)) {
			logger.debug`${this.id} no response yet!`;
			return false;
		}

		return this.isContentMatching(message, sigs);
	}

	private pubKeyOf(id: number) {
		return this.peerInfos[id].pubKey;
	}

	private isContentMatching(message: Message, sigs: Sig[]): boolean {
		const response = this.responses.get(message.sequence);
		const request = this.requests.get(message.sequence);

		if (response && request) {
			const peerPubKey = this.pubKeyOf(message.from);
			const responseHash = hashResponse(response, request);

			return sigs.some((sig) =>
				verify(sig.signature, responseHash, peerPubKey),
			);
		}

		return false;
	}

	private markDelivered(message: Message) {
		const messageKey = createMessageKey(message);
		const signatures = this.signatures;

		logger.debug`${this.id} DELIVERED ${message} #sigs ${signatures.length}`;

		this.deliveredMessages.add(messageKey);
	}

	private isQuorumReached() {
		const threshold = (this.peerInfos.length + this.t) / 2;
		const numOfSigs = this.signatures.length;

		return threshold < numOfSigs;
	}

	private isNotSignedBySelf(b: Bundle): boolean {
		return !this.hasValidSignatureForKey(b.message, b.sigs, this.pubKey);
	}

	// Verifies all signatures for a given message
	private verifySignatures(message: Message, sigs: Sig[]): boolean {
		return sigs.some(
			(sig) =>
				sig.message.sequence === message.sequence &&
				verify(
					sig.signature,
					this.hashStoredResponse(message),
					this.pubKeyOf(sig.peerId),
				),
		);
	}

	private hasValidSignatureForKey(
		message: Message,
		sigs: Sig[],
		pubKey: Uint8Array,
	): boolean {
		return (
			sigs.find(
				(sig) =>
					Buffer.from(this.pubKeyOf(sig.peerId)).compare(pubKey) === 0 &&
					verify(sig.signature, this.hashStoredResponse(message), pubKey),
			) !== undefined
		);
	}

	// Collects valid signatures from a bundle and stores them
	private collectSignatures(bundle: Bundle): void {
		try {
			for (const { pubKey } of this.peerInfos) {
				for (const sig of bundle.sigs) {
					const existingSig = this.signatures.find(
						(s) =>
							s.signature.r === sig.signature.r &&
							s.signature.s === sig.signature.s,
					);

					if (
						!existingSig &&
						verify(
							sig.signature,
							this.hashStoredResponse(bundle.message),
							pubKey,
						)
					) {
						this.storeSignature(sig);
					}
				}
			}
		} catch (error) {
			console.error(this.id, error);
			throw error;
		}
	}

	// Stores a signature for a message
	private storeSignature(signature: Sig): void {
		this.signatures.push(signature);
	}

	// Checks if a message was already delivered
	private isMessageDelivered(message: Message): boolean {
		return this.deliveredMessages.has(createMessageKey(message));
	}

	private signMessage(message: Message) {
		// TODO: re-entrancy?
		const sig: Sig = {
			peerId: this.id,
			signature: sign(this.hashStoredResponse(message), this.privKey),
			message,
		};
		this.addSignature(sig);
	}

	private addSignature(s: Sig) {
		this.signatures.push(s);
	}

	broadcastBundle(id: number, b: Bundle) {
		throw new Error("implemented in worker");
	}

	private broadcastMessage(message: Message) {
		const sigs: Sig[] = this.signatures;

		this.broadcastBundle(this.id, {
			message,
			sigs,
		});
	}
}
