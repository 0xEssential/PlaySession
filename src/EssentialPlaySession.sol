//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "./EssentialERC2771Context.sol";
import "./IForwardRequest.sol";

contract EssentialPlaySession is EssentialERC2771Context {
    event Session(address indexed owner, address indexed authorized, uint256 indexed length);

    mapping(address => IForwardRequest.PlaySession) internal _sessions;
    bool public permissionlessSessions;

    constructor(address trustedForwarder) EssentialERC2771Context(trustedForwarder) {}

    /// @notice Get current session for Primary EOA
    function getSession(address authorizer) external view returns (IForwardRequest.PlaySession memory) {
        return _sessions[authorizer];
    }

    /// @notice Allow `authorized` to use your NFTs in a game for `length` seconds. Your NFTs
    ///         will not be held in custody or approved for transfer.
    function createSession(address authorized, uint256 length) external {
        _createSession(authorized, length, tx.origin);
    }

    /// @notice Allow `authorized` to use your NFTs in a game for `length` seconds through a
    /// signed message from the primary EOA
    function createSignedSession(address authorized, uint256 length) external onlyForwarder {
        _createSession(authorized, length, _msgSender());
    }

    /// @notice Stop allowing your current authorized burner address to use your NFTs.
    function invalidateSession() external {
        this.createSession(_msgSender(), 0);
    }

    function verifyAuthorization(IForwardRequest.ERC721ForwardRequest memory req) external view returns (bool) {
        return
            _sessions[req.authorizer].authorized == req.from && _sessions[req.authorizer].expiresAt >= block.timestamp;
    }

    function _createSession(
        address authorized,
        uint256 length,
        address authorizer
    ) internal {
        _sessions[authorizer] = IForwardRequest.PlaySession({
            authorized: authorized,
            expiresAt: block.timestamp + length
        });

        emit Session(authorizer, authorized, length);
    }
}
