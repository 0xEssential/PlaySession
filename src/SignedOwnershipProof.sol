//SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./IForwardRequest.sol";

/// @title SignedOwnershipProof
/// @author Sammy Bauch
/// @dev Based on SignedAllowance by Simon Fremaux (@dievardump)
/// see https://github.com/dievardump/signed-minting

contract SignedOwnershipProof {
    using ECDSA for bytes32;

    // address used to sign proof of ownership
    address private _ownershipSigner;

    mapping(address => IForwardRequest.PlaySession) internal _sessions;

    /// @notice Construct message that _ownershipSigner must sign as ownership proof
    /// @dev The RPC server uses this view function to create the ownership proof
    /// @param nftOwner the address that currently owns the L1 NFT
    /// @param nonce the meta-transaction nonce for account
    /// @param nftContract the mainnet contract address for the NFT being utilized
    /// @param tokenId the tokenId from nftContract for the NFT being utilized
    /// @return the message _ownershipSigner should sign
    function createMessage(
        address nftOwner,
        uint256 nonce,
        address nftContract,
        uint256 tokenId,
        uint256 tokenNonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(nftOwner, nonce, nftContract, tokenId, tokenNonce));
    }

    /// @notice Verify signed OffchainLookup proof against meta-tx request data
    /// @dev Ensures that _ownershipSigner signed a message containing (nftOwner OR authorized address, nonce, nftContract, tokenId)
    /// @param req structured data submitted by EOA making a meta-transaction request
    /// @param signature the signature proof created by the ownership signer EOA
    function verifyOwnershipProof(IForwardRequest.ERC721ForwardRequest memory req, bytes memory signature)
        public
        view
        returns (bool)
    {
        // Verifies that ownership proof signature is signed by _ownerShip signer
        // and that the embedded owner has authorized req.from
        //
        // Separately we must verify that the meta-tx signature also matches req.from
        // and is signed by the EOA making the meta-transaction request.

        IForwardRequest.PlaySession memory ps = _sessions[req.authorizer];
        require(block.timestamp < ps.expiresAt, "Session Expired");
        require(ps.authorized == req.from, "Signer not authorized");

        bytes32 message = createMessage(req.authorizer, req.nonce, req.nftContract, req.tokenId, req.nftNonce)
            .toEthSignedMessageHash();

        return message.recover(signature) == _ownershipSigner;
    }

    /// @notice Get ownershipSigner address
    /// @return the ownership proof signer address
    function ownershipSigner() public view returns (address) {
        return _ownershipSigner;
    }

    /// @dev This signer should hold no assets and is only used for signing L1 ownership proofs.
    /// @param newSigner the new signer's public address
    function _setOwnershipSigner(address newSigner) internal {
        _ownershipSigner = newSigner;
    }
}
