//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@0xessential/contracts/fwd/EssentialERC2771Context.sol";

contract Counter is EssentialERC2771Context {
    uint256 public totalCount;
    mapping(address => uint256) public collectionCount;
    mapping(address => uint256) public count;
    mapping(address => mapping(uint256 => address)) internal registeredNFTs;

    event Counted(address indexed contractAddress, uint256 indexed tokenId, address indexed counter);

    constructor(address trustedForwarder) EssentialERC2771Context(trustedForwarder) {}

    function increment() external onlyForwarder {
        IForwardRequest.NFT memory nft = _msgNFT();
        address owner = _msgSender();

        require(registeredNFTs[nft.contractAddress][nft.tokenId] == address(0), "NFT already counted");

        registeredNFTs[nft.contractAddress][nft.tokenId] = owner;

        unchecked {
            ++totalCount;
            ++count[owner];
            ++collectionCount[nft.contractAddress];
        }

        emit Counted(nft.contractAddress, nft.tokenId, owner);
    }
}
