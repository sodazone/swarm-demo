import {
	ansiColorFormatter,
	configure,
	getConsoleSink,
	getLogger,
} from "@logtape/logtape";
import { type Hex, numberToHex, parseEther, toHex } from "viem";

import type {
	Bundle,
	Network,
	PeerInfo,
	RequestData,
	Sig,
} from "./acrabrb/types";
import { publicClient, walletClient } from "./eth/client";
import { inititalizeSwarm } from "./eth/swarm";
import { toHexEthAddress } from "./eth/utils";

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
	const worker = new Worker("./acrabrb/worker.ts");
	worker.postMessage({ id, byzantine });
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

async function handleFulfillment(
	who: number,
	bundle: Bundle,
	response: Buffer,
	requestData: RequestData,
) {
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

	const responsePayload = toHex(response);
	const args = [
		[requestData.sn, requestData.callbackContract, requestData.payload],
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
	process.exit(0);
}

for (const w of network.workers) {
	w.onmessage = (event) => {
		const data = event.data;
		if (data.peerInfo) {
			network.peers[data.peerInfo.id] = data.peerInfo;
		} else if (data.from && data.bundle) {
			for (const p of network.peers) {
				if (
					p.id !== data.from &&
					!data.bundle.sigs.some((s: Sig) => s.peerId === p.id)
				) {
					network.workers[p.id].postMessage(data.bundle);
				}
			}
		} else if (data.who) {
			const millis = Date.now() - start;

			logger.info`QUORUM ${data.bundle.sigs.length} peers in ${millis}ms`;

			for (const w of network.workers) {
				w.terminate();
			}
			try {
				handleFulfillment(data.who, data.bundle, data.response, data.request);
			} catch (error) {
				console.error(error);
			}
		}
	};
}

setTimeout(() => {
	if (network.peers.some((p) => p === undefined)) {
		throw new Error("Peer infos not properly propagated");
	}

	for (const w of network.workers) {
		w.postMessage({
			peerInfos: network.peers,
			t: network.t,
		});
	}
}, WARMUP);

setTimeout(async () => {
	for (const peer of network.peers) {
		if (peer === undefined) {
			throw new Error("Network not properly initialized");
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
