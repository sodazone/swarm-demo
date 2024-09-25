// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {LibString} from "solmate/utils/LibString.sol";
import {Test, console} from "forge-std/Test.sol";
import {Swarm, RequestData, RequestStatus} from "../src/Swarm.sol";

contract SwarmTest is Test {
    Swarm public swarm;

    uint8 constant sigsNum = 8;
    uint8 constant peersNum = 12;

    address[] accounts;
    mapping(address addr => uint256 key) keys;

    function setUp() public {
        swarm = new Swarm();

        for (uint8 n = 0; n < peersNum; n++) {
            (address addr, uint256 key) = makeAddrAndKey(
                string.concat("agent-", LibString.toString(n))
            );
            swarm.registerPeer(addr);
            keys[addr] = key;
            accounts.push(addr);

            console.log("REG", addr, n);
        }

        payable(accounts[0]).transfer(1 ether);

        console.log(
            "Quorum Threshold",
            swarm.getSwarmThreshold(),
            "Size",
            swarm.getPeersCount()
        );
    }

    function callback(bytes calldata _response) public pure {
        console.logBytes(_response);
        //revert();
    }

    function test_RequestFulfillment() public {
        bytes memory requestPayload = hex"48494a4f4445554e414849454e41";
        RequestData memory requestData = RequestData(
            1,
            address(this),
            requestPayload
        );
        bytes32 requestHash = keccak256(abi.encode(requestData));

        vm.expectEmit(true, false, false, true);
        emit Swarm.NewRequest(1, address(this), requestPayload);

        uint256 sn = swarm.postRequest(address(this), requestPayload);

        assertEq(sn, 1);
        assertTrue(swarm.requests(requestHash) == RequestStatus.PENDING);

        bytes memory responsePayload = hex"beefbebebeef";
        bytes32 responseHash = keccak256(
            bytes.concat(responsePayload, requestHash)
        );

        bytes32[] memory rs = new bytes32[](sigsNum);
        bytes32[] memory ss = new bytes32[](sigsNum);
        uint8[] memory vs = new uint8[](sigsNum);

        for (uint8 i = 0; i < sigsNum; i++) {
            console.log("SIG", accounts[i], i);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                keys[accounts[i]],
                responseHash
            );
            rs[i] = r;
            ss[i] = s;
            vs[i] = v;
        }

        vm.prank(accounts[0]);
        swarm.postResponse(requestData, responsePayload, rs, ss, vs);

        assertTrue(swarm.requests(requestHash) != RequestStatus.PENDING);
    }
}
