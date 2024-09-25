import { http, createTestClient, publicActions, walletActions } from "viem";
import { foundry } from "viem/chains";

export const account = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const client = createTestClient({
	chain: foundry,
	mode: "anvil",
	account,
	transport: http(),
});
export const walletClient = client.extend(walletActions);
export const publicClient = client.extend(publicActions);
