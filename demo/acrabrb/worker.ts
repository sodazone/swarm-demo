// prevents TS errors
// biome-ignore lint: ok
declare var self: Worker;

import { Peer } from "./protocol";
import type { Bundle, RequestData } from "./types";

let peer: Peer;

self.onerror = (err) => {
	console.error(err.message);
};

// biome-ignore lint: fine
self.onmessage = (event: MessageEvent<any>) => {
	const m = event.data;

	if (peer && m.message && m.sigs) {
		try {
			peer.onBundle(m);
		} catch (error) {
			console.error(error);
		}
		return;
	}

	if (peer && m.sn && m.callbackContract) {
		peer.onRequest(m);
		return;
	}

	if (peer && m.peerInfos) {
		peer.peerInfos = m.peerInfos;
		peer.t = m.t;
		return;
	}

	if (m.id !== undefined) {
		peer = new Peer(m.id);

		if (m.byzantine) {
			peer.byzantine = true;
		}

		peer.onFulfill = (
			who: number,
			bundle: Bundle,
			response: Buffer,
			request: RequestData,
		) => {
			postMessage({
				who,
				bundle,
				response,
				request,
			});
		};
		peer.broadcastBundle = (from: number, bundle: Bundle) => {
			postMessage({
				from,
				bundle,
			});
		};

		postMessage({
			peerInfo: {
				id: peer.id,
				pubKey: peer.pubKey,
			},
		});
	}
};
