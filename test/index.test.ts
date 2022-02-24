import {expect} from 'chai';
import {BigNumber, Contract} from 'ethers';
import {ethers} from 'hardhat';
import {setupUsers} from './utils';
import {wrapContract} from '@0xessential/metassential';

const NAME = 'TestForwarder';

const deployContracts = async () => {
  const Forwarder = await ethers.getContractFactory('EssentialForwarder');
  const forwarder = await Forwarder.deploy(NAME, ['http://localhost:8000']);
  await forwarder.deployed();

  const Counter = await ethers.getContractFactory('Counter');
  const counter = await Counter.deploy(forwarder.address);
  await counter.deployed();

  const signers = await ethers.getSigners();

  const users = (await setupUsers(
    signers.map((signer) => signer.address),
    {
      counter,
      forwarder,
    }
  )) as any[];

  users.map(async (user) => {
    const {address, counter, forwarder} = user;

    const wrappedCounter = wrapContract(
      counter.provider,
      address,
      counter,
      Object.assign(forwarder, {name: NAME})
    ) as Contract;

    await forwarder.createSession(address, 10_000);

    user.wrappedCounter = wrappedCounter;
  });

  return {
    counter,
    forwarder,
    users,
  };
};

describe.only('Counter', function () {
  let fixtures: {
    counter: Contract;
    forwarder: Contract;
    users: ({
      address: string;
    } & {
      counter: Contract;
      forwarder: Contract;
      wrappedCounter: Contract;
    })[];
  };

  before(async () => {
    fixtures = await deployContracts();
  });

  it('Starts at 0', async function () {
    const {
      counter,
      users: [_relayer, account],
    } = fixtures;

    expect(await counter.count(account.address)).to.equal(0);
  });

  describe('increment', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('increments permissionlessly', async function () {
      const {
        counter,
        users: [_relayer, account],
      } = fixtures;

      await account.counter.increment();

      expect(await counter.count(account.address)).to.equal(1);
    });
  });

  describe('incrementFromForwarderOnly', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('reverts if called outside of forwarder', async function () {
      const {
        users: [_relayer, account],
      } = fixtures;

      await expect(account.counter.incrementFromForwarderOnly()).to.be.revertedWith('429');
    });

    it('Increments via Forwarder with OffchainLookup proof', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract],
      } = fixtures;

      const {signature, request} = await account.wrappedCounter.incrementFromForwarderOnly(
        nftContract.address,
        BigNumber.from(411),
        account.address
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);
        if (match) {
          const [_sender, _urls, callData, callbackFunction, extraData] = match[1]
            .split(', ')
            .map((s) => (s.startsWith('[') ? JSON.parse(s.substring(1, s.length - 1)) : JSON.parse(s)));

          // JSON RPC Provider would now look up the current owner and sign it
          // console.log(`${urls}/gateway/${sender}/${callData}`);

          // decode the bytes
          const abi = new ethers.utils.AbiCoder();
          const [from, nonce, _nftContract, tokenId] = abi.decode(
            ['address', 'uint256', 'address', 'uint256'],
            callData
          );

          // lookup current owner on mainnet
          const message = await relayer.forwarder.createMessage(from, nonce, _nftContract, tokenId);

          const proof = await relayer.forwarder.signer.signMessage(ethers.utils.arrayify(message));

          // response = json_rpc_call(url, 'durin_call', {'to': forwarder.address, 'data': calldata, 'abi': abi})

          const tx = await relayer.forwarder.signer.sendTransaction({
            to: forwarder.address,
            data: ethers.utils.hexConcat([callbackFunction, abi.encode(['bytes', 'bytes'], [proof, extraData])]),
          });

          await tx.wait();

          const count = await counter.count(account.address);

          expect(count).to.equal(1);
        }
      });
    });
  });

  describe('incrementFromForwarderOnly with PlaySession', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('reverts if called outside of forwarder', async function () {
      const {
        users: [_relayer, account],
      } = fixtures;

      await expect(account.counter.incrementFromForwarderOnly()).to.be.revertedWith('429');
    });

    it('Reverts when owner has no PlaySession', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner],
      } = fixtures;

      const {signature, request} = await burner.wrappedCounter.incrementFromForwarderOnly(
        nftContract.address,
        BigNumber.from(411),
        burner.address
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);

        if (match) {
          const [_sender, _urls, callData, callbackFunction, extraData] = match[1]
            .split(', ')
            .map((s) => (s.startsWith('[') ? JSON.parse(s.substring(1, s.length - 1)) : JSON.parse(s)));
          // console.log(callData);
          // JSON RPC Provider would now look up the current owner and sign it
          // console.log(`${urls}/gateway/${sender}/${callData}`);

          // decode the bytes
          const abi = new ethers.utils.AbiCoder();
          const [_from, nonce, _nftContract, tokenId] = abi.decode(
            ['address', 'uint256', 'address', 'uint256'],
            callData
          );

          // lookup current owner on mainnet

          // here we mock the proof for a different current owner
          const message = await relayer.forwarder.createMessage(account.address, nonce, _nftContract, tokenId);

          const proof = await relayer.forwarder.signer.signMessage(ethers.utils.arrayify(message));

          // response = json_rpc_call(url, 'durin_call', {'to': forwarder.address, 'data': calldata, 'abi': abi})

          await expect(
            relayer.forwarder.signer.sendTransaction({
              to: forwarder.address,
              data: ethers.utils.hexConcat([callbackFunction, abi.encode(['bytes', 'bytes'], [proof, extraData])]),
            })
          ).to.be.revertedWith('TestForwarder: ownership proof');

          const count = await counter.count(account.address);

          expect(count).to.equal(0);
        }
      });
    });

    it('Reverts when Burner not current session beneficiary', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner, activeBurner],
      } = fixtures;

      const createSession = await account.forwarder.createSession(activeBurner.address, 10_000);

      await createSession.wait();

      const {signature, request} = await burner.wrappedCounter.incrementFromForwarderOnly(
        nftContract.address,
        BigNumber.from(411),
        burner.address
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);

        if (match) {
          const [_sender, _urls, callData, callbackFunction, extraData] = match[1]
            .split(', ')
            .map((s) => (s.startsWith('[') ? JSON.parse(s.substring(1, s.length - 1)) : JSON.parse(s)));
          // console.log(callData);
          // JSON RPC Provider would now look up the current owner and sign it
          // console.log(`${urls}/gateway/${sender}/${callData}`);

          // decode the bytes
          const abi = new ethers.utils.AbiCoder();
          const [_from, nonce, _nftContract, tokenId] = abi.decode(
            ['address', 'uint256', 'address', 'uint256'],
            callData
          );

          // lookup current owner on mainnet

          // here we mock the proof for a different current owner
          const message = await relayer.forwarder.createMessage(account.address, nonce, _nftContract, tokenId);

          const proof = await relayer.forwarder.signer.signMessage(ethers.utils.arrayify(message));

          // response = json_rpc_call(url, 'durin_call', {'to': forwarder.address, 'data': calldata, 'abi': abi})

          await expect(
            relayer.forwarder.signer.sendTransaction({
              to: forwarder.address,
              data: ethers.utils.hexConcat([callbackFunction, abi.encode(['bytes', 'bytes'], [proof, extraData])]),
            })
          ).to.be.revertedWith('TestForwarder: ownership proof');

          const count = await counter.count(account.address);

          expect(count).to.equal(0);
        }
      });
    });

    it('Increments when burner is authorized', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner],
      } = fixtures;

      const createSession = await account.forwarder.createSession(burner.address, 10_000);
      await createSession.wait();

      const {signature, request} = await burner.wrappedCounter.incrementFromForwarderOnly(
        nftContract.address,
        BigNumber.from(411),
        account.address
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);
        if (match) {
          const [_sender, _urls, callData, callbackFunction, extraData] = match[1]
            .split(', ')
            .map((s) => (s.startsWith('[') ? JSON.parse(s.substring(1, s.length - 1)) : JSON.parse(s)));
          // console.log(callData);
          // JSON RPC Provider would now look up the current owner and sign it
          // console.log(`${urls}/gateway/${sender}/${callData}`);

          // decode the bytes
          const abi = new ethers.utils.AbiCoder();
          const [from, nonce, _nftContract, tokenId] = abi.decode(
            ['address', 'uint256', 'address', 'uint256'],
            callData
          );

          // lookup current owner on mainnet

          // here we provide a proof that respects the PS approval
          // our JSON RPC trustfully calls the contract to check for
          // a valid approval from NFT owner ---> burner
          const message = await relayer.forwarder.createMessage(account.address, nonce, _nftContract, tokenId);

          const proof = await relayer.forwarder.signer.signMessage(ethers.utils.arrayify(message));

          // response = json_rpc_call(url, 'durin_call', {'to': forwarder.address, 'data': calldata, 'abi': abi})

          const tx = await relayer.forwarder.signer.sendTransaction({
            to: forwarder.address,
            data: ethers.utils.hexConcat([callbackFunction, abi.encode(['bytes', 'bytes'], [proof, extraData])]),
          });

          await tx.wait();

          const count = await counter.count(account.address);

          expect(count).to.equal(1);
        }
      });
    });
  });
});
