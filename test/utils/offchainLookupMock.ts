import {ethers} from 'ethers';

export const handleOffchainLookup = async (match: RegExpMatchArray, relayer: any, forwarder: any) => {
  const [_sender, _urls, callData, callbackFunction, extraData] = match[1]
    .split(', ')
    .map((s) => (s.startsWith('[') ? JSON.parse(s.substring(1, s.length - 1)) : JSON.parse(s)));

  const abi = new ethers.utils.AbiCoder();
  const [from, authorizer, nonce, nftChainId, nftContract, tokenId, _targetChainId, timestamp] = abi.decode(
    ['address', 'address', 'uint256', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
    callData
  );

  const message = await relayer.forwarder.createMessage(
    from,
    authorizer,
    nonce,
    nftChainId,
    nftContract,
    tokenId,
    timestamp
  );

  const proof = await relayer.forwarder.signer.signMessage(ethers.utils.arrayify(message, {allowMissingPrefix: true}));
  const tx = await relayer.forwarder.signer.sendTransaction({
    to: forwarder.address,
    data: ethers.utils.hexConcat([callbackFunction, abi.encode(['bytes', 'bytes'], [proof, extraData])]),
  });

  await tx.wait();
};
