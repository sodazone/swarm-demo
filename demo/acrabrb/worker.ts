// prevents TS errors
// biome-ignore lint: ok
declare var self: Worker;

import { Peer } from "./protocol";
import type {
	BroadcastMessage,
	Bundle,
	ConsensusMessage,
	PeerInfoMessage,
	RequestData,
	WorkerMessage,
} from "./types";

let peer: Peer;

self.onerror = (err) => {
	console.error(err.message);
};

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
	try {
		const wm = event.data;

		if (peer) {
			switch (wm.type) {
				case "bundle": {
					peer.onBundle(wm.value);
					return;
				}
				case "request": {
					peer.onRequest(wm.value);
					return;
				}
				case "network_info": {
					const { peers, t } = wm.value;
					peer.peerInfos = peers;
					peer.t = t;
					return;
				}
			}
		}

		if (wm.type === "new_peer") {
			const { id, byzantine } = wm.value;

			peer = new Peer(id);

			if (byzantine) {
				peer.byzantine = true;
			}

			peer.onFulfill = (
				who: number,
				bundle: Bundle,
				responseBuffer: Buffer,
				requestData: RequestData,
			) => {
				postMessage({
					type: "consensus",
					value: {
						who,
						bundle,
						responseBuffer,
						requestData,
					},
				} as ConsensusMessage);
			};

			peer.broadcastBundle = (from: number, bundle: Bundle) => {
				postMessage({
					type: "broadcast",
					value: {
						from,
						bundle,
					},
				} as BroadcastMessage);
			};

			postMessage({
				type: "peer_info",
				value: {
					id: peer.id,
					pubKey: peer.pubKey,
				},
			} as PeerInfoMessage);
		}
	} catch (error) {
		console.error(error);
	}
};
