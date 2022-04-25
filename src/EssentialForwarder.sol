// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./EssentialEIP712Base.sol";
import "./SignedOwnershipProof.sol";
import "./IForwardRequest.sol";
import "./IEssentialPlaySession.sol";

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

    error Unauthorized();
    error InvalidSignature();
    error InvalidOwnership();
    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    bytes32 private constant ERC721_TYPEHASH =
        keccak256(
            "ForwardRequest(address to,address from,address authorizer,address nftContract,uint256 nonce,uint256 nftChainId,uint256 nftTokenId,uint256 targetChainId,bytes data)"
        );

    mapping(address => uint256) internal _nonces;
    mapping(address => IForwardRequest.PlaySession) internal _sessions;

    string[] public urls;
    IEssentialPlaySession public PlaySession;

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

    /// @notice Change the PlaySession source
    function setPlaySessionOperator(address playSession) external onlyRole(ADMIN_ROLE) {
        PlaySession = IEssentialPlaySession(playSession);
    }

    /// @notice Get current nonce for EOA
    function getNonce(address from) external view returns (uint256) {
        return _nonces[from];
    }

    /// @notice Get current session for Primary EOA
    function getSession(address authorizer) external view returns (IForwardRequest.PlaySession memory) {
        return PlaySession.getSession(authorizer);
    }

    /// @notice Allow `authorized` to use your NFTs in a game for `length` seconds. Your NFTs
    ///         will not be held in custody or approved for transfer.
    function createSession(address authorized, uint256 length) external {
        PlaySession.createSession(authorized, length);
    }

    /// @notice Submit a meta-tx request and signature to check validity and receive
    /// a response with data useful for fetching a trusted proof per EIP-3668.
    /// @dev Per EIP-3668, a valid signature will cause a revert with useful error params.
    function preflight(IForwardRequest.ERC721ForwardRequest calldata req, bytes calldata signature) public view {
        // If the signature is valid for the request and state, the client will receive
        // the OffchainLookup error with parameters suitable for an https call to a JSON
        // RPC server.

        if (!verify(req, signature)) revert InvalidSignature();

        revert OffchainLookup(
            address(this),
            urls,
            abi.encode(
                req.from,
                req.authorizer,
                _nonces[req.from],
                req.nftChainId,
                req.nftContract,
                req.nftTokenId,
                block.chainid,
                block.timestamp
            ),
            this.executeWithProof.selector,
            abi.encode(block.timestamp, req, signature)
        );
    }

    /// @notice Re-submit a valid meta-tx request with trust-minimized proof to execute the transaction.
    /// @dev The RPC call and re-submission should be handled by your Relayer client
    /// @param response The unaltered bytes reponse from a call made to an RPC url from OffchainLookup::urls
    /// @param extraData The unaltered bytes from OffchainLookup::extraData
    function executeWithProof(bytes calldata response, bytes calldata extraData)
        external
        payable
        returns (bool, bytes memory)
    {
        (uint256 timestamp, IForwardRequest.ERC721ForwardRequest memory req, bytes memory signature) = abi.decode(
            extraData,
            (uint256, IForwardRequest.ERC721ForwardRequest, bytes)
        );

        if (!verifyAuthorization(req)) revert Unauthorized();
        if (!verifyRequest(req, signature)) revert InvalidSignature();
        if (!verifyOwnershipProof(req, response, timestamp)) revert InvalidOwnership();

        ++_nonces[req.from];

        (bool success, bytes memory returndata) = req.to.call{gas: req.gas, value: 0}(
            // Implementation contracts may use EssentialERC2771Context::_msgNFT()
            // to access trusted NFT data. Calldata is compatible with OZ::_msgSender()
            abi.encodePacked(req.data, req.nftTokenId, req.nftContract, req.authorizer)
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
                    req.nftChainId,
                    req.nftTokenId,
                    req.targetChainId,
                    keccak256(req.data)
                )
            )
        ).recover(signature);
        return _nonces[req.from] == req.nonce && signer == req.from && req.targetChainId == block.chainid;
    }

    function verifyAuthorization(IForwardRequest.ERC721ForwardRequest memory req) internal view returns (bool) {
        if (req.authorizer == req.from) return true;
        return PlaySession.verifyAuthorization(req);
    }
}
