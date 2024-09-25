// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

struct RequestData {
    uint256 sn;
    address callbackContract;
    bytes payload;
}

enum RequestStatus {
    _UNDEFINED,
    PENDING,
    FULFILLED,
    SUCCESS,
    FAIL
}

/// @title Swarm Contract
contract Swarm {
    address public owner;
    address public pendingOwner;

    address[] public peerPubKeys;
    mapping(address => uint8) public peersMap;

    mapping(bytes32 => RequestStatus) public requests;
    uint256 public sn = 0;

    event NewRequest(
        uint256 indexed sn,
        address callbackContract,
        bytes payload
    );
    event OwnershipTransferInitiated(address indexed newOwner);
    event OwnershipTransferred(
        address indexed oldOwner,
        address indexed newOwner
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPeer() {
        require(isPeerRegistered(msg.sender), "Invalid peer");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function changeOwner(address _newOwner) public onlyOwner {
        require(_newOwner != address(0), "Invalid address");
        pendingOwner = _newOwner;
        emit OwnershipTransferInitiated(_newOwner);
    }

    function confirmOwnerChange() public {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function isPeerRegistered(address _address) public view returns (bool) {
        return peersMap[_address] != 0;
    }

    function getPeersCount() public view returns (uint256) {
        return peerPubKeys.length;
    }

    function getSwarmThreshold() public view returns (uint256) {
        uint256 totalPeers = peerPubKeys.length;
        return totalPeers - (totalPeers / 3); // 2/3 majority
    }

    function registerPeer(address _address) public onlyOwner {
        require(_address != address(0), "Invalid address");
        require(!isPeerRegistered(_address), "Already registered");

        peerPubKeys.push(_address);
        peersMap[_address] = uint8(peerPubKeys.length);
    }

    function isRequestFulfilled(
        bytes32 _requestHash
    ) public view returns (bool) {
        return requests[_requestHash] == RequestStatus.FULFILLED;
    }

    function isRequestPending(bytes32 _requestHash) public view returns (bool) {
        return requests[_requestHash] == RequestStatus.PENDING;
    }

    function postRequest(
        address _callbackContract,
        bytes calldata _payload
    ) public payable returns (uint256) {
        require(_callbackContract != address(0), "Invalid callback contract");

        unchecked {
            sn++;
        }
        
        RequestData memory requestData = RequestData({
            sn: sn,
            callbackContract: _callbackContract,
            payload: _payload
        });

        bytes32 requestHash = keccak256(abi.encode(requestData));
        requests[requestHash] = RequestStatus.PENDING;

        emit NewRequest(sn, _callbackContract, _payload);
        return sn;
    }

    function postResponse(
        RequestData calldata _request,
        bytes calldata _response,
        bytes32[] calldata _rs,
        bytes32[] calldata _ss,
        uint8[] calldata _vs
    ) public onlyPeer {
        bytes32 requestHash = keccak256(abi.encode(_request));

        require(
            requests[requestHash] == RequestStatus.PENDING,
            "Request not pending"
        );

        uint256 threshold = getSwarmThreshold();
        require(_rs.length >= threshold, "Insufficient signatures");
        require(_rs.length == _ss.length, "Mismatched signature lengths");

        // index 0 is skipped
        address[] memory signed = new address[](peerPubKeys.length + 1);
        uint8 signerCount = 0;

        bytes32 responseHash = keccak256(bytes.concat(_response, requestHash));

        for (uint256 i = 0; i < _rs.length; ++i) {
            address signer = ecrecover(responseHash, _vs[i], _rs[i], _ss[i]);
            require(signer != address(0), "Invalid signature"); // Invalid signer

            uint8 peerIndex = peersMap[signer];
            require(peerIndex != 0, "Peer not registered");
            require(signed[peerIndex] == address(0), "Non-unique signature"); // Prevent double-signing

            signed[peerIndex] = signer;
            signerCount += 1;
        }

        requests[requestHash] = RequestStatus.FULFILLED;

        // Perform callback to the target contract (if it fails, set status to FAIL)
        (bool ok, ) = address(_request.callbackContract).call(
            abi.encodeWithSignature("callback(bytes)", _response)
        );
        requests[requestHash] = ok ? RequestStatus.SUCCESS : RequestStatus.FAIL;
    }
}
