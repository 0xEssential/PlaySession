import {expect} from 'chai';
import {Contract} from 'ethers';
import {ethers} from 'hardhat';
import {setupUsers} from './utils';
import {signMetaTxRequest} from './utils/messageSigner';

const NAME = 'TestForwarder';

const deployContracts = async () => {
  const Forwarder = await ethers.getContractFactory('EssentialForwarder');
  const forwarder = await Forwarder.deploy(NAME, ['http://localhost:8000']);
  await forwarder.deployed();

  const PlaySession = await ethers.getContractFactory('EssentialPlaySession');
  const playSession = await PlaySession.deploy(forwarder.address);
  await playSession.deployed();

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

  // users.map(async (user) => {
  //   const {address, counter, forwarder} = user;

  //   const wrappedCounter = wrapContract(
  //     counter.provider,
  //     address,
  //     counter,
  //     Object.assign(forwarder, {name: NAME})
  //   ) as Contract;

  //   await forwarder.createSession(address, 10_000);

  //   user.wrappedCounter = wrappedCounter;
  // });

  await users[0].forwarder.setPlaySessionOperator(playSession.address);

  return {
    counter,
    forwarder,
    users,
  };
};

const handleOffchainLookup = async (match: RegExpMatchArray, relayer: any, forwarder: any, account: any) => {
  const [_sender, _urls, callData, callbackFunction, extraData] = match[1]
    .split(', ')
    .map((s) => (s.startsWith('[') ? JSON.parse(s.substring(1, s.length - 1)) : JSON.parse(s)));

  const abi = new ethers.utils.AbiCoder();
  const [from, authorizer, nonce, nftChainId, nftContract, tokenId, targetChainId, timestamp] = abi.decode(
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

  const proof = await relayer.forwarder.signer.signMessage(ethers.utils.arrayify(message));
  const tx = await relayer.forwarder.signer.sendTransaction({
    to: forwarder.address,
    data: ethers.utils.hexConcat([callbackFunction, abi.encode(['bytes', 'bytes'], [proof, extraData])]),
  });

  await tx.wait();
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

  describe('count', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('reverts if called outside of forwarder', async function () {
      const {
        users: [_relayer, account],
      } = fixtures;

      await expect(account.counter.increment()).to.be.revertedWith('429');
    });

    it('Increments via Forwarder with OffchainLookup proof', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract],
      } = fixtures;

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: account.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        Object.assign(account.forwarder, {name: NAME})
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);
        if (match) {
          await handleOffchainLookup(match, relayer, forwarder, account);

          const count = await counter.count(account.address);

          expect(count).to.equal(1);
        }
      });
    });
  });

  describe('increment with PlaySession', async () => {
    before(async () => {
      fixtures = await deployContracts();
    });

    it('reverts if called outside of forwarder', async function () {
      const {
        users: [_relayer, account],
      } = fixtures;

      await expect(account.counter.increment()).to.be.revertedWith('429');
    });

    it('Reverts when owner has no PlaySession', async function () {
      const {
        counter,
        forwarder,
        users: [relayer, account, nftContract, burner],
      } = fixtures;

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: burner.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        Object.assign(account.forwarder, {name: NAME})
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);

        if (match) {
          await expect(handleOffchainLookup(match, relayer, forwarder, account)).to.be.revertedWith('Unauthorized()');

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

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: burner.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        Object.assign(account.forwarder, {name: NAME})
      );

      await relayer.forwarder.preflight(request, signature).catch(async (e: Error) => {
        const match = /OffchainLookup\((.*)\)/.exec(e.message);

        if (match) {
          await expect(handleOffchainLookup(match, relayer, forwarder, account)).to.be.revertedWith('Unauthorized()');

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

      const data = account.counter.interface.encodeFunctionData('increment');

      const {signature, request} = await signMetaTxRequest(
        account.counter.provider,
        31337,
        {
          to: account.counter.address,
          from: account.address,
          authorizer: account.address,
          nftContract: nftContract.address,
          nftChainId: '1',
          nftTokenId: '1',
          targetChainId: '31337',
          data,
        },
        Object.assign(account.forwarder, {name: NAME})
      );

      await relayer.forwarder
        .preflight(request, signature)
        .then((resp: any) => expect(resp).to.eq(true))
        .catch(async (e: Error) => {
          const match = /OffchainLookup\((.*)\)/.exec(e.message);
          if (match) {
            await handleOffchainLookup(match, relayer, forwarder, account);

            const count = await counter.count(account.address);

            expect(count).to.equal(1);
          } else {
            console.warn('No match');
            console.warn(e);
            expect(true).to.eq(false);
          }
        });
    });
  });
});
