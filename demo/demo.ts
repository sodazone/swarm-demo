import {
	ansiColorFormatter,
	configure,
	getConsoleSink,
	getLogger,
} from "@logtape/logtape";
import { type Hex, numberToHex, parseEther, toHex } from "viem";

import { publicClient, walletClient } from "./evm/client";
import { inititalizeSwarm } from "./evm/swarm";
import { toHexEthAddress } from "./evm/utils";
import type {
	BundleMessage,
	Fulfillment,
	Network,
	NetworkInfoMessage,
	NewPeerMessage,
	ParentWorkerMessage,
	PeerInfo,
	Sig,
} from "./p2p/types";

await configure({
	sinks: {
		console: getConsoleSink({
			formatter: ansiColorFormatter,
		}),
	},
	loggers: [
		{ category: "logtape", level: "error", sinks: ["console"] },
		{
			category: "demo",
			level: "info",
			sinks: ["console"],
		},
	],
});

const logger = getLogger(["demo"]);

const WARMUP = 1000;

export function createPeerWorker(id: number, byzantine: boolean) {
	const worker = new Worker("./p2p/worker.ts");
	worker.postMessage({
		type: "new_peer",
		value: { id, byzantine },
	} as NewPeerMessage);
	return worker;
}

function createDemoP2PNetwork() {
	const network: Network = {
		peers: [],
		workers: [],
		t: 3,
		d: 1,
	};

	const s = 3 * network.t + 2 * network.d + 1;
	network.peers = new Array<PeerInfo>(s);

	logger.info(
		"NETWORK Size {s} Byzantine Processes {t} Message Adversaries {d}",
		{
			s,
			t: network.t,
			d: network.d,
		},
	);

	for (let n = 0; n < s; n++) {
		const w = createPeerWorker(n, n < 3);
		network.workers.push(w);
	}

	return network;
}

const network = createDemoP2PNetwork();

const swarm = await inititalizeSwarm(network);

let start: number;

// dirty lock
let f = false;
let i = 0;

async function handleFulfillment({
	who,
	bundle,
	responseBuffer,
	requestData,
}: Fulfillment) {
	if (f) {
		return;
	}
	f = true;

	const { sigs } = bundle;

	const rs: Hex[] = [];
	const ss: Hex[] = [];
	const vs: bigint[] = [];

	for (const sig of sigs) {
		rs.push(numberToHex(sig.signature.r, { size: 32 }));
		ss.push(numberToHex(sig.signature.s, { size: 32 }));
		vs.push(sig.signature.recovery ? 28n : 27n);
	}

	const fulfiller = toHexEthAddress(network.peers[who].pubKey);
	await walletClient.setBalance({ address: fulfiller, value: parseEther("1") });
	await walletClient.impersonateAccount({
		address: fulfiller,
	});

	const responsePayload = toHex(responseBuffer);
	const args = [
		[
			requestData.sequenceNumber,
			requestData.callbackContract,
			requestData.payload,
		],
		responsePayload,
		rs,
		ss,
		vs,
	];

	logger.info("POST RESPONSE [signers={signers} args={args}]", {
		signers: sigs.map((s) => s.peerId),
		args,
	});

	const { request } = await publicClient.simulateContract({
		account: fulfiller,
		address: swarm.address,
		abi: swarm.abi,
		functionName: "postResponse",
		args,
	});

	const txHash = await walletClient.writeContract(request);
	const txReceipt = await publicClient.waitForTransactionReceipt({
		hash: txHash,
	});

	logger.info`RECEIPT ${txReceipt.status} ${txHash}`;
	logger.info`GAS USED ${txReceipt.gasUsed}`;

	process.exit(0);
}

for (const w of network.workers) {
	w.onmessage = (event: MessageEvent<ParentWorkerMessage>) => {
		const wm = event.data;

		switch (wm.type) {
			case "peer_info": {
				network.peers[wm.value.id] = wm.value;
				i++;
				break;
			}
			case "broadcast": {
				const { bundle, from } = wm.value;
				const { sigs } = bundle;

				for (const p of network.peers) {
					if (p.id !== from && !sigs.some((s: Sig) => s.peerId === p.id)) {
						network.workers[p.id].postMessage({
							type: "bundle",
							value: bundle,
						} as BundleMessage);
					}
				}
				break;
			}
			case "consensus": {
				const { bundle } = wm.value;
				const millis = Date.now() - start;

				logger.info`QUORUM ${bundle.sigs.length} peers in ${millis}ms`;

				for (const w of network.workers) {
					w.terminate();
				}
				try {
					handleFulfillment(wm.value);
				} catch (error) {
					console.error(error);
				}
				break;
			}
		}
	};
}

setTimeout(() => {
	if (i < network.workers.length) {
		console.error("Peer infos not properly propagated", network.peers);
		process.exit(1);
	}

	for (const w of network.workers) {
		w.postMessage({
			type: "network_info",
			value: {
				peers: network.peers,
				t: network.t,
			},
		} as NetworkInfoMessage);
	}
}, WARMUP);

setTimeout(async () => {
	for (const peer of network.peers) {
		if (peer === undefined) {
			console.error("Network not properly initialized", network);
			process.exit(1);
		}

		const address = toHexEthAddress(peer.pubKey);

		logger.info("[{id}] REG PEER addr={address} pubKey={k}", {
			id: peer.id,
			address,
			k: toHex(peer.pubKey),
		});

		await swarm.write.registerPeer([address]);
	}

	const requestPayload = "0xbeef";
	const callbackAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
	const txHash = await swarm.write.postRequest([
		callbackAddress,
		requestPayload,
	]);

	logger.info("POST REQUEST {p} [callback={c} tx={txHash}]", {
		c: callbackAddress,
		p: requestPayload,
		txHash,
	});

	start = Date.now();
}, WARMUP * 2);
