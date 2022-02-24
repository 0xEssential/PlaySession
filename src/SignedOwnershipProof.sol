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
    /// @param account the address that currently owns the L1 NFT
    /// @param nonce the meta-transaction nonce for account
    /// @param nftContract the mainnet contract address for the NFT being utilized
    /// @param tokenId the tokenId from nftContract for the NFT being utilized
    /// @return the message _ownershipSigner should sign
    function createMessage(
        address account,
        uint256 nonce,
        address nftContract,
        uint256 tokenId
    ) public view returns (bytes32) {
        // The JSON RPC server gets the current owner of the L1 NFT and calls this function.
        // This respects PlaySession authorizations - if the current L1 owner has authorized
        // a Burner EOA to play games with its NFTs via createSession, and the sesssion is still
        // valid, the ownership proof will encode the authorized Burner address.

        IForwardRequest.PlaySession memory ps = _sessions[account];
        require(block.timestamp < ps.expiresAt, "Session Expired");

        return keccak256(abi.encode(account, nonce, nftContract, tokenId));
    }

    /// @notice Verify signed OffchainLookup proof against meta-tx request data
    /// @dev Ensures that _ownershipSigner signed a message containing (nftOwner OR authorized address, nonce, nftContract, tokenId)
    /// @param req structured data submitted by EOA making a meta-transaction request
    /// @param signature the signature proof created by the ownership signer EOA
    function verifyOwnershipProof(IForwardRequest.ForwardRequest memory req, bytes memory signature)
        public
        view
        returns (bool)
    {
        // Only verifies that ownership proof signature matches req and is signed by _ownerShip signer.
        // Separately we must verify that the meta-tx signature also matches req and is signed by the
        // EOA making the meta-transaction request.

        bytes32 message = createMessage(req.from, req.nonce, req.nftContract, req.tokenId).toEthSignedMessageHash();

        return message.recover(signature) == _ownershipSigner;
    }

    /// @notice Get ownershipSigner address
    /// @return the ownership proof signer address
    function ownershipSigner() public view returns (address) {
        return _ownershipSigner;
    }

    /// @notice Change the ownership signer
    /// @dev This signer should hold no assets and is only used for signing L1 ownership proofs.
    /// @param newSigner the new signer's public address
    function _setOwnershipSigner(address newSigner) internal {
        _ownershipSigner = newSigner;
    }
}
