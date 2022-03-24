//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./EssentialERC2771Context.sol";

contract Counter is EssentialERC2771Context {
    uint256 public totalCount;
    mapping(address => uint256) public collectionCount;
    mapping(address => uint256) public count;
    mapping(address => mapping(uint256 => address)) internal registeredNFTs;

    event Counted(address indexed contractAddress, uint256 indexed tokenId, address indexed counter);

    modifier onlyForwarder() {
        require(isTrustedForwarder(msg.sender), "Counter:429");
        _;
    }

    constructor(address trustedForwarder) EssentialERC2771Context(trustedForwarder) {}

    function increment() external onlyForwarder {
        IForwardRequest.NFT memory nft = _msgNFT();

        require(registeredNFTs[nft.contractAddress][nft.tokenId] == address(0), "NFT already counted");

        address owner = _msgSender();

        registeredNFTs[nft.contractAddress][nft.tokenId] = owner;

        unchecked {
            ++count[owner];
            ++totalCount;
            ++collectionCount[nft.contractAddress];
        }

        emit Counted(nft.contractAddress, nft.tokenId, owner);
    }
}
