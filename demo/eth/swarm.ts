import { getLogger } from "@logtape/logtape";
import { type Hex, type Log, getContract } from "viem";

import { account, publicClient, walletClient } from "./client";

import type { Network, RequestData, RequestMessage } from "../acrabrb/types";
import { abi, bytecode } from "./Swarm.json";

const logger = getLogger(["demo"]);

export async function inititalizeSwarm(network: Network) {
	const swarm = await deploySwarm();

	watchRequest({
		address: swarm.address,
		onRequest: (reqs) => {
			for (const req of reqs) {
				for (const worker of network.workers) {
					worker.postMessage({ type: "request", value: req } as RequestMessage);
				}
			}
		},
	});

	return swarm;
}

export async function deploySwarm() {
	// NOTE with deterministic address deployment
	// the contract address will be the P2P swarm topic
	const hash = await walletClient.deployContract({
		abi,
		account,
		bytecode: bytecode.object as Hex,
	});

	const { contractAddress } = await publicClient.waitForTransactionReceipt({
		hash,
	});

	if (contractAddress) {
		logger.info`SWARM CONTRACT ${contractAddress}`;

		return getContract({
			address: contractAddress,
			abi,
			client: { public: publicClient, wallet: walletClient },
		});
	}

	throw new Error(`Deployment failure ${hash}`);
}

type RequestDataLog = Log & {
	args: RequestData;
};

export function watchRequest({
	address,
	onRequest,
}: { address: Hex; onRequest: (requestData: RequestData[]) => void }) {
	const unwatch = publicClient.watchContractEvent({
		address,
		eventName: "NewRequest",
		abi,
		onLogs: (logs) => {
			onRequest(logs.map((l) => (l as RequestDataLog).args));
			// listen just once :)
			unwatch();
		},
	});
}
