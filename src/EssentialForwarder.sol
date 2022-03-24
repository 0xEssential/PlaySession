// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./EssentialEIP712Base.sol";
import "./SignedOwnershipProof.sol";
import "./IForwardRequest.sol";

/// @title EssentialForwarder
/// @author 0xEssential
/// @notice EIP-2771 based MetaTransaction Forwarding Contract with EIP-3668 OffchainLookup for cross-chain token gating
/// @dev Allows a Relayer to submit meta-transactions that utilize an NFT (i.e. in a game) on behalf of EOAs. Transactions
///      are only executed if the Relayer provides a signature from a trusted signer. The signature must include the current
///      owner of the Layer 1 NFT being used, or a Burner EOA the owner has authorized to use its NFTs.
///
///      EssentialForwarder can be used to build Layer 2 games that use Layer 1 NFTs without bridging and with superior UX.
///      End users can specify a Burner EOA from their primary EOA, and then use that burner address to play games.
///      The Burner EOA can then sign messages for game moves without user interaction without any risk to the NFTs or other
///      assets owned by the primary EOA.
contract EssentialForwarder is EssentialEIP712, AccessControl, SignedOwnershipProof {
    using ECDSA for bytes32;

    event Session(address indexed owner, address indexed authorized, uint256 indexed length);
    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    bytes32 private constant ERC721_TYPEHASH =
        keccak256(
            "ForwardRequest(address to,address from,address authorizer,address nftContract,uint256 nonce,uint256 nftNonce,uint256 tokenId,bytes data)"
        );
    mapping(address => uint256) internal _nonces;
    mapping(address => mapping(uint256 => uint256)) internal _tokenNonces;

    string[] public urls;

    constructor(string memory name, string[] memory _urls) EssentialEIP712(name, "0.0.1") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setOwnershipSigner(msg.sender);
        urls = _urls;
    }

    /// @notice Change the ownership signer
    function setOwnershipSigner(address newSigner) external onlyRole(ADMIN_ROLE) {
        _setOwnershipSigner(newSigner);
    }

    /// @notice Get current nonce for EOA
    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    /// @notice Get current session for Primary EOA
    function getSession(address authorizer) public view returns (IForwardRequest.PlaySession memory) {
        return _sessions[authorizer];
    }

    /// @notice Allow `authorized` to use your NFTs in a game for `length` seconds. Your NFTs
    ///         will not be held in custody or approved for transfer.
    function createSession(address authorized, uint256 length) external {
        _createSession(authorized, length);
    }

    /// @notice Allow `authorized` to use your NFTs in a game for `length` seconds through a
    ///         signed message from the primary EOA
    /// @dev TODO
    // function createSignedSession(
    //     bytes calldata signature,
    //     address authorized,
    //     uint256 length,
    //     address sender
    // ) external onlyRole(ADMIN_ROLE) {
    //     bytes32 message = keccak256(abi.encode(sender, length)).toEthSignedMessageHash();

    //     require(message.recover(signature) == sender, "PlaySession signature invalid");
    //     _createSession(authorized, length);
    // }

    function _createSession(address authorized, uint256 length) internal {
        _sessions[msg.sender] = IForwardRequest.PlaySession({
            authorized: authorized,
            expiresAt: block.timestamp + length
        });

        emit Session(msg.sender, authorized, length);
    }

    /// @notice Stop allowing your current authorized burner address to use your NFTs.
    /// @dev For efficiency in PlaySession persistence and lookup, an EOA must authorize
    ///      itself
    function invalidateSession() external {
        this.createSession(msg.sender, type(uint256).max);
    }

    /// @notice Submit a meta-tx request and signature to check validity and receive
    ///         a response with data useful for fetching a trusted proof per EIP-3668.
    /// @dev Per EIP-3668, a valid signature will cause a revert with useful error params.
    function preflight(IForwardRequest.ERC721ForwardRequest calldata req, bytes calldata signature) public view {
        // If the signature is valid for the request and state, the client will receive
        // the OffchainLookup error with parameters suitable for an https call to a JSON
        // RPC server.

        if (verifyRequest(req, signature)) {
            revert OffchainLookup(
                address(this),
                urls,
                abi.encode(
                    req.from,
                    _nonces[req.from],
                    req.nftContract,
                    req.tokenId,
                    _tokenNonces[req.nftContract][req.tokenId]
                ),
                this.executeWithProof.selector,
                abi.encode(req, signature)
            );
        }
    }

    /// @notice Re-submit a valid meta-tx request with trusted proof to execute the transaction.
    /// @dev The RPC call and re-submission should be handled by your Relayer client
    /// @param response The unaltered bytes reponse from a call made to an RPC based on OffchainLookup args
    /// @param extraData The unaltered bytes in the OffchainLookup extraData error arg
    function executeWithProof(bytes calldata response, bytes calldata extraData)
        external
        payable
        returns (bool, bytes memory)
    {
        (IForwardRequest.ERC721ForwardRequest memory req, bytes memory signature) = abi.decode(
            extraData,
            (IForwardRequest.ERC721ForwardRequest, bytes)
        );

        // verifies
        require(verifyOwnershipProof(req, response), "EssentialForwarder: ownership proof does not match request");
        require(verifyRequest(req, signature), "EssentialForwarder: signature does not match request");

        ++_nonces[req.from];
        ++_tokenNonces[req.nftContract][req.tokenId];

        (bool success, bytes memory returndata) = req.to.call{gas: req.gas, value: 0}(
            // Implementation contracts must use EssentialERC2771Context.
            // The trusted NFT data is available via _msgNFT()
            abi.encodePacked(req.data, req.tokenId, req.nftContract, req.authorizer)
        );

        // Validate that the relayer has sent enough gas for the call.
        // See https://ronan.eth.link/blog/ethereum-gas-dangers/
        assert(gasleft() > req.gas / 63);

        return (success, returndata);
    }

    /// @notice Submit a meta-tx request where a proof of ownership is not required.
    /// @dev Useful for transactions where the signer is not using a specific NFT, but values
    /// are still required in the signature - use the zero address for nftContract and 0 for tokenId
    function verify(IForwardRequest.ERC721ForwardRequest calldata req, bytes calldata signature)
        public
        view
        returns (bool)
    {
        return verifyRequest(req, signature);
    }

    function execute(IForwardRequest.ERC721ForwardRequest calldata req, bytes calldata signature)
        public
        payable
        returns (bool, bytes memory)
    {
        require(verify(req, signature), "MinimalForwarder: signature does not match request");
        _nonces[req.from] = req.nonce + 1;

        (bool success, bytes memory returndata) = req.to.call{gas: req.gas, value: req.value}(
            abi.encodePacked(req.data, uint256(0), address(0), req.from)
        );

        // Validate that the relayer has sent enough gas for the call.
        // See https://ronan.eth.link/blog/ethereum-gas-dangers/
        assert(gasleft() > req.gas / 63);

        return (success, returndata);
    }

    function verifyRequest(IForwardRequest.ERC721ForwardRequest memory req, bytes memory signature)
        internal
        view
        returns (bool)
    {
        address signer = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ERC721_TYPEHASH,
                    req.to,
                    req.from,
                    req.authorizer,
                    req.nftContract,
                    req.nonce,
                    req.nftNonce,
                    req.tokenId,
                    keccak256(req.data)
                )
            )
        ).recover(signature);
        // TODO: tokenNonce check?
        // && req.nftNonce == _tokenNonces[req.nftContract][req.tokenId]
        return _nonces[req.from] == req.nonce && signer == req.from;
    }
}
